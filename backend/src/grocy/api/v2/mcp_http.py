from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import NotFoundError
from grocy.mcp import tools
from grocy.mcp.server import TOOL_CATALOG

router = APIRouter(prefix="/mcp", tags=["mcp"])


class McpCallRequest(BaseModel):
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)


@router.get("/tools")
async def list_tools(_actor: CurrentActor) -> dict[str, list[str]]:
    return {"tools": TOOL_CATALOG}


@router.post("/call")
async def call_tool(
    body: McpCallRequest,
    actor: CurrentActor,
    session: DbSession,
) -> Any:
    name = body.tool
    args = dict(body.arguments)
    if name == "products_search":
        return await tools.products_search(session, **args)
    if name == "products_get":
        return await tools.products_get(session, **args)
    if name == "inventory_list":
        return await tools.inventory_list(session, **args)
    if name == "inventory_purchase":
        return await tools.inventory_purchase(session, actor, **args)
    if name == "inventory_consume":
        return await tools.inventory_consume(session, actor, **args)
    if name == "shopping_list_get":
        return await tools.shopping_list_get(session, **args)
    if name == "shopping_list_add":
        return await tools.shopping_list_add(session, **args)
    if name == "recipes_search":
        return await tools.recipes_search(session, **args)
    if name == "nutrition_get":
        return await tools.nutrition_get(session, **args)
    if name == "nutrition_propose_update":
        payload = args.get("payload", args)
        return await tools.nutrition_propose_update(session, actor, payload)
    if name == "nutrition_commit_update":
        return await tools.nutrition_commit_update(session, actor, **args)
    if name == "nutrition_upsert":
        product_id = args.pop("product_id")
        payload = args.get("payload", args)
        return await tools.nutrition_upsert(session, actor, product_id, payload)
    if name == "nutrition_attach_evidence":
        return await tools.nutrition_attach_evidence(session, actor, **args)
    raise NotFoundError(f"Unknown MCP tool '{name}'")
