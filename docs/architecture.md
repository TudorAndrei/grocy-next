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
Web / integrations --REST--> FastAPI /
```

See the project RFC for delivery phases, nutrition schema, MCP catalog, and compatibility policy.
