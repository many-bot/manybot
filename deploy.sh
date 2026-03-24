#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# =============================================================================
# deploy — script de release com gates de qualidade e versionamento semântico
#
# Uso:
#   ./deploy                    → commit automático + push (branch atual)
#   ./deploy --release patch    → bump patch + tag + push para master
#   ./deploy --release minor    → bump minor + tag + push para master
#   ./deploy --release major    → bump major + tag + push para master
#   ./deploy --dry-run          → simula tudo sem executar nada
#   ./deploy --help             → mostra esta ajuda
#
# Conventional Commits esperados:
#   feat: nova funcionalidade       → candidate a minor bump
#   fix: correção de bug            → candidate a patch bump
#   docs: só documentação           → sem bump de versão
#   chore: manutenção               → sem bump de versão
#   BREAKING CHANGE: no rodapé     → candidate a major bump
# =============================================================================

# ──────────────────────────────────────────
# Cores e utilitários
# ──────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}▸${RESET} $*"; }
success() { echo -e "${GREEN}✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✖${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }
step()    { echo -e "\n${BOLD}$*${RESET}"; }

# ──────────────────────────────────────────
# Argumentos
# ──────────────────────────────────────────
RELEASE_TYPE=""
DRY_RUN=false

show_help() {
  sed -n '/^# Uso:/,/^# =/p' "$0" | grep '^#' | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      [[ -z "${2-}" ]] && die "--release requer: patch | minor | major"
      RELEASE_TYPE="$2"
      [[ "$RELEASE_TYPE" =~ ^(patch|minor|major)$ ]] || die "Tipo inválido: '$RELEASE_TYPE'. Use patch, minor ou major."
      shift 2
      ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help|-h) show_help ;;
    *) die "Argumento desconhecido: '$1'. Use --help." ;;
  esac
done

# ──────────────────────────────────────────
# Wrapper para dry-run
# ──────────────────────────────────────────
run() {
  if $DRY_RUN; then
    echo -e "  ${YELLOW}[dry-run]${RESET} $*"
  else
    "$@"
  fi
}

# ──────────────────────────────────────────
# GATE 1 — Ambiente Git
# ──────────────────────────────────────────
step "[ 1/6 ] Verificando ambiente Git..."

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "Não é um repositório Git."

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null) \
  || die "Não foi possível detectar a branch atual (HEAD detached?)."

# Releases só saem da master/main
if [[ -n "$RELEASE_TYPE" ]]; then
  [[ "$BRANCH" =~ ^(master|main)$ ]] \
    || die "--release só pode ser executado na branch master/main (atual: $BRANCH)."
fi

success "Branch: ${BOLD}$BRANCH${RESET}"

# ──────────────────────────────────────────
# GATE 2 — Working tree limpa
# ──────────────────────────────────────────
step "[ 2/6 ] Verificando working tree..."

UNTRACKED=$(git ls-files --others --exclude-standard)
MODIFIED=$(git diff --name-only)
STAGED=$(git diff --cached --name-only)

if [[ -n "$UNTRACKED" || -n "$MODIFIED" || -n "$STAGED" ]]; then

  # Em modo release, working tree tem de estar absolutamente limpa
  if [[ -n "$RELEASE_TYPE" ]]; then
    warn "Arquivos não commitados:"
    [[ -n "$STAGED"    ]] && echo -e "  ${GREEN}Staged:${RESET}\n$(echo "$STAGED"    | sed 's/^/    /')"
    [[ -n "$MODIFIED"  ]] && echo -e "  ${YELLOW}Modificados:${RESET}\n$(echo "$MODIFIED"  | sed 's/^/    /')"
    [[ -n "$UNTRACKED" ]] && echo -e "  ${RED}Não rastreados:${RESET}\n$(echo "$UNTRACKED" | sed 's/^/    /')"
    die "Working tree suja. Faça commit ou stash antes de um release."
  fi

  # ── Seletor interativo de arquivos ──────────────────────────────────────
  # Monta lista indexada: staged (S), modificados (M), não rastreados (?)
  declare -a ALL_FILES
  declare -a ALL_LABELS
  while IFS= read -r f; do [[ -n "$f" ]] && ALL_FILES+=("$f") && ALL_LABELS+=("${GREEN}staged${RESET}");    done <<< "$STAGED"
  while IFS= read -r f; do [[ -n "$f" ]] && ALL_FILES+=("$f") && ALL_LABELS+=("${YELLOW}modificado${RESET}"); done <<< "$MODIFIED"
  while IFS= read -r f; do [[ -n "$f" ]] && ALL_FILES+=("$f") && ALL_LABELS+=("${RED}novo${RESET}");        done <<< "$UNTRACKED"

  echo ""
  echo -e "${BOLD}Mudanças detectadas:${RESET}"
  for i in "${!ALL_FILES[@]}"; do
    printf "  %2d) %b  %s\n" "$((i+1))" "${ALL_LABELS[$i]}" "${ALL_FILES[$i]}"
  done
  echo ""

  declare -a SELECTED_FILES

  echo -e "Digite os números para adicionar ao commit, ${BOLD}all${RESET} para todos, ou ${BOLD}done${RESET} para encerrar:"
  while true; do
    echo -ne "${BLUE}▸${RESET} "
    read -r INPUT

    case "$INPUT" in
      done|"")
        [[ ${#SELECTED_FILES[@]} -eq 0 ]] && die "Nenhum arquivo selecionado. Operação cancelada."
        break
        ;;
      all)
        SELECTED_FILES=("${ALL_FILES[@]}")
        echo -e "  ${GREEN}✔${RESET} Todos os arquivos adicionados."
        break
        ;;
      *)
        # Aceita múltiplos números na mesma linha (ex: "1 3 5")
        for TOKEN in $INPUT; do
          if [[ "$TOKEN" =~ ^[0-9]+$ ]] && (( TOKEN >= 1 && TOKEN <= ${#ALL_FILES[@]} )); then
            FILE="${ALL_FILES[$((TOKEN-1))]}"
            # Evita duplicatas
            if printf '%s\n' "${SELECTED_FILES[@]+"${SELECTED_FILES[@]}"}" | grep -qxF "$FILE"; then
              warn "$FILE já está na lista."
            else
              SELECTED_FILES+=("$FILE")
              echo -e "  ${GREEN}✔${RESET} adicionado: ${BOLD}$FILE${RESET}"
            fi
          else
            warn "Entrada inválida: '$TOKEN' — use um número entre 1 e ${#ALL_FILES[@]}, 'all' ou 'done'."
          fi
        done
        ;;
    esac
  done

  echo ""
  info "Arquivos no commit:"
  for f in "${SELECTED_FILES[@]}"; do echo "    $f"; done
  echo ""

  # ── Mensagem de commit ──────────────────────────────────────────────────
  echo "Tipos de commit (Conventional Commits):"
  echo "  feat     → nova funcionalidade"
  echo "  fix      → correção de bug"
  echo "  docs     → só documentação"
  echo "  refactor → refatoração sem mudança de comportamento"
  echo "  test     → adição/correção de testes"
  echo "  chore    → manutenção, dependências, CI"
  echo "  style    → formatação, whitespace"
  echo ""
  echo -n "Tipo: "
  read -r COMMIT_TYPE
  [[ "$COMMIT_TYPE" =~ ^(feat|fix|docs|refactor|test|chore|style)$ ]] \
    || die "Tipo inválido. Use um dos listados acima."

  echo -n "Escopo (opcional, ex: auth, api, ui — Enter para pular): "
  read -r COMMIT_SCOPE

  echo -n "Descrição curta: "
  read -r COMMIT_DESC
  [[ -z "$COMMIT_DESC" ]] && die "Descrição não pode ser vazia."

  echo -n "Há breaking changes? [s/N]: "
  read -r BREAKING
  BREAKING_FOOTER=""
  if [[ "$BREAKING" =~ ^[sS]$ ]]; then
    echo -n "Descreva o breaking change: "
    read -r BREAKING_MSG
    BREAKING_FOOTER=$'\n\nBREAKING CHANGE: '"$BREAKING_MSG"
  fi

  if [[ -n "$COMMIT_SCOPE" ]]; then
    COMMIT_MSG="${COMMIT_TYPE}(${COMMIT_SCOPE}): ${COMMIT_DESC}${BREAKING_FOOTER}"
  else
    COMMIT_MSG="${COMMIT_TYPE}: ${COMMIT_DESC}${BREAKING_FOOTER}"
  fi

  echo ""
  info "Mensagem: ${BOLD}${COMMIT_MSG}${RESET}"

  for f in "${SELECTED_FILES[@]}"; do run git add -- "$f"; done
  run git commit -m "$COMMIT_MSG"
  success "Commit criado."
else
  success "Working tree limpa."
fi

# ──────────────────────────────────────────
# GATE 3 — Testes e qualidade
# ──────────────────────────────────────────
step "[ 3/6 ] Executando gates de qualidade..."

run_if_exists() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    info "$label encontrado. Executando..."
    if $DRY_RUN; then
      echo -e "  ${YELLOW}[dry-run]${RESET} $cmd"
    else
      eval "$cmd" || die "$label falhou. Corrija antes de continuar."
    fi
    success "$label passou."
  else
    warn "$label não encontrado — pulando."
  fi
}

# Lint
if [[ -f "package.json" ]]; then
  if node -e "require('./package.json').scripts?.lint" >/dev/null 2>&1; then
    run_if_exists "Lint (npm)" "npm run lint --if-present"
  fi
fi
[[ -f ".flake8" || -f "setup.cfg" || -f "pyproject.toml" ]] && \
  run_if_exists "Lint (flake8)" "command -v flake8 && flake8 ."

# Testes
run_if_exists "Testes (npm)"    "node -e \"require('./package.json').scripts?.test\" && npm test --if-present"

# Build (só bloqueia em release)
if [[ -n "$RELEASE_TYPE" ]]; then
  run_if_exists "Build (npm)" "node -e \"require('./package.json').scripts?.build\" && npm run build"
fi

success "Gates de qualidade concluídos."

# ──────────────────────────────────────────
# GATE 4 — Sincronia com remoto
# ──────────────────────────────────────────
step "[ 4/6 ] Verificando sincronia com remoto..."

if git remote get-url origin >/dev/null 2>&1; then
  run git fetch origin --quiet

  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")

  if [[ -n "$REMOTE" && "$LOCAL" != "$REMOTE" ]]; then
    BEHIND=$(git rev-list --count HEAD.."origin/$BRANCH")
    AHEAD=$(git rev-list --count "origin/$BRANCH"..HEAD)

    [[ "$BEHIND" -gt 0 ]] && die "Branch está $BEHIND commit(s) atrás do remoto. Faça pull antes."
    [[ "$AHEAD" -gt 0 ]]  && info "Branch está $AHEAD commit(s) à frente do remoto — ok, será enviado."
  else
    success "Branch sincronizada com o remoto."
  fi
else
  warn "Nenhum remoto 'origin' configurado — pulando verificação."
fi

# ──────────────────────────────────────────
# GATE 5 — Versionamento (somente --release)
# ──────────────────────────────────────────
if [[ -n "$RELEASE_TYPE" ]]; then
  step "[ 5/6 ] Versionando release ($RELEASE_TYPE)..."

  if [[ -f "package.json" ]]; then
    CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "desconhecida")
    info "Versão atual: ${BOLD}$CURRENT_VERSION${RESET}"
    run npm version "$RELEASE_TYPE" -m "chore(release): %s"
    NEW_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "nova")
    success "Nova versão: ${BOLD}$NEW_VERSION${RESET}"
  else
    # Fallback: tag Git manual
    LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
    info "Última tag: $LAST_TAG"
    IFS='.' read -r MAJOR MINOR PATCH <<< "${LAST_TAG#v}"
    case "$RELEASE_TYPE" in
      major) MAJOR=$((MAJOR+1)); MINOR=0; PATCH=0 ;;
      minor) MINOR=$((MINOR+1)); PATCH=0 ;;
      patch) PATCH=$((PATCH+1)) ;;
    esac
    NEW_TAG="v${MAJOR}.${MINOR}.${PATCH}"
    run git tag -a "$NEW_TAG" -m "chore(release): $NEW_TAG"
    success "Tag criada: ${BOLD}$NEW_TAG${RESET}"
  fi
else
  step "[ 5/6 ] Versionamento..."
  info "Modo push simples (sem --release). Nenhuma tag será criada."
fi

# ──────────────────────────────────────────
# GATE 6 — Push
# ──────────────────────────────────────────
step "[ 6/6 ] Enviando para o remoto..."

run git push origin "$BRANCH" --follow-tags

# ──────────────────────────────────────────
# Resumo final
# ──────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}═════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Deploy concluído com sucesso!${RESET}"
echo -e "${GREEN}${BOLD}═════════════════════════════════${RESET}"
echo -e "  Branch : ${BOLD}$BRANCH${RESET}"
[[ -n "$RELEASE_TYPE" ]] && \
  echo -e "  Release: ${BOLD}$RELEASE_TYPE${RESET} → ${BOLD}${NEW_VERSION:-$NEW_TAG}${RESET}"
$DRY_RUN && echo -e "\n  ${YELLOW}(dry-run: nenhuma alteração foi feita de fato)${RESET}"
echo ""
