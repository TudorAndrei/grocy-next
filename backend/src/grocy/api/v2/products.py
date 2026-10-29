"""The choices used by the pinned product form."""

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.core.errors import NotFoundError
from grocy.db.compatibility_views import configure_compatibility_queries

router = APIRouter(tags=["products"])


class ResolvedUnit(BaseModel):
    id: int
    name: str | None
    name_plural: str | None
    plural_forms: str | None


class ResolvedConversion(BaseModel):
    id: int
    from_qu_id: int | None
    to_qu_id: int | None
    factor: str | None


class ResolvedProduct(BaseModel):
    id: int
    name: str | None


class ResolvedConversions(BaseModel):
    product: ResolvedProduct | None
    units: list[ResolvedUnit]
    rows: list[ResolvedConversion]


@router.get("/quantity-unit-conversions/resolved")
async def resolved_conversions(
    _actor: AuthenticatedActor, session: DbSession, product: str | None = None
) -> ResolvedConversions:
    selected = None
    if product is not None:
        row = (
            (
                await session.execute(
                    text("SELECT id,name FROM products WHERE id=:id"), {"id": product}
                )
            )
            .mappings()
            .first()
        )
        if row is not None:
            selected = ResolvedProduct(**row)
    # The native page falls back to the global cache when the product lookup is empty.
    where = "product_id=:id" if selected is not None else "product_id IS NULL"
    rows = await session.execute(
        text(
            "SELECT id,from_qu_id,to_qu_id,factor "
            f"FROM cache__quantity_unit_conversions_resolved WHERE {where}"
        ),
        {"id": selected.id} if selected is not None else {},
    )
    units = await session.execute(
        text(
            "SELECT id,name,name_plural,plural_forms FROM quantity_units "
            "WHERE active=1 ORDER BY name COLLATE NOCASE"
        )
    )
    return ResolvedConversions(
        product=selected,
        rows=[ResolvedConversion(**row) for row in rows.mappings()],
        units=[ResolvedUnit(**row) for row in units.mappings()],
    )


class ProductFormConversion(BaseModel):
    from_qu_id: int
    to_qu_id: int
    factor: float


class ProductFormOptions(BaseModel):
    references: dict[str, list[int]]
    parent_disabled: bool
    conversions: list[ProductFormConversion]


@router.get("/products/form-options")
async def product_form_options(
    actor: AuthenticatedActor,
    session: DbSession,
    product_id: int | None = None,
) -> ProductFormOptions:
    actor.require("STOCK")
    parameters = {"id": product_id}
    if product_id is not None and not await session.scalar(
        text("SELECT EXISTS(SELECT 1 FROM products WHERE id=:id)"), parameters
    ):
        raise NotFoundError("Product not found")
    await configure_compatibility_queries(session)

    async def ids(statement: str) -> list[int]:
        return list((await session.scalars(text(statement), parameters)).all())

    connected = (
        "id IN (SELECT to_qu_id FROM cache__quantity_unit_conversions_resolved "
        "WHERE product_id=:id)"
    )
    stock_filter = (
        f"WHERE {connected} OR NOT EXISTS (SELECT 1 FROM stock_log WHERE product_id=:id)"
        if product_id is not None
        else ""
    )
    unit_filter = f"AND {connected}" if product_id is not None else ""
    locations = await ids(
        "SELECT id FROM locations WHERE active=1 ORDER BY name"
        + (" COLLATE NOCASE" if product_id is not None else "")
    )
    units = await ids(
        f"SELECT id FROM quantity_units WHERE active=1 {unit_filter} ORDER BY name COLLATE NOCASE"
    )
    stock_units = await ids(
        f"SELECT id FROM quantity_units {stock_filter} ORDER BY name COLLATE NOCASE"
    )
    parents = await ids(
        "SELECT id FROM products WHERE active=1 AND parent_product_id IS NULL "
        + ("AND id != :id " if product_id is not None else "")
        + "ORDER BY name COLLATE NOCASE"
    )
    parent_disabled = product_id is not None and bool(
        await session.scalar(
            text("SELECT EXISTS(SELECT 1 FROM products WHERE parent_product_id=:id)"), parameters
        )
    )
    conversions = []
    if product_id is not None:
        rows = await session.execute(
            text(
                "SELECT from_qu_id,to_qu_id,factor FROM cache__quantity_unit_conversions_resolved "
                "WHERE product_id=:id"
            ),
            parameters,
        )
        conversions = [ProductFormConversion(**row) for row in rows.mappings()]
    return ProductFormOptions(
        references={
            "location_id": locations,
            "default_consume_location_id": locations,
            "shopping_location_id": await ids(
                "SELECT id FROM shopping_locations WHERE active=1 ORDER BY name COLLATE NOCASE"
            ),
            "product_group_id": await ids(
                "SELECT id FROM product_groups WHERE active=1 ORDER BY name COLLATE NOCASE"
            ),
            "parent_product_id": parents,
            "qu_id_stock": stock_units,
            "qu_id_purchase": units,
            "qu_id_consume": units,
            "qu_id_price": units,
        },
        parent_disabled=parent_disabled,
        conversions=conversions,
    )
