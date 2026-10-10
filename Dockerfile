FROM node:22-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_HOME=/tmp/corepack
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
# .dockerignore keeps oulad_raw/*.csv out of the context, so the build is small;
# the CSVs reach the container through the read-only mount in docker-compose.yml.
RUN pnpm build

# Output file tracing follows require("@duckdb/node-bindings") to duckdb.node but
# stops there, so the shared library next to it never lands in .next/standalone.
# duckdb.node resolves it through @loader_path, so without this every analysis
# request in the container fails with "library not loaded". Copy it into the same
# directory the addon occupies in the standalone output. The arch is not hardcoded:
# pnpm installs whichever variant matches the container (linux-arm64 on Apple
# Silicon, linux-x64 on Intel/amd64 hosts), so match them all.
RUN set -eux; \
    for d in node_modules/.pnpm/@duckdb+node-bindings-linux-*/node_modules/@duckdb/node-bindings-linux-*; do \
      [ -d "$d" ] || continue; \
      [ -f "$d/libduckdb.so" ] || { echo "no libduckdb.so inside $d"; exit 1; }; \
      dest=".next/standalone/$d"; \
      mkdir -p "$dest"; \
      cp "$d/libduckdb.so" "$dest/"; \
    done; \
    found=0; \
    for addon in .next/standalone/node_modules/.pnpm/@duckdb+node-bindings-linux-*/node_modules/@duckdb/node-bindings-linux-*/duckdb.node; do \
      [ -f "$addon" ] || continue; \
      dir=$(dirname "$addon"); \
      [ -f "$dir/libduckdb.so" ] || { echo "libduckdb.so missing next to $addon - the container would fail at runtime"; exit 1; }; \
      found=$((found + 1)); \
    done; \
    [ "$found" -gt 0 ] || { echo "no linux duckdb addon found in standalone output"; exit 1; }; \
    echo "verified libduckdb.so beside duckdb.node in $found addon dir(s)"; \
    find .next/standalone -name 'libduckdb.so' -print

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# server.js calls process.chdir(__dirname), so the app's working directory is
# wherever server.js sits. Copying the standalone tree to /app keeps it at /app,
# which is the path the data lookups and the compose volume mounts both expect
# (oulad_raw, data, records). Its bundled node_modules is all the runtime needs.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# OULAD.names keeps the dataset's provenance alongside the mounted CSVs.
COPY --from=builder /app/oulad_raw/OULAD.names ./oulad_raw/OULAD.names

RUN mkdir -p /app/records

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
