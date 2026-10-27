from __future__ import annotations

import inspect
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any, get_type_hints

from pydantic import ConfigDict, ValidationError, create_model

from grocy.core.actor import Actor
from grocy.core.auth import authenticate_key
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.session import get_session_factory
from grocy.mcp import tools

TOOL_PERMISSIONS = {
    "products_search": "STOCK",
    "products_get": "STOCK",
    "inventory_list": "STOCK",
    "inventory_purchase": "STOCK_PURCHASE",
    "inventory_consume": "STOCK_CONSUME",
    "shopping_list_get": "SHOPPINGLIST",
    "shopping_list_add": "SHOPPINGLIST_ITEMS_ADD",
    "recipes_search": "RECIPES",
    "nutrition_get": "STOCK",
    "nutrition_propose_update": "STOCK",
    "nutrition_commit_update": "MASTER_DATA_EDIT",
    "nutrition_upsert": "MASTER_DATA_EDIT",
    "nutrition_attach_evidence": "STOCK",
}
TOOL_CATALOG = list(TOOL_PERMISSIONS)


@lru_cache
def _arguments_model(name: str):
    fn = getattr(tools, name)
    hints = get_type_hints(fn)
    fields: dict[str, Any] = {
        p.name: (hints[p.name], ... if p.default is inspect.Parameter.empty else p.default)
        for p in inspect.signature(fn).parameters.values()
        if p.name not in {"session", "actor"}
    }
    return create_model(f"{name}Arguments", __config__=ConfigDict(extra="forbid"), **fields)


async def dispatch(session, actor: Actor, name: str, arguments: dict[str, Any]) -> Any:
    if not get_settings().mcp_enabled:
        raise GrocyError("MCP is disabled", status_code=503)
    if name not in TOOL_PERMISSIONS:
        raise NotFoundError(f"Unknown MCP tool '{name}'")
    actor.require(TOOL_PERMISSIONS[name])
    try:
        args = _arguments_model(name).model_validate(arguments).model_dump()
    except ValidationError as exc:
        raise GrocyError(str(exc), status_code=422, code="invalid_arguments") from exc
    fn = getattr(tools, name)
    if "actor" in inspect.signature(fn).parameters:
        args["actor"] = actor
    try:
        if (
            name
            in {
                "inventory_purchase",
                "inventory_consume",
                "shopping_list_add",
                "nutrition_propose_update",
                "nutrition_commit_update",
                "nutrition_upsert",
                "nutrition_attach_evidence",
            }
            and get_settings().database_url.startswith("sqlite")
            and not session.info.get("write_lock")
        ):
            from sqlalchemy import text

            await session.execute(text("BEGIN IMMEDIATE"))
        return await fn(session, **args)
    except (ValueError, TypeError) as exc:
        raise GrocyError(str(exc), status_code=422, code="invalid_arguments") from exc


def create_mcp_server():
    from fastmcp import FastMCP

    @asynccontextmanager
    async def mcp_lifespan(_server):
        from grocy.main import lifespan

        async with lifespan(None):
            yield {}

    mcp = FastMCP("grocy-next", lifespan=mcp_lifespan)

    def register(name: str) -> None:
        fn = getattr(tools, name)
        hints = get_type_hints(fn)
        parameters = [
            p.replace(annotation=hints[p.name])
            for p in inspect.signature(fn).parameters.values()
            if p.name not in {"session", "actor"}
        ]
        signature = inspect.Signature(parameters, return_annotation=hints.get("return", Any))

        async def invoke(*args, **kwargs):
            bound = signature.bind(*args, **kwargs)
            bound.apply_defaults()
            settings = get_settings()
            key = settings.mcp_api_key or settings.dev_open_api_key
            async with get_session_factory()() as session:
                actor = await authenticate_key(session, key)
                return await dispatch(session, actor, name, dict(bound.arguments))

        invoke.__name__ = name
        invoke.__doc__ = fn.__doc__ or name.replace("_", " ").capitalize() + "."
        invoke.__annotations__ = {p.name: p.annotation for p in parameters}
        invoke.__annotations__["return"] = signature.return_annotation
        invoke.__dict__["__signature__"] = signature
        mcp.tool(invoke)

    for name in TOOL_CATALOG:
        register(name)
    return mcp
