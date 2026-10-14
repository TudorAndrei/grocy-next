from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.actor import Actor
from grocy.core.errors import ConflictError, GrocyError, NotFoundError
from grocy.db.models.catalog import Product
from grocy.db.models.nutrition import (
    NutritionEvidence,
    NutritionProposal,
    NutritionRevision,
    ProductNutrition,
)
from grocy.domains.nutrition.schemas import (
    BasisUnit,
    Nutrients,
    NutritionProposalView,
    NutritionProposeRequest,
    NutritionRecord,
    NutritionRevisionView,
    NutritionSource,
    NutritionUpsertRequest,
    ProposalStatus,
    SourceType,
)


def _decimal_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value))


def _nutrients_from_row(row: ProductNutrition) -> Nutrients:
    return Nutrients(
        energy_kj=row.energy_kj,
        energy_kcal=row.energy_kcal,
        protein_g=row.protein_g,
        carbohydrates_g=row.carbohydrates_g,
        sugars_g=row.sugars_g,
        fat_g=row.fat_g,
        saturated_fat_g=row.saturated_fat_g,
        fiber_g=row.fiber_g,
        salt_g=row.salt_g,
    )


def _record_from_row(row: ProductNutrition) -> NutritionRecord:
    source = None
    if row.source_type:
        source = NutritionSource(
            type=SourceType(row.source_type),
            barcode=row.source_barcode,
            note=row.source_note,
        )
    return NutritionRecord(
        product_id=row.product_id,
        revision=row.revision,
        barcode=row.barcode,
        basis_quantity=row.basis_quantity,
        basis_unit=BasisUnit(row.basis_unit),
        serving_size_quantity=row.serving_size_quantity,
        serving_size_unit=row.serving_size_unit,
        nutrients=_nutrients_from_row(row),
        source=source,
        updated_by=row.updated_by,
    )


class NutritionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _require_product(self, product_id: int) -> Product:
        product = await self.session.get(Product, product_id)
        if product is None:
            raise NotFoundError(f"Product {product_id} not found")
        return product

    async def _current(
        self,
        product_id: int,
        *,
        barcode: str | None = None,
        basis_unit: str | None = None,
    ) -> ProductNutrition | None:
        stmt = select(ProductNutrition).where(
            ProductNutrition.product_id == product_id,
            ProductNutrition.is_current == 1,
        )
        if barcode is None:
            stmt = stmt.where(ProductNutrition.barcode.is_(None))
        else:
            stmt = stmt.where(ProductNutrition.barcode == barcode)
        if basis_unit is not None:
            stmt = stmt.where(ProductNutrition.basis_unit == basis_unit)
        result = await self.session.execute(stmt.order_by(ProductNutrition.id.desc()))
        return result.scalars().first()

    async def get(
        self,
        product_id: int,
        *,
        barcode: str | None = None,
        basis_unit: str | None = None,
    ) -> NutritionRecord | None:
        await self._require_product(product_id)
        row = await self._current(product_id, barcode=barcode, basis_unit=basis_unit)
        if row is None and barcode is not None:
            row = await self._current(product_id, barcode=None, basis_unit=basis_unit)
        return _record_from_row(row) if row else None

    async def propose(
        self,
        actor: Actor,
        proposal: NutritionProposeRequest,
    ) -> NutritionProposalView:
        await self._require_product(proposal.product_id)
        current = await self._current(
            proposal.product_id,
            barcode=proposal.barcode,
            basis_unit=proposal.basis.unit.value,
        )
        status = ProposalStatus.PENDING
        conflict_reason = None
        if proposal.expected_revision is not None:
            current_revision = current.revision if current else 0
            if proposal.expected_revision != current_revision:
                status = ProposalStatus.CONFLICT
                conflict_reason = (
                    f"expected revision {proposal.expected_revision}, "
                    f"current is {current_revision}"
                )
        row = NutritionProposal(
            product_id=proposal.product_id,
            expected_revision=proposal.expected_revision,
            barcode=proposal.barcode,
            payload_json=proposal.model_dump_json(),
            status=status.value,
            conflict_reason=conflict_reason,
            created_by=actor.user_id,
        )
        self.session.add(row)
        await self.session.commit()
        await self.session.refresh(row)
        return self._proposal_view(row)

    async def list_proposals(
        self,
        *,
        status: ProposalStatus | None = ProposalStatus.PENDING,
        product_id: int | None = None,
    ) -> list[NutritionProposalView]:
        stmt = select(NutritionProposal).order_by(NutritionProposal.id.desc())
        if status is not None:
            stmt = stmt.where(NutritionProposal.status == status.value)
        if product_id is not None:
            stmt = stmt.where(NutritionProposal.product_id == product_id)
        rows = (await self.session.execute(stmt)).scalars().all()
        return [self._proposal_view(row) for row in rows]

    async def commit(self, actor: Actor, proposal_id: int) -> NutritionRecord:
        row = await self.session.get(NutritionProposal, proposal_id)
        if row is None:
            raise NotFoundError(f"Proposal {proposal_id} not found")
        if row.status == ProposalStatus.CONFLICT.value:
            raise ConflictError(row.conflict_reason or "Proposal has a revision conflict")
        if row.status != ProposalStatus.PENDING.value:
            raise GrocyError(f"Proposal is {row.status}", status_code=400, code="invalid_state")
        payload = NutritionProposeRequest.model_validate_json(row.payload_json)
        record = await self._write(
            actor=actor,
            product_id=payload.product_id,
            barcode=payload.barcode,
            basis_quantity=payload.basis.quantity,
            basis_unit=payload.basis.unit,
            nutrients=payload.nutrients,
            source=payload.source,
            note=payload.note,
            expected_revision=payload.expected_revision,
            origin=payload.origin,
        )
        row.status = ProposalStatus.APPROVED.value
        row.approved_by = actor.user_id
        row.decided_at = datetime.now()
        await self.session.commit()
        return record

    async def reject(
        self,
        actor: Actor,
        proposal_id: int,
        reason: str | None = None,
    ) -> NutritionProposalView:
        row = await self.session.get(NutritionProposal, proposal_id)
        if row is None:
            raise NotFoundError(f"Proposal {proposal_id} not found")
        if row.status != ProposalStatus.PENDING.value:
            raise GrocyError(f"Proposal is {row.status}", status_code=400, code="invalid_state")
        row.status = ProposalStatus.REJECTED.value
        row.approved_by = actor.user_id
        row.decided_at = datetime.now()
        row.conflict_reason = reason
        await self.session.commit()
        await self.session.refresh(row)
        return self._proposal_view(row)

    async def upsert(
        self,
        actor: Actor,
        product_id: int,
        body: NutritionUpsertRequest,
    ) -> NutritionRecord:
        return await self._write(
            actor=actor,
            product_id=product_id,
            barcode=body.barcode,
            basis_quantity=body.basis.quantity,
            basis_unit=body.basis.unit,
            nutrients=body.nutrients,
            source=body.source,
            note=body.note,
            expected_revision=body.expected_revision,
            origin=body.origin,
        )

    async def revisions(self, product_id: int) -> list[NutritionRevisionView]:
        await self._require_product(product_id)
        stmt = (
            select(NutritionRevision)
            .where(NutritionRevision.product_id == product_id)
            .order_by(NutritionRevision.revision.desc(), NutritionRevision.id.desc())
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        views: list[NutritionRevisionView] = []
        for row in rows:
            nutrients = Nutrients.model_validate_json(row.nutrients_json)
            views.append(
                NutritionRevisionView(
                    id=row.id,
                    product_id=row.product_id,
                    revision=row.revision,
                    barcode=row.barcode,
                    basis_quantity=row.basis_quantity,
                    basis_unit=BasisUnit(row.basis_unit),
                    nutrients=nutrients,
                    origin=row.origin,
                    review_status=row.review_status,
                    change_summary=row.change_summary,
                    actor_id=row.actor_id,
                )
            )
        return views

    async def restore(
        self,
        actor: Actor,
        product_id: int,
        revision: int,
    ) -> NutritionRecord:
        stmt = select(NutritionRevision).where(
            NutritionRevision.product_id == product_id,
            NutritionRevision.revision == revision,
        )
        row = (await self.session.execute(stmt)).scalars().first()
        if row is None:
            raise NotFoundError(f"Revision {revision} not found for product {product_id}")
        nutrients = Nutrients.model_validate_json(row.nutrients_json)
        return await self._write(
            actor=actor,
            product_id=product_id,
            barcode=row.barcode,
            basis_quantity=row.basis_quantity,
            basis_unit=BasisUnit(row.basis_unit),
            nutrients=nutrients,
            source=NutritionSource(
                type=SourceType.MANUAL,
                note=f"restored from revision {revision}",
            ),
            note=f"restored from revision {revision}",
            expected_revision=None,
            origin="restore",
        )

    async def _write(
        self,
        *,
        actor: Actor,
        product_id: int,
        barcode: str | None,
        basis_quantity: Decimal,
        basis_unit: BasisUnit,
        nutrients: Nutrients,
        source: NutritionSource,
        note: str | None,
        expected_revision: int | None,
        origin: str,
    ) -> NutritionRecord:
        await self._require_product(product_id)
        current = await self._current(
            product_id,
            barcode=barcode,
            basis_unit=basis_unit.value,
        )
        current_revision = current.revision if current else 0
        if expected_revision is not None and expected_revision != current_revision:
            raise ConflictError(
                f"expected revision {expected_revision}, current is {current_revision}"
            )
        next_revision = current_revision + 1
        if current is not None:
            await self.session.execute(
                update(ProductNutrition)
                .where(ProductNutrition.id == current.id)
                .values(is_current=0)
            )
        values = nutrients.as_dict()
        row = ProductNutrition(
            product_id=product_id,
            barcode=barcode,
            revision=next_revision,
            is_current=1,
            basis_quantity=basis_quantity,
            basis_unit=basis_unit.value,
            energy_kj=values["energy_kj"],
            energy_kcal=values["energy_kcal"],
            protein_g=values["protein_g"],
            carbohydrates_g=values["carbohydrates_g"],
            sugars_g=values["sugars_g"],
            fat_g=values["fat_g"],
            saturated_fat_g=values["saturated_fat_g"],
            fiber_g=values["fiber_g"],
            salt_g=values["salt_g"],
            source_type=source.type.value,
            source_barcode=source.barcode,
            source_note=note or source.note,
            updated_by=actor.user_id,
            updated_at=datetime.now(),
        )
        self.session.add(row)
        await self.session.flush()
        evidence = NutritionEvidence(
            nutrition_id=row.id,
            revision=next_revision,
            source_type=source.type.value,
            photo_path=source.photo_path,
            external_url=source.external_url,
            barcode=source.barcode or barcode,
            notes=note or source.note,
            contributor_id=actor.user_id,
        )
        self.session.add(evidence)
        await self.session.flush()
        revision = NutritionRevision(
            product_id=product_id,
            nutrition_id=row.id,
            revision=next_revision,
            barcode=barcode,
            basis_quantity=basis_quantity,
            basis_unit=basis_unit.value,
            nutrients_json=json.dumps(values, default=_decimal_default),
            origin=origin,
            review_status="committed",
            change_summary=note,
            actor_id=actor.user_id,
            evidence_id=evidence.id,
        )
        self.session.add(revision)
        await self.session.commit()
        await self.session.refresh(row)
        return _record_from_row(row)

    def _proposal_view(self, row: NutritionProposal) -> NutritionProposalView:
        return NutritionProposalView(
            id=row.id,
            product_id=row.product_id,
            expected_revision=row.expected_revision,
            barcode=row.barcode,
            status=ProposalStatus(row.status),
            conflict_reason=row.conflict_reason,
            payload=NutritionProposeRequest.model_validate_json(row.payload_json),
            created_by=row.created_by,
        )
