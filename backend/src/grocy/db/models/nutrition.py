from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base


class ProductNutrition(Base):
    __tablename__ = "product_nutrition"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(255))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_current: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    basis_quantity: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False)
    basis_unit: Mapped[str] = mapped_column(String(32), nullable=False)
    serving_size_quantity: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    serving_size_unit: Mapped[str | None] = mapped_column(String(32))
    energy_kj: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    energy_kcal: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    protein_g: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    carbohydrates_g: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    sugars_g: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    fat_g: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    saturated_fat_g: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    fiber_g: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    salt_g: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    source_type: Mapped[str | None] = mapped_column(String(64))
    source_barcode: Mapped[str | None] = mapped_column(String(255))
    source_note: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )


class NutritionEvidence(Base):
    __tablename__ = "nutrition_evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nutrition_id: Mapped[int] = mapped_column(ForeignKey("product_nutrition.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    photo_path: Mapped[str | None] = mapped_column(String(1024))
    external_url: Mapped[str | None] = mapped_column(String(1024))
    barcode: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    contributor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )


class NutritionRevision(Base):
    __tablename__ = "nutrition_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    nutrition_id: Mapped[int] = mapped_column(ForeignKey("product_nutrition.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(255))
    basis_quantity: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False)
    basis_unit: Mapped[str] = mapped_column(String(32), nullable=False)
    nutrients_json: Mapped[str] = mapped_column(Text, nullable=False)
    origin: Mapped[str] = mapped_column(String(32), nullable=False)
    review_status: Mapped[str] = mapped_column(String(32), nullable=False, default="committed")
    change_summary: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    evidence_id: Mapped[int | None] = mapped_column(ForeignKey("nutrition_evidence.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )


class NutritionProposal(Base):
    __tablename__ = "nutrition_proposals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    expected_revision: Mapped[int | None] = mapped_column(Integer)
    barcode: Mapped[str | None] = mapped_column(String(255))
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    conflict_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
