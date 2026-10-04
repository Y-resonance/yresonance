README.md is only for humans, don't edit it without explicit mention from users.

Data model lives in code: src/domain/schema.ts (dashboard document), src/db/schema.ts (tables), src/api/contracts.ts (API and tools)

The Dashboard Builder should be fully controllable by WebMCP tooling.
Generic tools like "addWidget", "editWidget" are preferred over very specialized tools.

Use cf CLI for investiating deployment-relevant topics.

## Documentation

- Read [development tasks](docs/development.md) when working with local data files, capturing landing page screenshots, or resetting an environment.
- Read [architecture](docs/architecture.md) when changing query execution, storage, authentication, or preview example seeding.
- Read [product and architecture decisions](docs/decisions.md) before changing product behavior or architecture.
- Read [WebMCP usage](docs/webmcp-usage.md) when changing page tools, their contracts, or permissions.
- Read [preview environments and deployment](docs/preview-environments.md) when changing Cloudflare deployment or preview isolation. For build activation, cleanup, or recovery, also read [the native preview rollout](docs/native-previews.md).
