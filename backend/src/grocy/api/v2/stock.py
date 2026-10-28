from fastapi import APIRouter

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.stock.journal import JournalView, journal_view

router = APIRouter(tags=["stock"])


@router.get("/stock/journal")
async def get_stock_journal(
    actor: AuthenticatedActor,
    session: DbSession,
    product: str | None = None,
    months: str | None = None,
) -> JournalView:
    actor.require("STOCK")
    return await journal_view(session, product, months)
