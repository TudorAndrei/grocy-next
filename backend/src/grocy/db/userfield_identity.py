"""Map legacy field names to stable IDs without binding orphan values to a new field."""

from collections.abc import Iterable


def legacy_field_ids(
    definitions: Iterable[tuple[str | None, str | None, int]],
    keys: Iterable[tuple[str | None, str | None]],
) -> dict[tuple[str, str], int]:
    mapping = {}
    minimum = 0
    for entity, name, field_id in definitions:
        mapping.setdefault((entity or "", name or ""), field_id)
        minimum = min(minimum, field_id)
    for key in sorted({(entity or "", name or "") for entity, name in keys}):
        if key not in mapping:
            minimum -= 1
            mapping[key] = minimum
    return mapping
