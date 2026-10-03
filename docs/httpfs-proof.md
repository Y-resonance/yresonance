# DuckDB HTTPFS proof

`container/httpfs.test.ts` is the executable proof for the HTTP behavior required by the private R2
bridge. It generates two Parquet files and reads them through an HTTP endpoint with the same
contract as the container's internal outbound handler.

The test verifies:

- `HEAD` metadata requests
- byte-range `GET` requests and `206 Content-Range` responses
- redirect following
- overlapping range requests from DuckDB
- an explicit multi-file `read_parquet` URL list

Run it with:

```sh
bunx vitest --run container/httpfs.test.ts
```

Cloudflare's container configuration disables general internet access and maps only
`r2.yresonance.internal` to `handleInternalR2Request`. A deployed preview smoke test remains the final
platform check because Cloudflare's outbound interception is not emulated by the local test runner.
