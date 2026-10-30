"""Product selection and location filters from the native overview page."""

from typing import Any

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import find, loose_equals, php_string, truthy
from grocy.compatibility.sanitizer import render_html
from grocy.core.config import get_settings
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.stock.journal import JournalChoice
from grocy.domains.stock.quantity_label import catalog_quantity_label, quantity_label
from grocy.domains.system.service import localization
from grocy.domains.users.service import UsersService


class OverviewView(BaseModel):
    rows: list[dict[str, Any]]
    locations: list[JournalChoice]
    product_groups: list[JournalChoice]
    show_shopping_icon: bool


async def overview_view(session: AsyncSession, user_id: int, locale: str) -> OverviewView:
    await configure_compatibility_queries(session)
    show_all = await UsersService(session).setting(
        user_id, "stock_overview_show_all_out_of_stock_products"
    )
    where = "1=1" if truthy(show_all) else "is_in_stock_or_below_min_stock=1"
    result = await session.execute(
        text(f"SELECT * FROM uihelper_stock_current_overview WHERE {where}")
    )
    rows = [dict(row) for row in result.mappings()]
    catalog = localization(locale, get_settings().mode)
    units = (
        (await session.execute(text("SELECT * FROM quantity_units WHERE active=1")))
        .mappings()
        .all()
    )
    by_name = {unit["name"]: unit for unit in units}
    value_rows = await session.execute(
        text(
            "SELECT * FROM userfield_values_resolved WHERE entity='products' "
            "ORDER BY name COLLATE NOCASE"
        )
    )
    values = [dict(value) for value in value_rows.mappings()]
    field_names = list(
        await session.scalars(
            text(
                "SELECT name FROM userfields WHERE entity='products' "
                "ORDER BY sort_number,name COLLATE NOCASE"
            )
        )
    )
    for row in rows:
        row["number_text"] = {
            key: php_string(value)
            for key, value in row.items()
            if value is None
            or isinstance(value, (int, float))
            or key in {"product_calories", "min_stock_amount"}
        }
        for key in ("last_price", "average_price"):
            value = row[key]
            row["number_text"][f"{key}_display"] = php_string(
                (value or 0) * float(row["product_qu_factor_price_to_stock"])
            )
        row["unit_label"] = catalog_quantity_label(
            row["amount"], row["qu_stock_name"], row["qu_stock_name_plural"], catalog
        )
        unit = by_name.get(row["qu_stock_name"])
        row["unit_label_aggregated"] = (
            quantity_label(
                row["amount_aggregated"],
                row["qu_stock_name"],
                row["qu_stock_name_plural"],
                unit["plural_forms"] if unit else None,
                1 if unit else 0,
                catalog["plural-forms"],
            )
            if row["is_aggregated_amount"] == 1
            else ""
        )
        row["product_description"] = render_html(row["product_description"] or "")
        product_values = [
            value for value in values if loose_equals(value["object_id"], row["product_id"])
        ]
        row["product_values"] = {
            name: (find(product_values, "name", name) or {}).get("value") for name in field_names
        }

    async def choices(table: str) -> list[JournalChoice]:
        result = await session.execute(
            text(f"SELECT id,name FROM {table} WHERE active=1 ORDER BY name COLLATE NOCASE")
        )
        return [JournalChoice(**row) for row in result.mappings()]

    locations = await choices("locations")
    names = {location.id: location.name for location in locations}
    result = await session.execute(text("SELECT * FROM stock_current_locations"))
    current: dict[int, list[str | None]] = {}
    for location in result.mappings():
        current.setdefault(location["product_id"], []).append(names.get(location["location_id"]))
    for row in rows:
        # The page resolves names from its active list. An inactive or unknown
        # location retains its marker, but has no name or filter choice.
        row["location_names"] = current.get(row["product_id"], [])

    return OverviewView(
        rows=rows,
        locations=locations,
        product_groups=await choices("product_groups"),
        show_shopping_icon=truthy(
            await UsersService(session).setting(
                user_id, "show_icon_on_stock_overview_page_when_product_is_on_shopping_list"
            )
        ),
    )
