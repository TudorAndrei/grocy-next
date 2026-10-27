"""Apply the pinned Grocy HTML allowlist without a PHP runtime."""

import re

import nh3
from PIL import ImageColor

_TAGS = {
    "div",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "a",
    "iframe",
    "ul",
    "ol",
    "li",
    "p",
    "br",
    "span",
    "img",
    "table",
    "tbody",
    "tr",
    "td",
    "th",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
}
_ATTRIBUTES = {
    "*": {"style", "class", "id"},
    "a": {"href", "title", "target"},
    "iframe": {"src", "width", "height", "frameborder"},
    "img": {"width", "height", "alt", "src"},
    "table": {"border", "width"},
}
_STYLES = {
    "font",
    "font-size",
    "font-weight",
    "font-style",
    "font-family",
    "text-decoration",
    "padding-left",
    "color",
    "background-color",
    "text-align",
    "width",
    "height",
}


def _style(match: re.Match[str]) -> str:
    declarations = []
    for declaration in match[1].split(";"):
        name, separator, value = declaration.partition(":")
        if not separator:
            continue
        name, value = name.strip(), value.strip()
        if name in {"color", "background-color"} and value.isalpha():
            try:
                rgb = ImageColor.getrgb(value)
                value = "#" + "".join(f"{channel:02X}" for channel in rgb)
            except ValueError:
                pass
        declarations.append(f"{name}:{value};")
    return ' style="' + "".join(declarations) + '"' if declarations else ""


def clean(value: str) -> str:
    sanitized = nh3.clean(
        value,
        tags=_TAGS,
        attributes=_ATTRIBUTES,
        clean_content_tags={"script", "style"},
        filter_style_properties=_STYLES,
        url_schemes={"http", "https", "data"},
        link_rel=None,
    )
    sanitized = re.sub(r' style="([^"]*)"', _style, sanitized)
    return sanitized.replace("&amp;", "&").replace("&gt;", ">").replace("&lt;", "<")
