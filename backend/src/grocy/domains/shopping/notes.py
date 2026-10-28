"""The pinned browser editor in an opaque sandbox, served by Python."""

import base64
import json
import re
import secrets
from functools import lru_cache
from html import escape
from pathlib import Path

from grocy.core.config import get_settings
from grocy.domains.print_assets import print_font_styles
from grocy.domains.system.service import localization

_ASSETS = Path(__file__).parents[2] / "_vendor"


@lru_cache
def _assets(editor_locale: str) -> tuple[str, str]:
    folder = _ASSETS / "summernote"
    font = base64.b64encode((folder / "summernote.woff2").read_bytes()).decode()
    css = re.sub(
        r"src: url\([^;]+;",
        f'src:url(data:font/woff2;base64,{font}) format("woff2");',
        (folder / "summernote.css").read_text(),
        count=1,
    )
    styles = (_ASSETS / "shopping-print/bootstrap.css").read_text(encoding="utf-8-sig")
    styles += print_font_styles((400, 500, 700)) + css + (folder / "night.css").read_text()
    scripts = ""
    for name in ("jquery.min.js", "bootstrap.bundle.min.js", "summernote.min.js"):
        data = base64.b64encode((folder / name).read_bytes()).decode()
        scripts += (
            '<script nonce="__GROCY_EDITOR_NONCE__" '
            f'src="data:text/javascript;base64,{data}"></script>'
        )
    language = folder / "lang" / f"summernote-{editor_locale}.js"
    if re.fullmatch(r"[A-Za-z0-9-]+", editor_locale) and language.is_file():
        data = base64.b64encode(language.read_bytes()).decode()
        scripts += (
            '<script nonce="__GROCY_EDITOR_NONCE__" '
            f'src="data:text/javascript;base64,{data}"></script>'
        )
    return styles, scripts


def notes_editor(description: str, locale: str) -> str:
    catalog = localization(locale, get_settings().mode)["messages"][""]

    def tr(value: str) -> str:
        found = catalog.get(value)
        return found[0] if found and found[0] else value

    editor_locale = tr("summernote_locale")
    styles, scripts = _assets(editor_locale)
    nonce = secrets.token_urlsafe(24)
    scripts = scripts.replace("__GROCY_EDITOR_NONCE__", nonce)
    options = {
        "initial": description,
        "locale": editor_locale,
        "notesLabel": tr("Notes"),
        "sourceLabel": tr("Code view"),
    }
    setup = Path(__file__).with_name("notes_editor.js").read_text()
    setup += (
        "\nwindow.initializeShoppingNotes("
        + json.dumps(options, ensure_ascii=True).replace("<", "\\u003c").replace(">", "\\u003e")
        + ");"
    )
    return (
        f'<!doctype html><html lang="{escape(locale)}" '
        f'dir="{"rtl" if locale == "he_IL" else "ltr"}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; '
        f"script-src &#39;nonce-{nonce}&#39;; style-src &#39;unsafe-inline&#39;; "
        "font-src data:; img-src data: blob: https: http:; frame-src https: http:; "
        'media-src data: blob: https: http:; base-uri &#39;none&#39;; form-action &#39;none&#39;">'
        f"<style>{styles}\n"
        "html{font-size:16px}body{margin:0;font-family:Roboto,sans-serif;font-size:.85rem;}"
        ".note-editor{margin-bottom:0}.note-toolbar{display:flex;flex-wrap:wrap}"
        ".note-editable img{max-width:100%}</style></head>"
        f'<body><textarea id="description"></textarea>{scripts}'
        f'<script nonce="{nonce}">{setup}</script>'
        "</body></html>"
    )
