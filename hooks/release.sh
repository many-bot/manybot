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
  echo "==> Enviando @manybot/types pro stage do npm"
  if ! (cd packages/types && npm stage publish --access=public); then
    echo "⚠️  Falha ao publicar @manybot/types (versão provavelmente não bumpada em packages/types/package.json) — seguindo mesmo assim."
  fi
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

# Cria a Release no GitHub se houver
# hooks/.env configurado. Opcional — falha aqui não derruba o processo.
GITHUB_ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/.env"
if [ -f "$GITHUB_ENV_FILE" ]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/github-release.sh" "$TAG" "$IS_RC" || \
    echo "⚠️  Falha ao criar a release no GitHub, seguindo mesmo assim."
else
  echo "ℹ️  hooks/.env não encontrado — pulando criação de release no GitHub."
fi
