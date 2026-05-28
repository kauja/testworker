# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22

# -------- base --------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

# -------- dev (compose で bind mount してホットリロード) --------
FROM base AS dev
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
# lockfile を尊重するが、 dev は workspace 部分編集での再 install を許容するため
# --prefer-frozen-lockfile に留める (--frozen-lockfile だと bind mount での pnpm
# install で lockfile drift が起きた瞬間 fail し、 開発体験が悪い)。
RUN pnpm install --prefer-frozen-lockfile
EXPOSE 3001
CMD ["pnpm", "--filter", "@testworker/api", "run", "dev"]

# -------- build --------
FROM base AS build
COPY . .
# build (= CI / production image) は再現性のため --frozen-lockfile を強制。
# lockfile と package.json に齟齬があると fail し、 transitive 脆弱性 pin と
# rollback 可能性を確実にする (Issue #100)。
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @testworker/api run build

# -------- prod --------
FROM node:${NODE_VERSION}-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /workspace/packages/api/dist ./dist
COPY --from=build /workspace/packages/api/package.json ./package.json
COPY --from=build /workspace/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/server.js"]
