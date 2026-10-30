"""The native location sheet groups own stock, including inactive locations."""

from typing import Any

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import php_string
from grocy.core.config import get_settings
from grocy.domains.stock.quantity_label import quantity_label
from grocy.domains.system.service import localization


class LocationSheetProduct(BaseModel):
    id: int
    name: str | None
    amount: float
    amount_opened: float
    amount_text: str
    amount_opened_text: str
    unit_label: str
    unit_name: str | None
    unit_name_plural: str | None
    unit_plural_forms: str | None
    unit_active: int | None


class LocationSheetLocation(BaseModel):
    id: int
    name: str | None
    products: list[LocationSheetProduct]


class LocationSheetView(BaseModel):
    locations: list[LocationSheetLocation]


async def location_sheet_view(
    session: AsyncSession, include_out_of_stock: bool, locale: str
) -> LocationSheetView:
    join = "LEFT JOIN" if include_out_of_stock else "JOIN"
    result = await session.execute(
        text(
            "SELECT IFNULL(s.location_id,p.location_id) AS location_id,"
            "p.id,p.name,IFNULL(s.amount,0) AS amount,"
            "IFNULL(s.amount_opened,0) AS amount_opened,"
            "qu.name AS unit_name,qu.name_plural AS unit_name_plural,"
            "qu.plural_forms AS unit_plural_forms,qu.active AS unit_active "
            f"FROM products p {join} stock_current_location_content s ON s.product_id=p.id "
            "LEFT JOIN quantity_units qu ON qu.id=p.qu_id_stock "
            "WHERE p.active=1 ORDER BY p.name"
        )
    )
    header = localization(locale, get_settings().mode)["plural-forms"]

    def product(row: Any) -> LocationSheetProduct:
        return LocationSheetProduct(
            **row,
            amount_text=php_string(row["amount"]),
            amount_opened_text=php_string(row["amount_opened"]),
            unit_label=quantity_label(
                row["amount"],
                row["unit_name"],
                row["unit_name_plural"],
                row["unit_plural_forms"],
                row["unit_active"],
                header,
            ),
        )

    products: dict[int | None, list[Any]] = {}
    for row in result.mappings():
        products.setdefault(row["location_id"], []).append(row)
    locations = await session.execute(
        text("SELECT id,name FROM locations ORDER BY name COLLATE NOCASE")
    )
    return LocationSheetView(
        locations=[
            LocationSheetLocation(
                id=row.id, name=row.name, products=[product(p) for p in products[row.id]]
            )
            for row in locations
            if row.id in products
        ]
    )
