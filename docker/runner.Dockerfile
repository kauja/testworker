# syntax=docker/dockerfile:1.7

# Playwright 公式イメージ（Chromium 等を内蔵）。
# https://mcr.microsoft.com/en-us/product/playwright/about
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

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
RUN pnpm install --frozen-lockfile

# ソースは bind mount を想定（compose の volumes 参照）。
ENTRYPOINT ["pnpm", "--filter", "@testworker/runner", "run"]
CMD ["crawl"]
