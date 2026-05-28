#!/usr/bin/env bash
# .devcontainer/post-create.sh
#
# Dev Container 起動時に走る初期化スクリプト。 clone → Reopen in Container で
# 「make crawl URL=...」がすぐに通る状態を作る。

set -euo pipefail

echo "[testworker devcontainer] enabling corepack (pnpm shim) ..."
corepack enable

echo "[testworker devcontainer] pnpm install --frozen-lockfile ..."
pnpm install --frozen-lockfile

# Playwright の browser binaries は @playwright/test の install 直後の hook で
# 落とすが、 devcontainer の image によっては node_modules/playwright で別途
# 必要なケースがある。 既に存在すれば no-op。
echo "[testworker devcontainer] ensuring playwright browsers (chromium) ..."
pnpm --filter @testworker/runner exec playwright install chromium || true

# Python 側 (scripts/orchestrate.py) は features で python:3.11 を入れているので、
# venv はリポジトリ直下に作って .gitignore 済み (docs/decisions/ と同じ運用)。
if [ -f scripts/pyproject.toml ] || [ -f scripts/requirements.txt ]; then
  echo "[testworker devcontainer] preparing scripts/.venv ..."
  python3.11 -m venv scripts/.venv
  # shellcheck disable=SC1091
  source scripts/.venv/bin/activate
  if [ -f scripts/pyproject.toml ]; then
    pip install --upgrade pip
    pip install -e "scripts[dev]" || pip install -e scripts
  elif [ -f scripts/requirements.txt ]; then
    pip install -r scripts/requirements.txt
  fi
  deactivate
fi

# 初回 migrate を打って db ファイルを用意 (api 起動時に DB 不在で落ちる挙動を回避)。
echo "[testworker devcontainer] running initial migrate ..."
pnpm --filter @testworker/runner run db:migrate || true

echo "[testworker devcontainer] ready. try: make crawl URL=https://example.com"
