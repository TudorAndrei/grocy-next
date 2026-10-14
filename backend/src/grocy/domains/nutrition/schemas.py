from decimal import Decimal
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class BasisUnit(StrEnum):
    G = "g"
    ML = "ml"
    SERVING = "serving"


class SourceType(StrEnum):
    PACKAGING_LABEL = "packaging_label"
    MANUAL = "manual"
    EXTERNAL_DATABASE = "external_database"


class ProposalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CONFLICT = "conflict"


NUTRIENT_FIELDS = (
    "energy_kj",
    "energy_kcal",
    "protein_g",
    "carbohydrates_g",
    "sugars_g",
    "fat_g",
    "saturated_fat_g",
    "fiber_g",
    "salt_g",
)


class NutritionBasis(BaseModel):
    quantity: Decimal = Field(gt=0)
    unit: BasisUnit


class NutritionSource(BaseModel):
    type: SourceType = SourceType.PACKAGING_LABEL
    barcode: str | None = None
    note: str | None = None
    photo_path: str | None = None
    external_url: str | None = None


class Nutrients(BaseModel):
    model_config = ConfigDict(extra="forbid")

    energy_kj: Decimal | None = None
    energy_kcal: Decimal | None = None
    protein_g: Decimal | None = None
    carbohydrates_g: Decimal | None = None
    sugars_g: Decimal | None = None
    fat_g: Decimal | None = None
    saturated_fat_g: Decimal | None = None
    fiber_g: Decimal | None = None
    salt_g: Decimal | None = None

    @field_validator("*", mode="before")
    @classmethod
    def reject_bool(cls, value: Any) -> Any:
        if isinstance(value, bool):
            raise ValueError("boolean is not a valid nutrient value")
        return value

    @field_validator(*NUTRIENT_FIELDS)
    @classmethod
    def non_negative(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("nutrient values must be non-negative")
        return value

    @model_validator(mode="after")
    def check_relationships(self) -> "Nutrients":
        if (
            self.sugars_g is not None
            and self.carbohydrates_g is not None
            and self.sugars_g > self.carbohydrates_g
        ):
            raise ValueError("sugars_g cannot exceed carbohydrates_g on the same basis")
        if (
            self.saturated_fat_g is not None
            and self.fat_g is not None
            and self.saturated_fat_g > self.fat_g
        ):
            raise ValueError("saturated_fat_g cannot exceed fat_g on the same basis")
        return self

    def as_dict(self) -> dict[str, Decimal | None]:
        return {name: getattr(self, name) for name in NUTRIENT_FIELDS}


class NutritionRecord(BaseModel):
    product_id: int
    revision: int
    barcode: str | None = None
    basis_quantity: Decimal
    basis_unit: BasisUnit
    serving_size_quantity: Decimal | None = None
    serving_size_unit: str | None = None
    nutrients: Nutrients
    source: NutritionSource | None = None
    updated_by: int | None = None


class NutritionProposeRequest(BaseModel):
    product_id: int
    expected_revision: int | None = None
    barcode: str | None = None
    basis: NutritionBasis
    nutrients: Nutrients
    source: NutritionSource = Field(default_factory=NutritionSource)
    note: str | None = None
    origin: str = "mcp"


class NutritionUpsertRequest(BaseModel):
    expected_revision: int | None = None
    barcode: str | None = None
    basis: NutritionBasis
    nutrients: Nutrients
    source: NutritionSource = Field(default_factory=lambda: NutritionSource(type=SourceType.MANUAL))
    note: str | None = None
    origin: str = "web"


class NutritionProposalView(BaseModel):
    id: int
    product_id: int
    expected_revision: int | None
    barcode: str | None
    status: ProposalStatus
    conflict_reason: str | None
    payload: NutritionProposeRequest
    created_by: int | None


class NutritionRevisionView(BaseModel):
    id: int
    product_id: int
    revision: int
    barcode: str | None
    basis_quantity: Decimal
    basis_unit: BasisUnit
    nutrients: Nutrients
    origin: str
    review_status: str
    change_summary: str | None
    actor_id: int | None
