from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from grocy.db.models.base import Base, TimestampMixin


class Location(Base, TimestampMixin):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_freezer: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class QuantityUnit(Base, TimestampMixin):
    __tablename__ = "quantity_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    name_plural: Mapped[str | None] = mapped_column(String(255))


class ProductGroup(Base, TimestampMixin):
    __tablename__ = "product_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), nullable=False)
    qu_id_purchase: Mapped[int] = mapped_column(ForeignKey("quantity_units.id"), nullable=False)
    qu_id_stock: Mapped[int] = mapped_column(ForeignKey("quantity_units.id"), nullable=False)
    qu_factor_purchase_to_stock: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("1")
    )
    min_stock_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("0")
    )
    default_best_before_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    product_group_id: Mapped[int | None] = mapped_column(ForeignKey("product_groups.id"))
    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    picture_file_name: Mapped[str | None] = mapped_column(String(255))

    barcodes: Mapped[list["ProductBarcode"]] = relationship(back_populates="product")
    location: Mapped[Location] = relationship()
    product_group: Mapped[ProductGroup | None] = relationship()


class ProductBarcode(Base, TimestampMixin):
    __tablename__ = "product_barcodes"
    __table_args__ = (UniqueConstraint("barcode", name="uq_product_barcodes_barcode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    barcode: Mapped[str] = mapped_column(String(255), nullable=False)
    qu_id: Mapped[int | None] = mapped_column(ForeignKey("quantity_units.id"))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    note: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Product] = relationship(back_populates="barcodes")
