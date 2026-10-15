from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from grocy.db.models.base import Base, TimestampMixin


class Recipe(Base, TimestampMixin):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    base_servings: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("1")
    )
    desired_servings: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("1")
    )
    not_check_stock_fulfillment: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default="normal")

    picture_file_name: Mapped[str | None] = mapped_column(String(255))
    not_check_shoppinglist: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))

    positions: Mapped[list["RecipePosition"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
    )


class RecipePosition(Base, TimestampMixin):
    __tablename__ = "recipes_pos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False)
    qu_id: Mapped[int] = mapped_column(ForeignKey("quantity_units.id"), nullable=False)
    only_check_single_unit_in_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ingredient_group: Mapped[str | None] = mapped_column(String(255))
    note: Mapped[str | None] = mapped_column(Text)
    not_check_stock_fulfillment: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    variable_amount: Mapped[str | None] = mapped_column(String(255))

    price_factor: Mapped[Decimal] = mapped_column(
        Numeric(15, 6), nullable=False, default=Decimal("1")
    )
    round_up: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    recipe: Mapped[Recipe] = relationship(back_populates="positions")


class RecipeNesting(Base, TimestampMixin):
    __tablename__ = "recipes_nestings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"), nullable=False)
    includes_recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"), nullable=False)
    servings: Mapped[Decimal] = mapped_column(Numeric(15, 6), nullable=False, default=Decimal("1"))
