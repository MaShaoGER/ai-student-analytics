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

# Copy built application and dependencies
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy data files
COPY data ./data
COPY oulad_raw ./oulad_raw

# Records directory will be created at runtime if needed
RUN mkdir -p /app/records

EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
