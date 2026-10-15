from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.mcp.server import TOOL_CATALOG, dispatch

router = APIRouter(prefix="/mcp", tags=["mcp"])


class McpCallRequest(BaseModel):
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)


@router.get("/tools")
async def list_tools(_actor: CurrentActor) -> dict[str, list[str]]:
    return {"tools": TOOL_CATALOG}


@router.post("/call")
async def call_tool(body: McpCallRequest, actor: CurrentActor, session: DbSession) -> Any:
    return await dispatch(session, actor, body.tool, body.arguments)
