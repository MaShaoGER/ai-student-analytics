FROM node:22-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_HOME=/tmp/corepack
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
# .dockerignore keeps oulad_raw/*.csv and design material out of the context,
# so the build is small; the CSVs reach the container through the read-only
# mount in docker-compose.yml.
# Memory-constrained hosts can opt into Next.js's Webpack builder with
# --build-arg NEXT_BUILD_ARGS=--webpack; the default remains Turbopack.
# `pnpm build` runs the postbuild script, which assembles the complete
# standalone tree: static assets at the dist-relative path, runtime public
# assets (minus design-only files), the Rare UI license, and the DuckDB
# shared library next to duckdb.node.
ARG NEXT_BUILD_ARGS=""
RUN pnpm build ${NEXT_BUILD_ARGS}

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# server.js calls process.chdir(__dirname), so the app's working directory is
# wherever server.js sits. Copying the standalone tree to /app keeps it at /app,
# which is the path the data lookups and the compose volume mounts both expect
# (oulad_raw, data, records). Its bundled node_modules is all the runtime needs;
# static assets, public assets, license and the DuckDB library are already
# inside the tree thanks to the postbuild step.
COPY --from=builder /app/.next/standalone ./

# OULAD.names keeps the dataset's provenance alongside the mounted CSVs.
COPY --from=builder /app/oulad_raw/OULAD.names ./oulad_raw/OULAD.names
COPY --from=builder /app/scripts/admin-init.mjs ./scripts/admin-init.mjs
COPY --from=builder /app/scripts/account-cli.mjs ./scripts/account-cli.mjs
COPY --from=builder /app/scripts/reset-password.mjs ./scripts/reset-password.mjs
COPY --from=builder /app/scripts/healthcheck.mjs ./scripts/healthcheck.mjs

RUN mkdir -p /app/records

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Readiness, not liveness: the probe makes one anonymous GET /api/auth/session on
# the loopback interface and requires status 200 with { user: null, setupRequired }.
# A records volume with no administrator yet (setupRequired=true) is healthy, which
# keeps `--wait` usable before `docker compose exec ... node scripts/admin-init.mjs`.
# The same script backs the Compose healthcheck, so both read identical rules.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

CMD ["node", "server.js"]
