"""Rows and filter choices from the pinned stock journal view."""

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import filter_int, loose_equals
from grocy.db.compatibility_views import configure_compatibility_queries

TRANSACTION_TYPES = [
    "consume",
    "inventory-correction",
    "product-opened",
    "purchase",
    "self-production",
    "stock-edit-new",
    "stock-edit-old",
    "transfer_from",
    "transfer_to",
]


class JournalChoice(BaseModel):
    id: int
    name: str | None


class JournalRow(BaseModel):
    id: int
    product_id: int
    product_name: str | None
    amount: float
    qu_name: str | None
    qu_name_plural: str | None
    row_created_timestamp: str | None
    transaction_type: str | None
    location_id: int
    location_name: str | None
    user_display_name: str | None
    note: str | None
    stock_id: str
    spoiled: int
    undone: int
    undone_timestamp: str | None
    correlation_id: str | None
    custom_values: dict[str, str | None] = Field(default_factory=dict)


class JournalView(BaseModel):
    rows: list[JournalRow]
    products: list[JournalChoice]
    locations: list[JournalChoice]
    users: list[JournalChoice]
    transaction_types: list[str]


class JournalSummaryRow(BaseModel):
    product_id: int
    product_name: str | None
    transaction_type: str | None
    user_id: int
    user_display_name: str | None
    qu_name: str | None
    qu_name_plural: str | None
    amount: float


class JournalSummaryView(BaseModel):
    rows: list[JournalSummaryRow]
    products: list[JournalChoice]
    users: list[JournalChoice]
    transaction_types: list[str]


async def journal_summary(
    session: AsyncSession,
    product_id: str | None,
    user_id: str | None,
    transaction_type: str | None,
) -> JournalSummaryView:
    await configure_compatibility_queries(session)
    parameters = {
        key: value
        for key, value in {
            "product_id": product_id,
            "user_id": user_id,
            "transaction_type": transaction_type,
        }.items()
        if value is not None
    }
    # Unlike the journal window, these native controller limits use the
    # original query text with SQLite equality, including empty values.
    where = " AND ".join(f"{key}=:{key}" for key in parameters)
    result = await session.execute(
        text("SELECT * FROM uihelper_stock_journal_summary" + (f" WHERE {where}" if where else "")),
        parameters,
    )
    rows = [JournalSummaryRow(**row) for row in result.mappings()]
    products = await session.execute(
        text("SELECT id,name FROM products WHERE active=1 ORDER BY name COLLATE NOCASE")
    )
    users = await session.execute(text("SELECT id,display_name AS name FROM users_dto"))
    return JournalSummaryView(
        rows=rows,
        products=[JournalChoice(**row) for row in products.mappings()],
        users=[JournalChoice(**row) for row in users.mappings()],
        transaction_types=TRANSACTION_TYPES,
    )


async def journal_view(
    session: AsyncSession, product: str | None, months: str | None
) -> JournalView:
    await configure_compatibility_queries(session)
    # The native controller validates the number, then keeps the original text
    # in SQLite's date modifier (including signs and surrounding whitespace).
    span = months if months is not None and filter_int(months) is not None else "6"
    identity = filter_int(product) if product is not None else None
    parameters: dict[str, str | int] = {"span": f"-{span} months"}
    where = "row_created_timestamp > DATE(DATE('now','localtime'),:span)"
    if identity is not None:
        where += " AND product_id=:product"
        parameters["product"] = identity
    result = await session.execute(
        text(
            f"SELECT * FROM uihelper_stock_journal WHERE {where} "
            "ORDER BY row_created_timestamp DESC"
        ),
        parameters,
    )
    rows = [JournalRow(**row) for row in result.mappings()]
    values = (
        (
            await session.execute(
                text(
                    "SELECT object_id,name,value FROM userfield_values_resolved "
                    "WHERE entity='stock'"
                )
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        row.custom_values = {
            value["name"]: value["value"]
            for value in values
            if loose_equals(value["object_id"], row.stock_id)
        }

    async def choices(statement: str) -> list[JournalChoice]:
        result = await session.execute(text(statement))
        return [JournalChoice(**row) for row in result.mappings()]

    return JournalView(
        rows=rows,
        products=await choices(
            "SELECT id,name FROM products WHERE active=1 ORDER BY name COLLATE NOCASE"
        ),
        locations=await choices("SELECT id,name FROM locations ORDER BY name COLLATE NOCASE"),
        users=await choices("SELECT id,display_name AS name FROM users_dto"),
        transaction_types=TRANSACTION_TYPES,
    )
