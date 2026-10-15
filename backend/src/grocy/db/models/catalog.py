from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from grocy.db.models.base import Base, TimestampMixin


class Location(Base, TimestampMixin):
    __tablename__ = "locations"
    __table_args__ = ({"sqlite_autoincrement": True},)

    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_freezer: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class QuantityUnit(Base, TimestampMixin):
    __tablename__ = "quantity_units"
    __table_args__ = ({"sqlite_autoincrement": True},)

    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    name_plural: Mapped[str | None] = mapped_column(String(255))
    plural_forms: Mapped[str | None] = mapped_column(Text)


class ProductGroup(Base, TimestampMixin):
    __tablename__ = "product_groups"
    __table_args__ = ({"sqlite_autoincrement": True},)

    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = ({"sqlite_autoincrement": True},)

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

    parent_product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    shopping_location_id: Mapped[int | None] = mapped_column(Integer)
    default_consume_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    tare_weight: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("0")
    )
    default_best_before_days_after_open: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    enable_tare_weight_handling: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    not_check_stock_fulfillment_for_recipes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    treat_opened_as_out_of_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    auto_reprint_stock_label: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    no_own_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    should_not_be_frozen: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    move_on_open: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    default_best_before_days_after_freezing: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    default_best_before_days_after_thawing: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    calories: Mapped[float | None] = mapped_column(Integer)
    cumulate_min_stock_amount_of_sub_products: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    due_type: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    quick_consume_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("1")
    )
    quick_open_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("1")
    )
    hide_on_stock_overview: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    default_stock_label_type: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    qu_id_consume: Mapped[int | None] = mapped_column(ForeignKey("quantity_units.id"))
    qu_id_price: Mapped[int | None] = mapped_column(ForeignKey("quantity_units.id"))
    disable_open: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    default_purchase_price_type: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    barcodes: Mapped[list["ProductBarcode"]] = relationship(back_populates="product")
    location: Mapped[Location] = relationship(foreign_keys=[location_id])
    product_group: Mapped[ProductGroup | None] = relationship()


class ProductBarcode(Base, TimestampMixin):
    __tablename__ = "product_barcodes"
    __table_args__ = (
        UniqueConstraint("barcode", name="uq_product_barcodes_barcode"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    barcode: Mapped[str] = mapped_column(String(255), nullable=False)
    qu_id: Mapped[int | None] = mapped_column(ForeignKey("quantity_units.id"))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    note: Mapped[str | None] = mapped_column(Text)
    shopping_location_id: Mapped[int | None] = mapped_column(Integer)
    last_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))

    product: Mapped[Product] = relationship(back_populates="barcodes")


class ShoppingLocation(Base, TimestampMixin):
    __tablename__ = "shopping_locations"
    __table_args__ = ({"sqlite_autoincrement": True},)
    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
