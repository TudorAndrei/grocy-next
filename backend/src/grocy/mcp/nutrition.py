from grocy.domains.nutrition.service import NutritionService


def register(mcp) -> None:
    @mcp.tool
    async def nutrition_get(product_id: int) -> dict | None:
        return await NutritionService().get(product_id)

    @mcp.tool
    async def nutrition_propose_update(payload: dict) -> dict:
        return await NutritionService().propose(actor=None, proposal=payload)

    @mcp.tool
    async def nutrition_commit_update(proposal_id: int) -> dict:
        return await NutritionService().commit(actor=None, proposal_id=proposal_id)
