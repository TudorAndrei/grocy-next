from fastapi import APIRouter

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.stock.booking_editor import booking_editor
from grocy.domains.stock.consume import consume_editor
from grocy.domains.stock.entries import EntriesView, entries_view, entry_editor
from grocy.domains.stock.journal import (
    JournalSummaryView,
    JournalView,
    journal_summary,
    journal_view,
)
from grocy.domains.stock.location_sheet import LocationSheetView, location_sheet_view
from grocy.domains.stock.spendings import SpendingsView, spendings_view
from grocy.domains.stock.transfer import transfer_editor

router = APIRouter(tags=["stock"])


@router.get("/stock/location-content-sheet")
async def get_location_content_sheet(
    actor: AuthenticatedActor,
    session: DbSession,
    include_out_of_stock: str | None = None,
) -> LocationSheetView:
    return await location_sheet_view(session, include_out_of_stock is not None)


@router.get("/stock/reports/spendings")
async def get_spendings(
    actor: AuthenticatedActor,
    session: DbSession,
    start_date: str | None = None,
    end_date: str | None = None,
    group_by: str | None = None,
    product_group: str | None = None,
) -> SpendingsView:
    return await spendings_view(session, start_date, end_date, group_by, product_group)


@router.get("/stock/consume/editor")
async def get_consume_editor(actor: AuthenticatedActor, session: DbSession) -> dict:
    return await consume_editor(session)


@router.get("/stock/purchase/editor")
async def get_purchase_editor(actor: AuthenticatedActor, session: DbSession) -> dict:
    return await booking_editor(session, include_inactive_units=False)


@router.get("/stock/inventory/editor")
async def get_inventory_editor(actor: AuthenticatedActor, session: DbSession) -> dict:
    return await booking_editor(session, include_inactive_units=True)


@router.get("/stock/transfer/editor")
async def get_transfer_editor(actor: AuthenticatedActor, session: DbSession) -> dict:
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
