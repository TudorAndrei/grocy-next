"""Product selection and location filters from the native overview page."""

from typing import Any

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import truthy
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.stock.journal import JournalChoice
from grocy.domains.users.service import UsersService


class OverviewView(BaseModel):
    rows: list[dict[str, Any]]
    locations: list[JournalChoice]
    product_groups: list[JournalChoice]


async def overview_view(session: AsyncSession, user_id: int) -> OverviewView:
    await configure_compatibility_queries(session)
    show_all = await UsersService(session).setting(
        user_id, "stock_overview_show_all_out_of_stock_products"
    )
    where = "1=1" if truthy(show_all) else "is_in_stock_or_below_min_stock=1"
    result = await session.execute(
        text(f"SELECT * FROM uihelper_stock_current_overview WHERE {where}")
    )
    rows = [dict(row) for row in result.mappings()]

    async def choices(table: str) -> list[JournalChoice]:
        result = await session.execute(
            text(f"SELECT id,name FROM {table} WHERE active=1 ORDER BY name COLLATE NOCASE")
        )
        return [JournalChoice(**row) for row in result.mappings()]

    locations = await choices("locations")
    names = {location.id: location.name for location in locations}
    result = await session.execute(text("SELECT * FROM stock_current_locations"))
    current: dict[int, list[str | None]] = {}
    for location in result.mappings():
        current.setdefault(location["product_id"], []).append(names.get(location["location_id"]))
    for row in rows:
        # The page resolves names from its active list. An inactive or unknown
        # location retains its marker, but has no name or filter choice.
        row["location_names"] = current.get(row["product_id"], [])

    return OverviewView(
        rows=rows, locations=locations, product_groups=await choices("product_groups")
    )
