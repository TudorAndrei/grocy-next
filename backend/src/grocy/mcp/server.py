from __future__ import annotations

from collections.abc import Callable
from typing import Any

from grocy.core.actor import Actor
from grocy.db.session import get_session_factory
from grocy.mcp import tools


def _actor_from_meta(meta: dict[str, Any] | None) -> Actor:
    meta = meta or {}
    return Actor(
        user_id=int(meta.get("user_id", 1)),
        username=str(meta.get("username", "mcp")),
        api_key=meta.get("api_key"),
        is_admin=True,
    )


async def _with_session(fn: Callable, *args: Any, **kwargs: Any) -> Any:
    factory = get_session_factory()
    async with factory() as session:
        return await fn(session, *args, **kwargs)


def create_mcp_server():
    from fastmcp import FastMCP

    mcp = FastMCP("grocy-next")

    @mcp.tool
    async def products_search(query: str, limit: int = 25) -> list[dict]:
        return await _with_session(tools.products_search, query, limit=limit)

    @mcp.tool
    async def products_get(product_id: int) -> dict:
        return await _with_session(tools.products_get, product_id)

    @mcp.tool
    async def inventory_list(
        product_id: int | None = None,
        location_id: int | None = None,
    ) -> list[dict]:
        return await _with_session(
            tools.inventory_list,
            product_id=product_id,
            location_id=location_id,
        )

    @mcp.tool
    async def inventory_purchase(
        product_id: int,
        amount: float,
        best_before_date: str | None = None,
        price: float | None = None,
        location_id: int | None = None,
        user_id: int = 1,
        username: str = "mcp",
    ) -> dict:
        actor = Actor(user_id=user_id, username=username, is_admin=True)
        return await _with_session(
            tools.inventory_purchase,
            actor,
            product_id,
            amount,
            best_before_date=best_before_date,
            price=price,
            location_id=location_id,
        )

    @mcp.tool
    async def inventory_consume(
        product_id: int,
        amount: float,
        spoiled: bool = False,
        location_id: int | None = None,
        user_id: int = 1,
        username: str = "mcp",
    ) -> dict:
        actor = Actor(user_id=user_id, username=username, is_admin=True)
        return await _with_session(
            tools.inventory_consume,
            actor,
            product_id,
            amount,
            spoiled=spoiled,
            location_id=location_id,
        )

    @mcp.tool
    async def shopping_list_get(shopping_list_id: int = 1) -> dict:
        return await _with_session(tools.shopping_list_get, shopping_list_id)

    @mcp.tool
    async def shopping_list_add(
        product_id: int,
        amount: float = 1,
        shopping_list_id: int = 1,
        note: str | None = None,
    ) -> dict:
        return await _with_session(
            tools.shopping_list_add,
            product_id,
            amount=amount,
            shopping_list_id=shopping_list_id,
            note=note,
        )

    @mcp.tool
    async def recipes_search(query: str) -> list[dict]:
        return await _with_session(tools.recipes_search, query)

    @mcp.tool
    async def nutrition_get(product_id: int, barcode: str | None = None) -> dict | None:
        return await _with_session(tools.nutrition_get, product_id, barcode=barcode)

    @mcp.tool
    async def nutrition_propose_update(
        payload: dict,
        user_id: int = 1,
        username: str = "mcp",
    ) -> dict:
        actor = Actor(user_id=user_id, username=username, is_admin=True)
        return await _with_session(tools.nutrition_propose_update, actor, payload)

    @mcp.tool
    async def nutrition_commit_update(
        proposal_id: int,
        user_id: int = 1,
        username: str = "mcp",
    ) -> dict:
        actor = Actor(user_id=user_id, username=username, is_admin=True)
        return await _with_session(tools.nutrition_commit_update, actor, proposal_id)

    @mcp.tool
    async def nutrition_upsert(
        product_id: int,
        payload: dict,
        user_id: int = 1,
        username: str = "mcp",
    ) -> dict:
        actor = Actor(user_id=user_id, username=username, is_admin=True)
        return await _with_session(tools.nutrition_upsert, actor, product_id, payload)

    @mcp.tool
    async def nutrition_attach_evidence(
        product_id: int,
        source_type: str,
        photo_path: str | None = None,
        external_url: str | None = None,
        barcode: str | None = None,
        notes: str | None = None,
        user_id: int = 1,
        username: str = "mcp",
    ) -> dict:
        actor = Actor(user_id=user_id, username=username, is_admin=True)
        return await _with_session(
            tools.nutrition_attach_evidence,
            actor,
            product_id,
            source_type,
            photo_path=photo_path,
            external_url=external_url,
            barcode=barcode,
            notes=notes,
        )

    return mcp


TOOL_CATALOG = [
    "products_search",
    "products_get",
    "inventory_list",
    "inventory_purchase",
    "inventory_consume",
    "shopping_list_get",
    "shopping_list_add",
    "recipes_search",
    "nutrition_get",
    "nutrition_propose_update",
    "nutrition_commit_update",
    "nutrition_upsert",
    "nutrition_attach_evidence",
]
