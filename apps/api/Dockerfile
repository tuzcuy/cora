# Cora API (NestJS + Prisma 7). Build from the repo root:
#   docker build -f apps/api/Dockerfile -t cora-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# prisma generate runs inside the api build script
RUN pnpm --filter @cora/shared build && pnpm --filter @cora/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
# migrate deploy is run by deploy.sh after the stack is up; here we just serve.
CMD ["node", "dist/main.js"]
