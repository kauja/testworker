# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS dev
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
# dev は workspace 部分編集での再 install を許容するため --prefer-frozen-lockfile
# に留める。 lockfile を尊重しつつ、 ホットリロード中の package.json 更新でも
# fail しない (Issue #100)。
RUN pnpm install --prefer-frozen-lockfile
EXPOSE 3000
CMD ["pnpm", "--filter", "@testworker/web", "run", "dev"]

FROM base AS build
COPY . .
# build (= CI / production image) は再現性のため --frozen-lockfile を強制。
# lockfile と package.json に齟齬があれば fail させて transitive 脆弱性 pin と
# rollback 可能性を保証する (Issue #100)。
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @testworker/web run build

FROM node:${NODE_VERSION}-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /workspace/packages/web/.next/standalone ./
COPY --from=build /workspace/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /workspace/packages/web/public ./packages/web/public
EXPOSE 3000
CMD ["node", "packages/web/server.js"]
