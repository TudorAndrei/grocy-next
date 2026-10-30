"""The pinned spending report reads purchase history, including edited origins."""

from typing import Literal

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import is_iso_date
from grocy.db.compatibility_views import configure_compatibility_queries

Grouping = Literal["product", "productgroup", "store"]


class SpendingRow(BaseModel):
    id: int | None
    name: str | None
    total: float
    group_id: int | None = None
    group_name: str | None = None


class SpendingGroup(BaseModel):
    id: int
    name: str | None


class SpendingsView(BaseModel):
    group_by: Grouping
    rows: list[SpendingRow]
    product_groups: list[SpendingGroup]


async def spendings_view(
    session: AsyncSession,
    start_date: str | None,
    end_date: str | None,
    group_by: str | None,
    product_group: str | None,
) -> SpendingsView:
    await configure_compatibility_queries(session)
    grouping: Grouping = "product"
    if group_by in {"productgroup", "store"}:
        grouping = "productgroup" if group_by == "productgroup" else "store"
    where = "pph.transaction_type != 'self-production'"
    parameters = {}
    if (
        start_date is not None
        and end_date is not None
        and is_iso_date(start_date)
        and is_iso_date(end_date)
    ):
        where += " AND pph.purchased_date BETWEEN :start AND :end"
        parameters.update(start=start_date, end=end_date)
    else:
        # The native default has no upper bound, even for future purchases.
        where += " AND pph.purchased_date >= DATE(DATE('now','localtime'),'start of month')"
    join = "LEFT JOIN product_groups pg ON p.product_group_id=pg.id"
    if grouping == "product":
        fields = "p.id,p.name,pg.id AS group_id,pg.name AS group_name"
        group = "p.id,p.name,pg.id,pg.name"
        order = "p.name"
        if product_group == "ungrouped":
            where += " AND pg.id IS NULL"
        elif product_group is not None and product_group != "all":
            where += " AND pg.id=:product_group"
            parameters["product_group"] = product_group
    elif grouping == "productgroup":
        fields, group, order = "pg.id,pg.name", "pg.id,pg.name", "pg.name"
    else:
        fields, group, order = "sl.id,sl.name", "sl.id,sl.name", "sl.name"
        join = "LEFT JOIN shopping_locations sl ON pph.shopping_location_id=sl.id"
    result = await session.execute(
        text(
            f"SELECT {fields},SUM(pph.amount*pph.price) AS total "
            f"FROM products_price_history pph JOIN products p ON pph.product_id=p.id {join} "
            f"WHERE {where} GROUP BY {group} ORDER BY {order} COLLATE NOCASE"
        ),
        parameters,
    )
    groups = await session.execute(
        text("SELECT id,name FROM product_groups WHERE active=1 ORDER BY name COLLATE NOCASE")
    )
    return SpendingsView(
        group_by=grouping,
        rows=[SpendingRow(**row) for row in result.mappings()],
        product_groups=[SpendingGroup(**row) for row in groups.mappings()],
    )
