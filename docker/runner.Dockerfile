# syntax=docker/dockerfile:1.7

# Playwright 公式イメージ（Chromium 等を内蔵）。
# https://mcr.microsoft.com/en-us/product/playwright/about
#
# version は pnpm-lock.yaml で実際に install される playwright と一致させる。
# mismatch すると `headless_shell` 等の browser binary path が image 側と
# install 後の Playwright で食い違い、 全 crawl が browserType.launch で fail
# する (Issue #153)。 上げ方は:
#   1. pnpm update playwright --filter @testworker/runner で lockfile 更新
#   2. この FROM を同 version (X.Y.Z-jammy) に更新
#   3. make up --build (or docker compose build runner)
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# better-sqlite3 のためのビルドツール（公式イメージは多くを内包しているがフォールバック）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/runner/package.json packages/runner/

# runner はソース bind mount で動かす CLI 用途だが、 依存解決は再現性のため
# --frozen-lockfile を強制する。 lockfile を更新するときは別途 pnpm install を
# ホスト側で実行して lock を refresh してから docker build する (Issue #100)。
#
# Playwright image の Node メジャー更新 (v1.60 で Node 24 / NODE_MODULE_VERSION
# 137) と better-sqlite3 の prebuild (Node 22 / 127) が ABI mismatch する
# (#158) ので、 install 直後に rebuild してネイティブモジュールを image の
# Node に合わせて再コンパイルする。
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @testworker/runner rebuild better-sqlite3

# ソースは bind mount を想定（compose の volumes 参照）。
ENTRYPOINT ["pnpm", "--filter", "@testworker/runner", "run"]
CMD ["crawl"]
