# Architecture

Grocy Next is a Python modular monolith:

- **FastAPI** exposes Grocy-compatible REST plus `/api/v2` extensions.
- **FastMCP** exposes authenticated tools for external assistants.
- Both adapters call shared deterministic domain services.
- Persistence starts on **SQLite** with Grocy-compatible core tables plus extension tables (nutrition).

Non-negotiable: no embedded agent, vision model, OCR, or PydanticAI runtime. External MCP clients interpret photos and other inputs, then invoke tools under normal auth and validation.

```text
Assistant --MCP--> FastMCP adapter \
                                    +--> domain services --> SQLite / files
Clients / integrations --REST--> FastAPI /
```

See `compatibility.md` for the API boundary, `migration.md` for database storage, and `mcp-tools.md` for tool access.

This repository contains the API, its tests and runtime tooling. The old React client and GitHub Actions CI workflow have been removed. Future cross-platform clients will use [Native Shell](https://nsh.dev/) and consume the same HTTP API.
