"""The legacy image transformation, using libgd through its public C interface."""

import ctypes as c
import math
from collections.abc import Iterable
from ctypes.util import find_library
from functools import lru_cache
from pathlib import Path

from grocy.compatibility.php import php_error
from grocy.core.errors import GrocyError


def black_white_png(
    width: int, height: int, rectangles: Iterable[tuple[int, int, int, int]], *, palette: bool
) -> bytes | None:
    """Render barcode rectangles with the same PNG defaults as imagepng()."""
    library = _library()
    if library is None:
        return None
    create = library.gdImageCreate if palette else library.gdImageCreateTrueColor
    image = create(width, height)
    if not image:
        raise php_error("Unable to create barcode image")
    encoded = None
    try:
        white = library.gdImageColorAllocateAlpha(image, 255, 255, 255, 0)
        black = library.gdImageColorAllocateAlpha(image, 0, 0, 0, 0)
        library.gdImageFilledRectangle(image, 0, 0, width - 1, height - 1, white)
        for x1, y1, x2, y2 in rectangles:
            library.gdImageFilledRectangle(image, x1, y1, x2, y2, black)
        size = c.c_int()
        encoded = library.gdImagePngPtrEx(image, c.byref(size), -1)
        if not encoded:
            raise php_error("Unable to encode barcode image")
        return c.string_at(encoded, size.value)
    finally:
        if encoded:
            library.gdFree(encoded)
        library.gdImageDestroy(image)


class _ImageHeader(c.Structure):
    # This prefix of gdImage is public and binary compatible across libgd 2.x.
    _fields_ = [
        ("pixels", c.c_void_p),
        ("width", c.c_int),
        ("height", c.c_int),
        ("colors_total", c.c_int),
    ]


_FORMATS = {"GIF": "Gif", "JPEG": "Jpeg", "PNG": "Png", "WEBP": "Webp", "BMP": "Bmp"}


@lru_cache
def _library() -> c.CDLL | None:
    name = find_library("gd")
    if name is None:
        return None
    library = c.CDLL(name)
    pointer, integer = c.c_void_p, c.c_int
    for suffix in _FORMATS.values():
        function = getattr(library, f"gdImageCreateFrom{suffix}Ptr")
        function.argtypes = [integer, pointer]
        function.restype = pointer
    signatures = {
        "gdImageCreate": ([integer, integer], pointer),
        "gdImageCreateTrueColor": ([integer, integer], pointer),
        "gdImageDestroy": ([pointer], None),
        "gdFree": ([pointer], None),
        "gdImageColorAllocateAlpha": ([pointer, integer, integer, integer, integer], integer),
        "gdImageColorTransparent": ([pointer, integer], None),
        "gdImageFill": ([pointer, integer, integer, integer], None),
        "gdImageFilledRectangle": ([pointer, *[integer] * 5], None),
        "gdImageAlphaBlending": ([pointer, integer], None),
        "gdImageSaveAlpha": ([pointer, integer], None),
        "gdImageInterlace": ([pointer, integer], None),
        "gdImageCopyResampled": ([pointer, pointer, *[integer] * 8], None),
        "gdImageRotateInterpolated": ([pointer, c.c_float, integer], pointer),
        "gdImageFlipHorizontal": ([pointer], None),
        "gdImageGifPtr": ([pointer, c.POINTER(integer)], pointer),
        "gdImageJpegPtr": ([pointer, c.POINTER(integer), integer], pointer),
        "gdImagePngPtrEx": ([pointer, c.POINTER(integer), integer], pointer),
        "gdImageWebpPtrEx": ([pointer, c.POINTER(integer), integer], pointer),
        "gdImageBmpPtr": ([pointer, c.POINTER(integer), integer], pointer),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(library, name)
        function.argtypes = arguments
        function.restype = result
    return library


def _header(image: int) -> _ImageHeader:
    return c.cast(image, c.POINTER(_ImageHeader)).contents


def _dimensions(
    source_width: int, source_height: int, width: str | None, height: str | None
) -> tuple[int, int]:
    if width is None:
        return source_width, source_height
    target_width = float(width)
    ratio = source_height / source_width
    target_height = math.floor(target_width * ratio + 0.5)
    if height is not None:
        if source_width <= target_width and source_height <= float(height):
            return source_width, source_height
        if target_height > float(height):
            target_height = float(height)
            target_width = math.floor(target_height / ratio + 0.5)
    if target_width > source_width or target_height > source_height:
        return source_width, source_height
    if int(target_width) <= 0 or int(target_height) <= 0:
        raise php_error("imagecreatetruecolor(): Argument #1 ($width) must be greater than 0")
    return int(target_width), int(target_height)


def picture_bytes(
    path: Path, image_format: str, orientation: int, width: str | None, height: str | None
) -> bytes | None:
    library = _library()
    if library is None:
        return None
    suffix = _FORMATS.get(image_format)
    if suffix is None:
        raise GrocyError("Unsupported file type", code=None)
    data = path.read_bytes()
    buffer = c.create_string_buffer(data)
    source = getattr(library, f"gdImageCreateFrom{suffix}Ptr")(len(data), buffer)
    if not source:
        raise GrocyError("Unsupported file type", code=None)
    destination = None
    encoded = None
    try:
        if image_format == "JPEG":
            angle = {6: 270, 5: 270, 3: 180, 4: 180, 8: 90, 7: 90}.get(orientation)
            if angle is not None:
                rotated = library.gdImageRotateInterpolated(source, angle, 0)
                if not rotated:
                    raise GrocyError("Unable to rotate image", code=None)
                library.gdImageDestroy(source)
                source = rotated
            if orientation in (5, 4, 7):
                library.gdImageFlipHorizontal(source)
        header = _header(source)
        target_width, target_height = _dimensions(header.width, header.height, width, height)
        create = (
            library.gdImageCreate
            if image_format == "PNG" and header.colors_total > 0
            else library.gdImageCreateTrueColor
        )
        destination = create(target_width, target_height)
        if not destination:
            raise GrocyError("Unable to create image", code=None)
        if image_format in ("PNG", "WEBP"):
            library.gdImageAlphaBlending(destination, 0)
            library.gdImageSaveAlpha(destination, 1)
        alpha = 127 if image_format == "PNG" else 1 if image_format == "GIF" else 0
        background = library.gdImageColorAllocateAlpha(destination, 255, 255, 255, alpha)
        if image_format in ("PNG", "GIF"):
            library.gdImageColorTransparent(destination, background)
            library.gdImageFill(destination, 0, 0, background)
            library.gdImageSaveAlpha(destination, 1)
        else:
            library.gdImageFilledRectangle(
                destination, 0, 0, target_width, target_height, background
            )
        library.gdImageInterlace(destination, 1)
        library.gdImageCopyResampled(
            destination,
            source,
            0,
            0,
            0,
            0,
            target_width,
            target_height,
            header.width,
            header.height,
        )
        size = c.c_int()
        encoder, quality = {
            "GIF": ("gdImageGifPtr", None),
            "JPEG": ("gdImageJpegPtr", 85),
            "PNG": ("gdImagePngPtrEx", 6),
            "WEBP": ("gdImageWebpPtrEx", 85),
            "BMP": ("gdImageBmpPtr", 0),
        }[image_format]
        arguments = (destination, c.byref(size))
        if quality is not None:
            arguments += (quality,)
        encoded = getattr(library, encoder)(*arguments)
        if not encoded or size.value <= 0:
            raise GrocyError("Unable to encode image", code=None)
        return c.string_at(encoded, size.value)
    finally:
        if encoded:
            library.gdFree(encoded)
        if destination:
            library.gdImageDestroy(destination)
        library.gdImageDestroy(source)
