"""Stock-entry paper labels from the pinned template, with embedded print assets."""

import base64
import re
from functools import lru_cache
from html import escape
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility.php import php_string
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.domains.printing import stock_entry
from grocy.domains.system.service import localization

from .image import grocycode_png

_FONTS = Path(__file__).parents[2] / "_vendor" / "roboto"


@lru_cache
def _font_styles() -> str:
    def embed(match: re.Match[str]) -> str:
        data = base64.b64encode((_FONTS / match[1]).read_bytes()).decode()
        return f"src: url(data:font/woff2;base64,{data}) format('woff2');"

    return "\n".join(
        re.sub(
            r"src: url\(\./files/([^()]+\.woff2)\)[^;]+;",
            embed,
            (_FONTS / f"{weight}.css").read_text(),
        )
        for weight in (400, 700)
    )


async def stock_entry_label(
    session: AsyncSession, entry_id: str, locale: str, base_url: str
) -> str:
    entry = await stock_entry(session, entry_id)
    name = ""
    due = ""
    identity = php_string(entry["id"]) if entry is not None else ""
    image = f"{base_url}/stockentry/{identity}/grocycode?size=100"
    if entry is not None:
        name = php_string(
            await session.scalar(
                text("SELECT name FROM products WHERE id=:id"), {"id": entry["product_id"]}
            )
        )
        due = php_string(entry["best_before_date"])
        code = f"grcy:p:{php_string(entry['product_id'])}:{php_string(entry['stock_id'])}"
        try:
            png = await run_in_threadpool(grocycode_png, code, get_settings().grocycode_type, 100)
        except (GrocyError, ValueError):
            # The native document remains available when its separate image request fails.
            pass
        else:
            image = "data:image/png;base64," + base64.b64encode(png).decode()
    translations = localization(locale, get_settings().mode)["messages"][""].get("DD")
    caption = translations[0] if translations and translations[0] else "DD"
    date = (
        f"<span>{escape(caption)}: {escape(due)}</span>"
        if get_settings().feature_enabled("STOCK_BEST_BEFORE_DATE_TRACKING")
        else ""
    )
    fonts = await run_in_threadpool(_font_styles)
    return f"""<html>
<head><meta charset="utf-8"><title>{escape(name)}</title>
<style>{fonts}
body {{ font-family: 'Roboto', sans-serif; }}
img {{ float: left; margin-right: .5rem; max-height: 25px; width: auto; margin-top: 2px; }}
.productname {{ font-size: 20px; display: inline-block; font-weight: bold; }}
</style></head>
<body><p><img src="{escape(image)}"><span class="productname">{escape(name)}</span><br>
{date}</p></body></html>"""
