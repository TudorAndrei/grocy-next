def register(mcp) -> None:
    @mcp.tool
    async def products_search(query: str) -> list[dict]:
        return []

    @mcp.tool
    async def products_get(product_id: int) -> dict:
        return {"id": product_id, "name": None, "stock": None}

    @mcp.tool
    async def inventory_list(
        product_id: int | None = None,
        location_id: int | None = None,
    ) -> list[dict]:
        return []
