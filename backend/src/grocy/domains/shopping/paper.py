"""The two native shopping paper layouts and their displayed custom fields."""

import base64
import binascii
import json
import re
from functools import lru_cache
from html import escape
from math import ceil
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility import client_defaults
from grocy.compatibility.php import empty, loose_equals, numeric_value, php_string, truthy
from grocy.compatibility.sanitizer import render_html
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, NotFoundError
from grocy.domains.files.service import FilesService
from grocy.domains.print_assets import print_font_styles
from grocy.domains.system.service import localization

_ASSETS = Path(__file__).parents[2] / "_vendor" / "shopping-print"


@lru_cache
def _styles() -> str:
    css = "\n".join(
        (_ASSETS / name).read_text(encoding="utf-8-sig")
        for name in ("bootstrap.css", "datatables.css", "rowgroup.css", "menu.css", "grocy.css")
    )
    icon = base64.b64encode((_ASSETS / "solid.woff2").read_bytes()).decode()
    return (
        css
        + print_font_styles((400, 500, 700))
        + f"""
@font-face {{font-family:'Font Awesome 6 Free';font-weight:900;
src:url(data:font/woff2;base64,{icon}) format('woff2')}}
.fa-check {{font-family:'Font Awesome 6 Free';font-style:normal;font-weight:900}}
.fa-check:before {{content:'\\f00c'}}
table.dataTable>thead>tr>th[class*="sort"]:before,
table.dataTable>thead>tr>th[class*="sort"]:after {{content:""!important}}
@media print {{@page {{size:auto}}}}
"""
    )


def _multiline(value: Any) -> str:
    return re.sub(r"\r\n|\r|\n", "<br>", render_html(php_string(value)))


def _filename(value: str) -> str:
    part = value.split("_")[1] if "_" in value else ""
    try:
        return base64.b64decode(part + "=" * (-len(part) % 4)).decode(errors="replace")
    except binascii.Error:
        return ""


async def _field_html(field: dict, value: Any, base_url: str) -> str:
    if value is None:
        return ""
    kind = field["type"]
    raw = php_string(value)
    if kind == "checkbox":
        return '<i class="fa-check"></i>' if loose_equals(value, 1) else ""
    if kind == "preset-checklist":
        return render_html(raw.replace(",", "<br>"))
    if kind in {"number-decimal", "number-currency"}:
        form = "currency" if kind == "number-currency" else "generic"
        return f'<span data-number="{form}">{escape(raw)}</span>'
    if kind == "link-with-title":
        try:
            data = json.loads(raw)
        except ValueError:
            data = None
        link, title = (
            (data.get("link"), data.get("title")) if isinstance(data, dict) else (None, None)
        )
        return render_html(
            f'<a href="{escape(php_string(link))}" target="_blank">{escape(php_string(title))}</a>'
        )
    if kind == "link":
        return render_html(f'<a href="{escape(raw)}" target="_blank">{escape(raw)}</a>')
    if kind in {"file", "image"} and not empty(value):
        link = base_url + "/files/userfiles/" + quote(raw, safe="")
        name = escape(_filename(raw))
        if kind == "file":
            return f'<a href="{escape(link)}" target="_blank">{name}</a>'
        image = link + "?force_serve_as=picture&best_fit_width=32&best_fit_height=32"
        try:
            response = await FilesService(compatibility=True).get(
                "userfiles",
                base64.b64encode(raw.encode()).decode(),
                picture=True,
                width="32",
                height="32",
            )
            if isinstance(response, StreamingResponse):
                chunks = [
                    part.encode() if isinstance(part, str) else bytes(part)
                    async for part in response.body_iterator
                ]
                image = (
                    "data:"
                    + response.headers["Content-Type"]
                    + ";base64,"
                    + base64.b64encode(b"".join(chunks)).decode()
                )
        except GrocyError:
            pass
        return (
            f'<a href="{escape(link)}?force_serve_as=picture">'
            f'<img src="{escape(image)}" title="{name}" alt="{name}"></a>'
        )
    return escape(raw)


class ShoppingPaper:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def _rows(self, sql: str, **parameters: Any) -> list[dict]:
        rows = await self.session.execute(text(sql), parameters)
        return [dict(row) for row in rows.mappings()]

    async def document(
        self,
        list_id: int,
        user_id: int,
        locale: str,
        *,
        header: bool,
        grouped: bool,
        layout: str,
        base_url: str,
    ) -> str:
        lists = await self._rows("SELECT * FROM shopping_lists_view WHERE id=:id", id=list_id)
        if not lists:
            raise NotFoundError(f"Shopping list {list_id} not found")
        shopping = lists[0]
        stored = await self._rows(
            "SELECT key,value FROM user_settings WHERE user_id=:id", id=user_id
        )
        preferences = {
            **client_defaults()["user_settings"],
            **get_settings().default_user_settings,
            **{row["key"]: row["value"] for row in stored},
        }
        catalog = localization(locale, get_settings().mode)["messages"][""]

        def tr(value: str) -> str:
            found = catalog.get(value)
            return found[0] if found and found[0] else value

        items = await self._rows(
            "SELECT * FROM uihelper_shopping_list WHERE shopping_list_id=:id "
            "ORDER BY product_name COLLATE NOCASE",
            id=list_id,
        )
        units = await self._rows("SELECT * FROM quantity_units")
        fields = []
        values = []
        if layout == "table":
            for entity in ("shopping_list", "products", "product_groups"):
                fields.extend(
                    await self._rows(
                        "SELECT * FROM userfields WHERE entity=:entity "
                        "AND show_as_column_in_tables=1 "
                        "ORDER BY sort_number, name COLLATE NOCASE",
                        entity=entity,
                    )
                )
                values.extend(
                    await self._rows(
                        "SELECT * FROM userfield_values_resolved WHERE entity=:entity "
                        "ORDER BY name COLLATE NOCASE",
                        entity=entity,
                    )
                )
        rows = []
        for item in items:
            amount = numeric_value(item["amount"])
            if truthy(preferences.get("shopping_list_round_up")):
                amount = ceil(amount)
            amount_html = f'<span data-number="quantity">{escape(php_string(amount))}</span>'
            if not empty(item["product_id"]):
                unit = next((row for row in units if loose_equals(row["id"], item["qu_id"])), None)
                if unit:
                    data = escape(
                        json.dumps(
                            {
                                key: unit.get(key)
                                for key in ("name", "name_plural", "plural_forms", "active")
                            },
                            ensure_ascii=False,
                        )
                    )
                    amount_html += (
                        f' <span data-unit="{data}" data-count="{amount}">'
                        f"{escape(php_string(unit['name']))}</span>"
                    )
            note = _multiline(item["note"])
            product = (
                escape(php_string(item["product_name"])) + "<br>"
                if not empty(item["product_id"])
                else ""
            )
            label = product + "<em>" + note + "</em>"
            if layout != "table":
                rows.append(f'<div class="py-0">{amount_html} {label}</div><br>')
                continue
            group = (
                escape(php_string(item["product_group_name"]))
                if not empty(item["product_group_name"])
                else f'<span class="font-italic font-weight-light">{escape(tr("Ungrouped"))}</span>'
            )
            cells = [
                f"<td>{label}</td>",
                f"<td>{amount_html}</td>",
                f"<td hidden data-product-group>{group}</td>",
            ]
            for field in fields:
                identity = (
                    item["id"]
                    if field["entity"] == "shopping_list"
                    else item["product_id"]
                    if field["entity"] == "products"
                    else item["product_group_id"]
                )
                value = next(
                    (
                        row["value"]
                        for row in values
                        if row["entity"] == field["entity"]
                        and loose_equals(row["object_id"], identity)
                        and loose_equals(row["name"], field["name"])
                    ),
                    None,
                )
                cells.append("<td>" + await _field_html(field, value, base_url) + "</td>")
            rows.append("<tr>" + "".join(cells) + "</tr>")
        if layout == "table":
            headings = (
                f"<th>{escape(tr('Product'))} / <em>{escape(tr('Note'))}</em></th>"
                f"<th>{escape(tr('Amount'))}</th>"
                f"<th hidden>{escape(tr('Product group'))}</th>"
            )
            headings += "".join(
                f"<th>{escape(php_string(field['caption']))}</th>" for field in fields
            )
            content = (
                '<table class="table table-sm table-striped nowrap dataTable" '
                f'data-shopping-table data-grouped="{str(grouped).lower()}">'
                f"<thead><tr>{headings}</tr></thead><tbody>{''.join(rows)}</tbody></table>"
            )
        else:
            content = "".join(rows)
        top = ""
        if header:
            logo = base64.b64encode((_ASSETS / "logo.svg").read_bytes()).decode()
            title = (
                f'<h3 class="text-center">{escape(php_string(shopping["name"]))}</h3>'
                if shopping["name"] != tr("Shopping list")
                else ""
            )
            top = (
                f'<h1 class="text-center"><img src="data:image/svg+xml;base64,{logo}" '
                'width="114" height="30" class="d-flex mx-auto">'
                f"{escape(tr('Shopping list'))}</h1>{title}"
                f'<h6 class="text-center mb-4">{escape(tr("Time of printing"))}: '
                "<span data-print-timestamp></span></h6>"
            )
        description = ""
        if not empty(shopping["description"]):
            description = (
                f'<div class="w-75 pt-3"><h5>{escape(tr("Notes"))}</h5>'
                f"<div>{render_html(php_string(shopping['description']))}</div></div>"
            )
        styles = await run_in_threadpool(_styles)
        return (
            f'<!doctype html><html lang="{escape(locale)}"><head><meta charset="utf-8">'
            f"<title>{escape(tr('Shopping list'))}</title><style>{styles}</style></head>"
            '<body><div class="content-wrapper pt-0">'
            '<div class="container-fluid pr-1 pl-md-3 pl-2">'
            f'<div class="row mb-3"><main class="col content-text">{top}'
            f'<div class="w-75">{content}</div>{description}</main></div></div></div></body></html>'
        )
