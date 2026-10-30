"""Stock entry rows and active lookup lists used by the legacy page."""

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import loose_equals
from grocy.core.errors import NotFoundError
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.catalog.objects import GenericObjectsService
from grocy.domains.stock.journal import JournalChoice


class EntryRow(BaseModel):
    id: int
    product_id: int
    stock_id: str
    amount: float
    best_before_date: str | None
    purchased_date: str | None
    row_created_timestamp: str | None
    price: float | None
    open: int
    location_id: int
    shopping_location_id: int | None
    note: str | None
    qu_factor_price_to_stock: float
    qu_factor_purchase_to_stock: float
    product_name: str | None
    qu_name: str | None
    qu_name_plural: str | None
    price_qu_name: str | None
    purchase_qu_name: str | None
    location_name: str | None
    shopping_location_name: str | None
    enable_tare_weight_handling: int | None
    disable_open: int | None
    due_type: int | None
    product_values: dict[str, str | None] = Field(default_factory=dict)
    stock_values: dict[str, str | None] = Field(default_factory=dict)


class EntriesView(BaseModel):
    rows: list[EntryRow]
    products: list[JournalChoice]
    locations: list[JournalChoice]
    stores: list[JournalChoice]


async def entry_editor(session: AsyncSession, entry_id: int) -> dict:
    await configure_compatibility_queries(session)
    result = await session.execute(
        text(
            "SELECT s.*,p.name AS product_name,q.name AS qu_name FROM stock s "
            "JOIN products p ON p.id=s.product_id "
            "LEFT JOIN quantity_units q ON q.id=p.qu_id_stock WHERE s.id=:id"
        ),
        {"id": entry_id},
    )
    entry = result.mappings().first()
    if entry is None:
        raise NotFoundError(f"Stock entry {entry_id} not found")

    async def rows(sql: str) -> list[dict]:
        result = await session.execute(text(sql))
        return [dict(row) for row in result.mappings()]

    return {
        "entry": dict(entry),
        "locations": await rows(
            "SELECT id,name FROM locations WHERE active=1 ORDER BY name COLLATE NOCASE"
        ),
        "stores": await rows(
            "SELECT id,name FROM shopping_locations WHERE active=1 ORDER BY name COLLATE NOCASE"
        ),
        "fields": await rows(
            "SELECT id,name,caption,type,input_required,default_value,config "
            "FROM userfields WHERE entity='stock' ORDER BY sort_number,name COLLATE NOCASE"
        ),
        "values": await GenericObjectsService(session).get_userfields("stock", entry["stock_id"]),
    }


async def entries_view(session: AsyncSession) -> EntriesView:
    await configure_compatibility_queries(session)
    # The template resolves display names against active lists. An inactive
    # reference keeps its stock row but has no display name or filter choice.
    result = await session.execute(
        text(
            "SELECT e.id,e.product_id,e.stock_id,e.amount,e.best_before_date,e.purchased_date,"
            "e.row_created_timestamp,e.price,e.open,e.location_id,e.shopping_location_id,"
            "e.note,e.qu_factor_price_to_stock,e.qu_factor_purchase_to_stock,"
            "p.name AS product_name,p.enable_tare_weight_handling,"
            "p.disable_open,p.due_type,q.name AS qu_name,q.name_plural AS qu_name_plural,"
            "pq.name AS price_qu_name,bq.name AS purchase_qu_name,l.name AS location_name,"
            "sl.name AS shopping_location_name FROM uihelper_stock_entries e "
            "LEFT JOIN products p ON p.id=e.product_id AND p.active=1 "
            "LEFT JOIN quantity_units q ON q.id=p.qu_id_stock AND q.active=1 "
            "LEFT JOIN quantity_units pq ON pq.id=p.qu_id_price AND pq.active=1 "
            "LEFT JOIN quantity_units bq ON bq.id=p.qu_id_purchase AND bq.active=1 "
            "LEFT JOIN locations l ON l.id=e.location_id AND l.active=1 "
            "LEFT JOIN shopping_locations sl ON sl.id=e.shopping_location_id AND sl.active=1 "
            "ORDER BY e.product_id"
        )
    )
    rows = [EntryRow(**row) for row in result.mappings()]
    values = (
        (
            await session.execute(
                text(
                    "SELECT entity,object_id,name,value FROM userfield_values_resolved "
                    "WHERE entity IN ('products','stock')"
                )
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        row.product_values = {
            value["name"]: value["value"]
            for value in values
            if value["entity"] == "products" and loose_equals(value["object_id"], row.product_id)
        }
        row.stock_values = {
            value["name"]: value["value"]
            for value in values
            if value["entity"] == "stock" and loose_equals(value["object_id"], row.stock_id)
        }

    async def choices(table: str) -> list[JournalChoice]:
        result = await session.execute(
            text(f"SELECT id,name FROM {table} WHERE active=1 ORDER BY name COLLATE NOCASE")
        )
        return [JournalChoice(**row) for row in result.mappings()]

    return EntriesView(
        rows=rows,
        products=await choices("products"),
        locations=await choices("locations"),
        stores=await choices("shopping_locations"),
    )
