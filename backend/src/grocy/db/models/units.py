from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class QuantityUnitConversion(Base, TimestampMixin):
    __tablename__ = "quantity_unit_conversions"
    __table_args__ = (
        UniqueConstraint(
            "from_qu_id",
            "to_qu_id",
            "product_id",
            name="uq_qu_conversion_scope",
        ),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_qu_id: Mapped[int] = mapped_column(ForeignKey("quantity_units.id"), nullable=False)
    to_qu_id: Mapped[int] = mapped_column(ForeignKey("quantity_units.id"), nullable=False)
    factor: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
