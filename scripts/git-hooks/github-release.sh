#!/usr/bin/env bash
# hooks/github-release.sh <tag> <true|false (é rc?)>
# Cria uma Release no GitHub via API — equivalente ao softprops/action-gh-release
# que existia no release.yml antigo. Roda com 'curl', sem dependências extras.
#
# Lê GITHUB_TOKEN e GITHUB_REPO de um arquivo .env (não precisa exportar nada
# no shell). Por padrão procura hooks/.env — pode apontar pra outro lugar com
# a env var RELEASE_ENV_FILE.
#
# Formato do .env (sem "export", sem aspas):
#   GITHUB_TOKEN=ghp_xxx
#   GITHUB_REPO=dono/repo
set -euo pipefail

TAG="${1:?uso: github-release.sh <tag> <true|false>}"
IS_RC="${2:?uso: github-release.sh <tag> <true|false>}"

ENV_FILE="${RELEASE_ENV_FILE:-$(dirname "${BASH_SOURCE[0]}")/.env}"

if [ -f "$ENV_FILE" ]; then
  set -a  # exporta automaticamente tudo que for definido no source abaixo
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${GITHUB_TOKEN:?defina GITHUB_TOKEN em $ENV_FILE}"
: "${GITHUB_REPO:?defina GITHUB_REPO (dono/repo) em $ENV_FILE}"

if [ "$IS_RC" = "true" ]; then
  NAME="[RC] $TAG"
  PRERELEASE=true
else
  NAME="Release $TAG"
  PRERELEASE=false
fi

# monta o corpo da requisição em JSON com node (evita escaping manual em bash)
PAYLOAD="$(node -e '
const [tag, name, prerelease] = process.argv.slice(1);
console.log(JSON.stringify({
  tag_name: tag,
  name,
  prerelease: prerelease === "true",
  generate_release_notes: true,
}));
' "$TAG" "$NAME" "$PRERELEASE")"

echo "==> Criando release no GitHub: $NAME (prerelease=$PRERELEASE)"

RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

HTTP_CODE="$(curl -sS \
  -o "$RESPONSE_FILE" \
  -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$GITHUB_REPO/releases" \
  -d "$PAYLOAD")"

BODY="$(cat "$RESPONSE_FILE")"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  URL="$(echo "$BODY" | node -e '
    let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try { console.log(JSON.parse(d).html_url || ""); } catch { console.log(""); }
    });
  ')"
  echo "✅ Release criada no GitHub: $URL"
else
  echo "⚠️  Falha ao criar release no GitHub (HTTP $HTTP_CODE):"
  echo "$BODY"
  exit 1
fi
