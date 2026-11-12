# Cora Worker (BullMQ). Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t cora-worker .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @cora/shared build && pnpm --filter @cora/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/worker
CMD ["node", "dist/main.js"]
