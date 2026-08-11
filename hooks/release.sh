#!/usr/bin/env bash
# hooks/release.sh <bare-repo-path> <tag>
# Roda no servidor: extrai a tag do bare repo, builda, testa, publica
# e grava os dados de release pro endpoint da porta 3006 servir.
set -euo pipefail

BARE_REPO="${1:?uso: release.sh <bare-repo> <tag>}"
TAG="${2:?uso: release.sh <bare-repo> <tag>}"

# Onde o servidor guarda o work tree usado pra build e os dados publicados.
# Pode sobrescrever com a variável de ambiente RELEASE_BASE_DIR.
BASE_DIR="${RELEASE_BASE_DIR:-$HOME/release-runtime}"
WORK_TREE="$BASE_DIR/work"
DATA_DIR="$BASE_DIR/data"

mkdir -p "$WORK_TREE" "$DATA_DIR"
rm -rf "${WORK_TREE:?}"/*

echo "==> Extraindo $TAG (bare repo não tem work tree, então usamos git archive)"
git --git-dir="$BARE_REPO" archive "$TAG" | tar -x -C "$WORK_TREE"

cd "$WORK_TREE"

NPM_VERSION="$(npm --version)"
NPM_MAJOR="${NPM_VERSION%%.*}"
if [ "$NPM_MAJOR" -lt 11 ]; then
  echo "⚠️  npm $NPM_VERSION detectado — staged publishing (npm stage) exige npm >= 11.15.0."
  echo "    Atualize com: npm install -g npm@latest"
  exit 1
fi

IS_RC=false
[[ "$TAG" == *"-rc."* ]] && IS_RC=true

echo "==> Build $TAG (rc=$IS_RC)"
# Bug conhecido do npm CLI (npm/cli#9783): um 'allow-scripts' setado no
# .npmrc global/do usuário é propagado via env pra installs aninhados
# (ex.: um 'npm i' dentro de um script de build) e derruba com EALLOWSCRIPTS.
# Limpamos a env aqui pra não depender do .npmrc do servidor ficar "limpo".
unset npm_config_allow_scripts || true
npm ci
npm run build
npm run test --if-present

echo "==> Cross-compilando whatsmeow-service para todas as plataformas"
node scripts/build-whatsmeow-release.mjs

PREV_TAG="$(git --git-dir="$BARE_REPO" describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || true)"
if [ -n "$PREV_TAG" ]; then
  NOTES="$(git --git-dir="$BARE_REPO" log "${PREV_TAG}..${TAG}" --pretty=format:'- %s (%h)')"
else
  NOTES="$(git --git-dir="$BARE_REPO" log "${TAG}" --pretty=format:'- %s (%h)')"
fi

STATUS="built"
if [ "$IS_RC" = false ]; then
  echo "==> Enviando pro stage do npm (staged publishing, sem bypass de 2FA)"
  # npm stage publish builda o tarball e deixa pronto pra publicar, mas NÃO
  # publica de verdade. Alguém precisa rodar 'npm stage approve <id>' com
  # 2FA interativo (de qualquer máquina) pra liberar a versão.
  npm stage publish --access=public
  STATUS="staged"
else
  echo "==> Pulando publicação no npm (release candidate)"
  STATUS="rc-built"
fi

if [ "$IS_RC" = true ]; then
  NAME="[RC] $TAG"
else
  NAME="Release $TAG"
fi

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
COMMIT="$(git --git-dir="$BARE_REPO" rev-parse "$TAG")"

node -e '
const fs = require("fs");
const path = require("path");

const [tag, name, prerelease, status, commit, timestamp, notes, dataDir] = process.argv.slice(1);

const entry = {
  tag,
  name,
  prerelease: prerelease === "true",
  status,
  commit,
  timestamp,
  notes,
};

const latestFile = path.join(dataDir, "latest.json");
fs.writeFileSync(latestFile, JSON.stringify(entry, null, 2));

const historyFile = path.join(dataDir, "releases.json");
let history = [];
if (fs.existsSync(historyFile)) {
  try { history = JSON.parse(fs.readFileSync(historyFile, "utf8")); } catch { history = []; }
}
history.unshift(entry);
fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

console.log("Gravado em", latestFile);
' "$TAG" "$NAME" "$IS_RC" "$STATUS" "$COMMIT" "$TIMESTAMP" "$NOTES" "$DATA_DIR"

echo "✅ Release $TAG processada no servidor ($STATUS)"
if [ "$STATUS" = "staged" ]; then
  echo "👉 Falta aprovar. De qualquer máquina com 2FA: npm stage list  (pra achar o id)  e depois  npm stage approve <id>"
fi

# Cria a Release no GitHub, se houver hooks/.env configurado. Opcional —
# igual ao 'continue-on-error: true' do YAML antigo, uma falha aqui não
# derruba o resto do processo (build/publish já aconteceram).
GITHUB_ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/.env"
if [ -f "$GITHUB_ENV_FILE" ]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/github-release.sh" "$TAG" "$IS_RC" || \
    echo "⚠️  Falha ao criar a release no GitHub, seguindo mesmo assim."
else
  echo "ℹ️  hooks/.env não encontrado — pulando criação de release no GitHub."
fi

# ── Upload whatsmeow binaries to Codeberg release ────────────────────────
if [ -f "$GITHUB_ENV_FILE" ]; then
  set -a; source "$GITHUB_ENV_FILE"; set +a
fi

if [ -n "${CODEBERG_TOKEN:-}" ] && [ -n "${CODEBERG_REPO:-}" ]; then
  DIST_DIR="whatsmeow-service/dist-release"
  if [ -d "$DIST_DIR" ]; then
    echo "==> Enviando binários whatsmeow para Codeberg ($CODEBERG_REPO)"

    BODY="These binaries are automatically built for manybot internal whatsmeow driver. They are **not** intended for standalone download or direct use."

    # Helper: extrai o id de uma resposta JSON da API
    extract_id() { node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log(r.id??'')}catch{console.log('')}})" 2>/dev/null; }

    # Cria a release via POST; captura HTTP code + body separadamente
    echo "   Criando release no Codeberg..."
    REL_ID=""
    REL_RESPONSE="$(mktemp)"
    REL_HTTP_CODE="$(curl -sS -L --post301 --post302 --post303 -w '%{http_code}' -o "$REL_RESPONSE" -X POST \
      "https://codeberg.org/api/v1/repos/$CODEBERG_REPO/releases" \
      -H "Authorization: token $CODEBERG_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$(TAG="$TAG" BODY="$BODY" IS_RC="$IS_RC" node -e "console.log(JSON.stringify({tag_name:process.env.TAG, name:process.env.TAG, body:process.env.BODY, prerelease:process.env.IS_RC==='true'}))")")" || true

    if [ "$REL_HTTP_CODE" = "201" ]; then
      REL_ID="$(extract_id < "$REL_RESPONSE")"
    elif [ "$REL_HTTP_CODE" = "409" ]; then
      # release já existe; busca por tag
      echo "   Release já existe (HTTP 409), buscando ID por tag..."
      GET_RESPONSE="$(mktemp)"
      GET_HTTP_CODE="$(curl -sS -w '%{http_code}' -o "$GET_RESPONSE" \
        "https://codeberg.org/api/v1/repos/$CODEBERG_REPO/releases/tags/$TAG" \
        -H "Authorization: token $CODEBERG_TOKEN")" || true
      if [ "$GET_HTTP_CODE" = "200" ]; then
        REL_ID="$(extract_id < "$GET_RESPONSE")"
      else
        echo "   ⚠️  GET /releases/tags/$TAG retornou HTTP $GET_HTTP_CODE"
        head -c 500 "$GET_RESPONSE" | sed 's/^/       /'
      fi
      rm -f "$GET_RESPONSE"
    else
      echo "   ⚠️  POST /releases retornou HTTP $REL_HTTP_CODE (inesperado)"
      head -c 500 "$REL_RESPONSE" | sed 's/^/       /'
    fi
    rm -f "$REL_RESPONSE"

    if [ -n "$REL_ID" ]; then
      for FILE in "$DIST_DIR"/*; do
        FNAME="$(basename "$FILE")"
        echo "   Uploading $FNAME..."
        curl -sS -X POST "https://codeberg.org/api/v1/repos/$CODEBERG_REPO/releases/$REL_ID/assets" \
          -H "Authorization: token $CODEBERG_TOKEN" \
          -H "Content-Type: application/octet-stream" \
          --data-binary "@$FILE" \
          -H "Content-Disposition: attachment; filename=\"$FNAME\"" > /dev/null || \
          echo "   ⚠️  Falha ao enviar $FNAME"
      done
      echo "✅ Binários whatsmeow enviados para Codeberg"
    else
      echo "⚠️  Não foi possível obter o ID da release — pulando upload de binários"
    fi
  else
    echo "ℹ️  $DIST_DIR não encontrado — pulando upload de binários whatsmeow"
  fi
else
  echo "ℹ️  CODEBERG_TOKEN/CODEBERG_REPO não configurados — pulando upload de binários"
fi
