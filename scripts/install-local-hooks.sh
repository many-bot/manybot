#!/usr/bin/env bash
# scripts/install-local-hooks.sh
# Points this clone's git hooks at scripts/local-hooks/. Runs
# automatically on `npm install` via the "prepare" script. Not the
# same folder as scripts/git-hooks/, which is server-side release
# infrastructure (see CONTRIBUTING.md).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

cd "$REPO_ROOT"
chmod +x scripts/local-hooks/*
git config core.hooksPath scripts/local-hooks
echo "==> Local git hooks installed (core.hooksPath=scripts/local-hooks)"
