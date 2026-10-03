FROM oven/bun:1.3.10-slim AS build
WORKDIR /app/container
# The query engine has its own manifest, so frontend dependency changes leave this layer cached.
COPY container/package.json container/bun.lock container/install-extensions.ts ./
RUN bun install --production --frozen-lockfile \
    && rm -rf node_modules/@duckdb/*-musl \
    && bun run install-extensions.ts

# Both images use glibc. Keep only that binding and the C++ libraries DuckDB needs.
RUN mkdir /runtime-libs \
    && cp -L /usr/lib/*-linux-gnu/libstdc++.so.6 /usr/lib/*-linux-gnu/libgcc_s.so.1 /runtime-libs/
RUN apt-get update -qq \
    && apt-get install -qq --no-install-recommends binutils \
    && strip --strip-unneeded node_modules/@duckdb/node-bindings-linux-*/*.so node_modules/@duckdb/node-bindings-linux-*/*.node

COPY container/query-engine.ts container/query-executor.ts container/query-server.ts ./
# Precompile JS; keep the native binding external. Do not strip the signed httpfs extension.
RUN bun build query-server.ts --target=bun --external @duckdb/node-bindings --minify --bytecode --format=cjs --outdir bundle \
    && mkdir licenses \
    && cp node_modules/zod/LICENSE licenses/zod.txt \
    && cp node_modules/@duckdb/node-api/LICENSE licenses/duckdb-node-api.txt \
    && rm -rf node_modules/zod node_modules/@duckdb/node-api

FROM oven/bun:1.3.10-distroless
WORKDIR /app/container
COPY --from=build /app/container/node_modules ./node_modules
COPY --from=build /app/container/bundle ./
COPY --from=build /app/container/licenses ./licenses
COPY --from=build /root/.duckdb /root/.duckdb
COPY --from=build /runtime-libs /usr/local/lib
ENV LD_LIBRARY_PATH=/usr/local/lib
EXPOSE 8080
CMD ["query-server.js"]
