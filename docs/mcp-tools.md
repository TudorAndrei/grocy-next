# MCP tools

Adapters live in `backend/src/grocy/mcp/` and call shared domain services. There is no arbitrary SQL tool.

Set `GROCY_MCP_API_KEY` to a stored API key. The stdio server authenticates that key for each call and applies the user permissions. In development it can use the seeded `dev-key`. Tools do not accept a caller-supplied user ID.

Run with `uv run grocy-mcp` (FastMCP stdio) or call tools over HTTP:

`POST /api/v2/mcp/call` with header `GROCY-API-KEY` and body:

```json
{ "tool": "products_search", "arguments": { "query": "yogurt" } }
```

## Catalog

| Tool | Write? | Status |
|---|---|---|
| `products_search` | No | implemented |
| `products_get` | No | implemented |
| `inventory_list` | No | implemented |
| `inventory_purchase` | Yes | implemented |
| `inventory_consume` | Yes | implemented |
| `shopping_list_get` | No | implemented |
| `shopping_list_add` | Yes | implemented |
| `recipes_search` | No | implemented |
| `nutrition_get` | No | implemented |
| `nutrition_propose_update` | Yes (staged) | implemented |
| `nutrition_commit_update` | Yes | implemented |
| `nutrition_upsert` | Yes | implemented |
| `nutrition_attach_evidence` | Yes | implemented |

Photo decoding and OCR are out of scope for this server. External assistants extract values and submit structured payloads.
