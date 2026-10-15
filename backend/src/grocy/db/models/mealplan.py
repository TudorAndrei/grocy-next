from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class MealPlanSection(Base, TimestampMixin):
    __tablename__ = "meal_plan_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    time_info: Mapped[str | None] = mapped_column(String(255))
    time_hms: Mapped[str | None] = mapped_column(String(16))


class MealPlanEntry(Base, TimestampMixin):
    __tablename__ = "meal_plan"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default="recipe")
    recipe_id: Mapped[int | None] = mapped_column(ForeignKey("recipes.id"))
    recipe_servings: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    product_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))
    product_qu_id: Mapped[int | None] = mapped_column(ForeignKey("quantity_units.id"))
    note: Mapped[str | None] = mapped_column(Text)
    section_id: Mapped[int | None] = mapped_column(ForeignKey("meal_plan_sections.id"))
    done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
