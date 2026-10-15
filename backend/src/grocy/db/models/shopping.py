from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class ShoppingList(Base, TimestampMixin):
    __tablename__ = "shopping_lists"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Shopping list")
    description: Mapped[str | None] = mapped_column(Text)


class ShoppingListItem(Base, TimestampMixin):
    __tablename__ = "shopping_list"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    note: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False, default=Decimal("0"))
    shopping_list_id: Mapped[int] = mapped_column(
        ForeignKey("shopping_lists.id"), nullable=False, default=1
    )
    done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    qu_id: Mapped[int | None] = mapped_column(ForeignKey("quantity_units.id"))
