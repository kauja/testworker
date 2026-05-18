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
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --no-frozen-lockfile
EXPOSE 3001
CMD ["pnpm", "--filter", "@testworker/api", "run", "dev"]

# -------- build --------
FROM base AS build
COPY . .
RUN pnpm install --no-frozen-lockfile
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
