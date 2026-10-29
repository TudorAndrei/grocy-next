from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.dates import NativeDate
from grocy.db.grocy_checks import native_checks
from grocy.db.models.base import Base, TimestampMixin
from grocy.db.types import DateOrDateTime


class StockEntry(Base, TimestampMixin):
    __tablename__ = "stock"
    __table_args__ = (
        Index("ix_stock_performance1", "product_id", "open", "best_before_date", "amount"),
        *native_checks("stock"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False)
    best_before_date: Mapped[date | None] = mapped_column(NativeDate)
    purchased_date: Mapped[date | None] = mapped_column(NativeDate)
    stock_id: Mapped[str] = mapped_column(String(64), nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    open: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    opened_date: Mapped[date | datetime | None] = mapped_column(DateOrDateTime)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    shopping_location_id: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)


class StockLog(Base):
    __tablename__ = "stock_log"
    __table_args__ = (
        *native_checks("stock_log"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False)
    best_before_date: Mapped[date | None] = mapped_column(NativeDate)
    purchased_date: Mapped[date | None] = mapped_column(NativeDate)
    used_date: Mapped[date | None] = mapped_column(NativeDate)
    spoiled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stock_id: Mapped[str] = mapped_column(String(64), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(64), nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    undone: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    undone_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    opened_date: Mapped[date | datetime | None] = mapped_column(DateOrDateTime)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    transaction_id: Mapped[str | None] = mapped_column(String(64))
    stock_row_id: Mapped[int | None] = mapped_column(Integer)
    shopping_location_id: Mapped[int | None] = mapped_column(Integer)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    note: Mapped[str | None] = mapped_column(Text)
    undo_data: Mapped[str | None] = mapped_column(Text)
    recipe_id: Mapped[int | None] = mapped_column(ForeignKey("recipes.id"))
    row_created_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=True,
    )


class CachedAveragePrice(Base):
    __tablename__ = "cache__products_average_price"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))


class CachedLastPurchase(Base):
    __tablename__ = "cache__products_last_purchased"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    best_before_date: Mapped[date | None] = mapped_column(NativeDate)
    purchased_date: Mapped[date | None] = mapped_column(NativeDate)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    location_id: Mapped[int | None] = mapped_column(Integer)
    shopping_location_id: Mapped[int | None] = mapped_column(Integer)
