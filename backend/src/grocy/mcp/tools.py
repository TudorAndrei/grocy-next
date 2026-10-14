from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.actor import Actor
from grocy.domains.nutrition.schemas import NutritionProposeRequest
from grocy.domains.nutrition.service import NutritionService
from grocy.domains.products.service import ProductsService
from grocy.domains.shopping.service import ShoppingService
from grocy.domains.stock.service import StockService


async def products_search(
    session: AsyncSession,
    query: str,
    limit: int = 25,
) -> list[dict[str, Any]]:
    service = ProductsService(session)
    rows = await service.search(query, limit=limit)
    result: list[dict[str, Any]] = []
    for row in rows:
        amount = await service.stock_amount(row.id)
        result.append(service.serialize(row, stock_amount=amount))
    return result


async def products_get(session: AsyncSession, product_id: int) -> dict[str, Any]:
    service = ProductsService(session)
    product = await service.get(product_id)
    amount = await service.stock_amount(product_id)
    return service.serialize(product, stock_amount=amount)


async def inventory_list(
    session: AsyncSession,
    product_id: int | None = None,
    location_id: int | None = None,
) -> list[dict[str, Any]]:
    return await StockService(session).list_inventory(
        product_id=product_id,
        location_id=location_id,
    )


async def inventory_purchase(
    session: AsyncSession,
    actor: Actor,
    product_id: int,
    amount: float,
    best_before_date: str | None = None,
    price: float | None = None,
    location_id: int | None = None,
) -> dict[str, Any]:
    from datetime import date

    bbd = date.fromisoformat(best_before_date) if best_before_date else None
    return await StockService(session).purchase(
        actor,
        product_id,
        Decimal(str(amount)),
        best_before_date=bbd,
        price=Decimal(str(price)) if price is not None else None,
        location_id=location_id,
    )


async def inventory_consume(
    session: AsyncSession,
    actor: Actor,
    product_id: int,
    amount: float,
    spoiled: bool = False,
    location_id: int | None = None,
) -> dict[str, Any]:
    return await StockService(session).consume(
        actor,
        product_id,
        Decimal(str(amount)),
        spoiled=spoiled,
        location_id=location_id,
    )


async def shopping_list_get(session: AsyncSession, shopping_list_id: int = 1) -> dict[str, Any]:
    return await ShoppingService(session).get_list(shopping_list_id)


async def shopping_list_add(
    session: AsyncSession,
    product_id: int,
    amount: float = 1,
    shopping_list_id: int = 1,
    note: str | None = None,
) -> dict[str, Any]:
    return await ShoppingService(session).add_item(
        product_id,
        Decimal(str(amount)),
        shopping_list_id=shopping_list_id,
        note=note,
    )


async def recipes_search(session: AsyncSession, query: str) -> list[dict[str, Any]]:
    from grocy.domains.recipes.service import RecipesService

    service = RecipesService(session)
    rows = await service.search(query)
    return [service.serialize(row) for row in rows]


async def nutrition_get(
    session: AsyncSession,
    product_id: int,
    barcode: str | None = None,
) -> dict[str, Any] | None:
    record = await NutritionService(session).get(product_id, barcode=barcode)
    return record.model_dump(mode="json") if record else None


async def nutrition_propose_update(
    session: AsyncSession,
    actor: Actor,
    payload: dict[str, Any],
) -> dict[str, Any]:
    proposal = NutritionProposeRequest.model_validate(payload)
    view = await NutritionService(session).propose(actor, proposal)
    return view.model_dump(mode="json")


async def nutrition_commit_update(
    session: AsyncSession,
    actor: Actor,
    proposal_id: int,
) -> dict[str, Any]:
    record = await NutritionService(session).commit(actor, proposal_id)
    return record.model_dump(mode="json")


async def nutrition_upsert(
    session: AsyncSession,
    actor: Actor,
    product_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    from grocy.domains.nutrition.schemas import NutritionUpsertRequest

    body = NutritionUpsertRequest.model_validate(payload)
    record = await NutritionService(session).upsert(actor, product_id, body)
    return record.model_dump(mode="json")


async def nutrition_attach_evidence(
    session: AsyncSession,
    actor: Actor,
    product_id: int,
    source_type: str,
    photo_path: str | None = None,
    external_url: str | None = None,
    barcode: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    current = await NutritionService(session).get(product_id, barcode=barcode)
    if current is None:
        return {"attached": False, "reason": "no current nutrition record"}
    from sqlalchemy import select

    from grocy.db.models.nutrition import NutritionEvidence, ProductNutrition

    stmt = select(ProductNutrition).where(
        ProductNutrition.product_id == product_id,
        ProductNutrition.is_current == 1,
        ProductNutrition.revision == current.revision,
        ProductNutrition.barcode == current.barcode,
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is None:
        return {"attached": False, "reason": "no current nutrition row"}
    evidence = NutritionEvidence(
        nutrition_id=row.id,
        revision=row.revision,
        source_type=source_type,
        photo_path=photo_path,
        external_url=external_url,
        barcode=barcode,
        notes=notes,
        contributor_id=actor.user_id,
    )
    session.add(evidence)
    await session.commit()
    await session.refresh(evidence)
    return {"attached": True, "evidence_id": evidence.id, "revision": row.revision}
