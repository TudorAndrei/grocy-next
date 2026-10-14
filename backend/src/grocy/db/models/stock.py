from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class StockEntry(Base, TimestampMixin):
    __tablename__ = "stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False)
    best_before_date: Mapped[date | None] = mapped_column(Date)
    purchased_date: Mapped[date | None] = mapped_column(Date)
    stock_id: Mapped[str] = mapped_column(String(64), nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    open: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    opened_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    shopping_location_id: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)


class StockLog(Base):
    __tablename__ = "stock_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False)
    best_before_date: Mapped[date | None] = mapped_column(Date)
    purchased_date: Mapped[date | None] = mapped_column(Date)
    used_date: Mapped[date | None] = mapped_column(Date)
    spoiled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stock_id: Mapped[str] = mapped_column(String(64), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(64), nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    undone: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    undone_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    transaction_id: Mapped[str | None] = mapped_column(String(64))
    stock_row_id: Mapped[int | None] = mapped_column(Integer)
    shopping_location_id: Mapped[int | None] = mapped_column(Integer)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, default=1)
    note: Mapped[str | None] = mapped_column(Text)
    undo_data: Mapped[str | None] = mapped_column(Text)
    recipe_id: Mapped[int | None] = mapped_column(ForeignKey("recipes.id"))
    row_created_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )
