"""Render Grocycode images with the pinned factory geometry."""

from io import BytesIO
from math import floor, isfinite
from typing import Any

from PIL import Image, ImageDraw

from grocy.compatibility.php import coerced_float, php_error, php_round, php_string, type_name
from grocy.domains.files.gd import black_white_png

from .code128 import code128
from .datamatrix import datamatrix


def grocycode_png(code: str, kind: str, size: Any = None) -> bytes:
    if size is None:
        dimension = 100.0 if kind == "2D" else 30.0
    else:
        dimension = None if isinstance(size, (dict, list)) else coerced_float(php_string(size))
        if dimension is None:
            raise php_error(f"Unsupported operand types: {type_name(size)} * int")
    if not isfinite(dimension):
        argument = "#1 ($width)" if kind == "2D" else "#2 ($height)"
        raise php_error(f"imagecreate(): Argument {argument} must be of type int, float given")
    rectangles = []
    data = code.encode("utf-8", "surrogateescape")
    if kind == "2D":
        matrix = datamatrix(data)
        margin = php_round(dimension * 0.01)
        area = dimension - margin * 2
        scale = floor(area / len(matrix[0]))
        if len(matrix[0]) * scale <= 0:
            raise php_error("imagecreate(): Argument #1 ($width) must be greater than 0")
        position = int(margin + floor((area - len(matrix[0]) * scale) / 2))
        width = height = int(dimension)
        for row, cells in enumerate(matrix):
            for column, cell in enumerate(cells):
                if cell:
                    x, y = position + column * scale, position + row * scale
                    rectangles.append((x, y, x + scale - 1, y + scale - 1))
    else:
        bars = code128(data)
        width, height = sum(value for _, value in bars), int(dimension)
        if height <= 0:
            raise php_error("imagecreate(): Argument #2 ($height) must be greater than 0")
        x = 0
        for black, length in bars:
            if black:
                rectangles.append((x, 0, x + length - 1, height - 1))
            x += length
    result = black_white_png(width, height, rectangles, palette=kind != "2D")
    if result is not None:
        return result
    # Local environments without libgd retain a usable image; release images ship libgd.
    image = Image.new(
        "P" if kind != "2D" else "RGB", (width, height), 0 if kind != "2D" else "white"
    )
    if kind != "2D":
        image.putpalette([255, 255, 255, 0, 0, 0])
    draw = ImageDraw.Draw(image)
    for rectangle in rectangles:
        x1, y1, x2, y2 = rectangle
        draw.rectangle(
            (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)),
            fill=1 if kind != "2D" else "black",
        )
    output = BytesIO()
    image.save(output, "PNG")
    return output.getvalue()
