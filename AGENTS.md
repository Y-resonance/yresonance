Product and architecture decisions in ./docs/decisions.md
Data model lives in code: src/domain/schema.ts (dashboard document), src/db/schema.ts (tables), src/api/contracts.ts (API and tools)

The Dashboard Builder should be fully controllable by WebMCP tooling.
Generic tools like "addWidget", "editWidget" are preferred over very specialized tools.

Use cf CLI for investiating deployment-relevant topics.
