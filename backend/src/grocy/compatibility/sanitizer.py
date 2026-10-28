"""Apply the pinned Grocy HTML allowlist without a PHP runtime."""

import base64
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import unquote_to_bytes

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


def _image_data_uri(value: str) -> str | None:
    pieces = value[5:].split(",", 1)
    data = pieces[-1]
    declared = None
    encoded = False
    if len(pieces) == 2:
        for part in pieces[0].split(";"):
            if part == "base64":
                encoded = True
                break
            if not part.startswith("charset=") and declared is None:
                declared = part
    if declared is not None and declared not in {"image/png", "image/jpeg", "image/gif"}:
        return None
    raw = unquote_to_bytes(data)
    if encoded:
        raw = re.sub(rb"[^A-Za-z0-9+/]", b"", raw)
        # PHP's non-strict base64 decoder ignores an incomplete final sextet.
        if len(raw) % 4 == 1:
            raw = raw[:-1]
        raw = base64.b64decode(raw + b"=" * (-len(raw) % 4))
    if len(raw) < 12:
        return None
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif raw.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif raw.startswith(b"GIF"):
        mime = "image/gif"
    else:
        return None
    return "data:" + mime + ";base64," + base64.b64encode(raw).decode()


class _ImageMarkup(HTMLParser):
    """Retain surrounding HTML while applying the native image and void-tag rules."""

    def __init__(self, source: str, *, output: bool):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.output = output
        self.offsets = [0]
        for match in re.finditer("\n", source):
            self.offsets.append(match.end())
        self.changes: list[tuple[int, int, str]] = []
        self.feed(source)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "img" and not (self.output and tag == "br"):
            return
        original = self.get_starttag_text()
        if original is None:
            return
        replacement = original
        attributes = dict(attrs)
        src = attributes.get("src")
        if tag == "img":
            if self.output:
                if not src:
                    replacement = ""
                elif src.lower().startswith("data:"):
                    normalized = _image_data_uri(src)
                    replacement = (
                        re.sub(r'src="[^"]*"', f'src="{normalized}"', original)
                        if normalized is not None
                        else ""
                    )
            elif "alt" not in attributes and src is not None:
                name = src.rstrip("/").rsplit("/", 1)[-1]
                suffix = "/>" if original.endswith("/>") else ">"
                replacement = original.removesuffix(suffix) + ' alt="' + escape(name) + '"' + suffix
        if self.output and replacement:
            replacement = replacement.removesuffix(">").rstrip().removesuffix("/").rstrip() + " />"
        if replacement != original:
            line, column = self.getpos()
            start = self.offsets[line - 1] + column
            self.changes.append((start, start + len(original), replacement))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def result(self) -> str:
        pieces = []
        previous = 0
        for start, end, replacement in self.changes:
            pieces.extend((self.source[previous:start], replacement))
            previous = end
        pieces.append(self.source[previous:])
        return "".join(pieces)


def clean(value: str) -> str:
    sanitized = nh3.clean(
        _ImageMarkup(value, output=False).result(),
        tags=_TAGS,
        attributes=_ATTRIBUTES,
        clean_content_tags={"script", "style"},
        filter_style_properties=_STYLES,
        url_schemes={"http", "https", "data"},
        link_rel=None,
    )
    sanitized = re.sub(r' style="([^"]*)"', _style, sanitized)
    sanitized = _ImageMarkup(sanitized, output=True).result()
    return sanitized.replace("&amp;", "&").replace("&gt;", ">").replace("&lt;", "<")


def render_html(value: str) -> str:
    """Prepare a display copy without the compatibility API's entity decoding."""
    sanitized = nh3.clean(
        value,
        tags=_TAGS,
        attributes=_ATTRIBUTES,
        clean_content_tags={"script", "style"},
        filter_style_properties=_STYLES,
        url_schemes={"http", "https", "data"},
        link_rel="noopener noreferrer",
        set_tag_attribute_values={"iframe": {"sandbox": "allow-scripts allow-presentation"}},
    )
    return re.sub(r' style="([^"]*)"', _style, sanitized)
