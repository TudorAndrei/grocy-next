"""Pinned print fonts, embedded so authenticated documents have no font requests."""

import base64
import re
from functools import lru_cache
from pathlib import Path

_FONTS = Path(__file__).parents[1] / "_vendor" / "roboto"


@lru_cache
def print_font_styles(weights: tuple[int, ...] = (400, 700)) -> str:
    def embed(match: re.Match[str]) -> str:
        data = base64.b64encode((_FONTS / match[1]).read_bytes()).decode()
        return f"src: url(data:font/woff2;base64,{data}) format('woff2');"

    return "\n".join(
        re.sub(
            r"src: url\(\./files/([^()]+\.woff2)\)[^;]+;",
            embed,
            (_FONTS / f"{weight}.css").read_text(),
        )
        for weight in weights
    )
