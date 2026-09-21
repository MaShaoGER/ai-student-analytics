FROM node:22-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_HOME=/tmp/corepack
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/data ./data

EXPOSE 3000
CMD ["node", "server.js"]
