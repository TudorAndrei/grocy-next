from typing import Annotated

from fastapi import APIRouter, Query

from grocy.core.auth import CurrentActor
from grocy.core.deps import NutritionSvc
from grocy.core.errors import NotFoundError
from grocy.domains.nutrition.schemas import (
    NutritionProposalView,
    NutritionProposeRequest,
    NutritionRecord,
    NutritionRevisionView,
    NutritionUpsertRequest,
    ProposalStatus,
)

router = APIRouter(tags=["nutrition"])


@router.get("/products/{product_id}/nutrition", response_model=NutritionRecord)
async def get_nutrition(
    product_id: int,
    _actor: CurrentActor,
    nutrition: NutritionSvc,
    barcode: Annotated[str | None, Query()] = None,
) -> NutritionRecord:
    record = await nutrition.get(product_id, barcode=barcode)
    if record is None:
        raise NotFoundError(f"No nutrition record for product {product_id}")
    return record


@router.put("/products/{product_id}/nutrition", response_model=NutritionRecord)
async def upsert_nutrition(
    product_id: int,
    body: NutritionUpsertRequest,
    actor: CurrentActor,
    nutrition: NutritionSvc,
) -> NutritionRecord:
    return await nutrition.upsert(actor, product_id, body)


@router.get(
    "/products/{product_id}/nutrition/revisions",
    response_model=list[NutritionRevisionView],
)
async def list_revisions(
    product_id: int,
    _actor: CurrentActor,
    nutrition: NutritionSvc,
) -> list[NutritionRevisionView]:
    return await nutrition.revisions(product_id)


@router.post(
    "/products/{product_id}/nutrition/revisions/{revision}/restore",
    response_model=NutritionRecord,
)
async def restore_revision(
    product_id: int,
    revision: int,
    actor: CurrentActor,
    nutrition: NutritionSvc,
) -> NutritionRecord:
    return await nutrition.restore(actor, product_id, revision)


@router.post("/nutrition/proposals", response_model=NutritionProposalView)
async def create_proposal(
    body: NutritionProposeRequest,
    actor: CurrentActor,
    nutrition: NutritionSvc,
) -> NutritionProposalView:
    return await nutrition.propose(actor, body)


@router.get("/nutrition/proposals", response_model=list[NutritionProposalView])
async def list_proposals(
    _actor: CurrentActor,
    nutrition: NutritionSvc,
    status: Annotated[ProposalStatus | None, Query()] = ProposalStatus.PENDING,
    product_id: Annotated[int | None, Query()] = None,
) -> list[NutritionProposalView]:
    return await nutrition.list_proposals(status=status, product_id=product_id)


@router.post("/nutrition/proposals/{proposal_id}/approve", response_model=NutritionRecord)
async def approve_proposal(
    proposal_id: int,
    actor: CurrentActor,
    nutrition: NutritionSvc,
) -> NutritionRecord:
    return await nutrition.commit(actor, proposal_id)


@router.post("/nutrition/proposals/{proposal_id}/reject", response_model=NutritionProposalView)
async def reject_proposal(
    proposal_id: int,
    actor: CurrentActor,
    nutrition: NutritionSvc,
    reason: str | None = None,
) -> NutritionProposalView:
    return await nutrition.reject(actor, proposal_id, reason=reason)
