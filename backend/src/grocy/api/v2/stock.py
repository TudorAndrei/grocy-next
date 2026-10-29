from fastapi import APIRouter

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.stock.entries import EntriesView, entries_view, entry_editor
from grocy.domains.stock.journal import (
    JournalSummaryView,
    JournalView,
    journal_summary,
    journal_view,
)
from grocy.domains.stock.transfer import transfer_editor

router = APIRouter(tags=["stock"])


@router.get("/stock/transfer/editor")
async def get_transfer_editor(actor: AuthenticatedActor, session: DbSession) -> dict:
    actor.require("STOCK")
    return await transfer_editor(session)


@router.get("/stock/journal/summary")
async def get_journal_summary(
    actor: AuthenticatedActor,
    session: DbSession,
    product_id: str | None = None,
    user_id: str | None = None,
    transaction_type: str | None = None,
) -> JournalSummaryView:
    actor.require("STOCK")
    return await journal_summary(session, product_id, user_id, transaction_type)


@router.get("/stock/entries/{entry_id}/editor")
async def get_entry_editor(entry_id: int, actor: AuthenticatedActor, session: DbSession) -> dict:
    actor.require("STOCK")
    return await entry_editor(session, entry_id)


@router.get("/stock/entries")
async def get_stock_entries(actor: AuthenticatedActor, session: DbSession) -> EntriesView:
    actor.require("STOCK")
    return await entries_view(session)


@router.get("/stock/journal")
async def get_stock_journal(
    actor: AuthenticatedActor,
    session: DbSession,
    product: str | None = None,
    months: str | None = None,
) -> JournalView:
    actor.require("STOCK")
    return await journal_view(session, product, months)
