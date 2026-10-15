"""Read the product and optional stock entry from a Grocycode."""

from grocy.core.errors import GrocyError


def parse_product_code(barcode: str) -> tuple[int, str | None] | None:
    parts = barcode.split(":")
    if len(parts) < 3 or parts[0] != "grcy":
        return None
    if parts[1] != "p":
        raise GrocyError("The Grocycode does not identify a product")
    if not parts[2].isascii() or not parts[2].isdigit() or int(parts[2]) <= 0:
        return None
    return int(parts[2]), parts[3] if len(parts) > 3 else None
