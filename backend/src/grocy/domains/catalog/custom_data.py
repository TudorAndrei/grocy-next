"""Native custom-data list/editor context, without broadening mutation permissions."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import find, loose_equals
from grocy.core.errors import NotFoundError
from grocy.domains.system.service import openapi_specification

# UserfieldsService constants are returned in declaration order by GetClassConstants.
FIELD_TYPES = (
    "checkbox",
    "date",
    "datetime",
    "number-integral",
    "number-decimal",
    "number-currency",
    "file",
    "image",
    "link",
    "link-with-title",
    "preset-checklist",
    "preset-list",
    "text-single-line",
    "text-multi-line",
)


async def custom_data_catalog(session: AsyncSession) -> dict[str, list[str]]:
    names = await session.scalars(
        text("SELECT name FROM userentities ORDER BY name COLLATE NOCASE")
    )
    exposed = openapi_specification()["components"]["schemas"]["ExposedEntity"]["enum"]
    return {
        "entities": sorted([*exposed, *("userentity-" + name for name in names), "users"]),
        "field_types": list(FIELD_TYPES),
    }


async def custom_data_fields(
    session: AsyncSession, namespace: str | None = None
) -> list[dict[str, Any]]:
    where = " WHERE entity=:entity" if namespace is not None else ""
    result = await session.execute(
        text("SELECT * FROM userfields" + where + " ORDER BY sort_number,name COLLATE NOCASE"),
        {"entity": namespace} if namespace is not None else {},
    )
    return [dict(row) for row in result.mappings()]


async def userobjects_context(session: AsyncSession, name: str) -> dict[str, Any]:
    userentity = (
        (
            await session.execute(
                text(
                    "SELECT id,name,caption,description,show_in_sidebar_menu,icon_css_class "
                    "FROM userentities WHERE name=:name LIMIT 1"
                ),
                {"name": name},
            )
        )
        .mappings()
        .first()
    )
    if userentity is None:
        raise NotFoundError("Userentity not found")
    namespace = "userentity-" + name
    fields = await custom_data_fields(session, namespace)
    objects = (
        (
            await session.execute(
                text("SELECT id,userentity_id FROM userobjects WHERE userentity_id=:id"),
                {"id": userentity["id"]},
            )
        )
        .mappings()
        .all()
    )
    values = [
        dict(row)
        for row in (
            await session.execute(
                text(
                    "SELECT object_id,name,value FROM userfield_values_resolved "
                    "WHERE entity=:entity ORDER BY name COLLATE NOCASE"
                ),
                {"entity": namespace},
            )
        ).mappings()
    ]
    rows = []
    for row in objects:
        saved = [value for value in values if loose_equals(value["object_id"], row["id"])]
        resolved = {}
        for field in fields:
            value = find(saved, "name", field["name"])
            if value is not None:
                resolved[field["name"]] = value["value"]
        rows.append({"id": row["id"], "userentity_id": row["userentity_id"], "values": resolved})
    return {"userentity": dict(userentity), "fields": fields, "rows": rows}
