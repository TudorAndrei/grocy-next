import json
from pathlib import Path

import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def create(client, table, **values):
    response = client.post(f"/api/objects/{table}", json=values)
    response.raise_for_status()
    return int(response.json()["created_object_id"])


def test_custom_data_catalog_matches_native_entities_and_type_declaration_order(
    client, api_headers
):
    assert client.get("/api/v2/custom-data/catalog").status_code == 401
    assert client.get("/api/v2/custom-data/fields").status_code == 401
    client.headers.update(api_headers)
    for name in ["zebra", "Alpha", "alpha", "Étagère"]:
        create(client, "userentities", name=name, caption=name)
    response = client.get("/api/v2/custom-data/catalog")
    response.raise_for_status()
    catalog = response.json()
    specification = json.loads(
        (Path(__file__).parents[2] / "src/grocy/_vendor/grocy-core/grocy.openapi.json").read_text()
    )
    assert catalog["entities"] == sorted(
        specification["components"]["schemas"]["ExposedEntity"]["enum"]
        + [
            "users",
            "userentity-zebra",
            "userentity-Alpha",
            "userentity-alpha",
            "userentity-Étagère",
        ]
    )
    assert catalog["field_types"] == [
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
    ]


@pytest.fixture
def custom_objects(client, api_headers):
    client.headers.update(api_headers)
    upper = create(
        client,
        "userentities",
        name="Books",
        caption="Library",
        description="Shelves",
        icon_css_class="fas fa-book",
        show_in_sidebar_menu=0,
    )
    lower = create(client, "userentities", name="books", caption="Other library")
    empty = create(client, "userentities", name="Empty", caption="Empty namespace")
    fields = {}
    for name, position, config in [
        ("zebra", None, None),
        ("beta", 1, ""),
        ("Alpha", 1, "first\nsecond"),
        ("trailing", "", ""),
    ]:
        fields[name] = create(
            client,
            "userfields",
            entity="userentity-Books",
            name=name,
            caption=name,
            type="text-single-line",
            **({"sort_number": position} if position is not None else {}),
            **({"config": config} if config is not None else {}),
        )
    foreign = create(
        client,
        "userfields",
        entity="userentity-books",
        name="Alpha",
        caption="Foreign",
        type="text-single-line",
    )
    create(
        client,
        "userfields",
        entity="userobjects",
        name="flat",
        caption="Flat",
        type="text-single-line",
    )
    first = create(client, "userobjects", userentity_id=upper)
    second = create(client, "userobjects", userentity_id=upper)
    other = create(client, "userobjects", userentity_id=lower)
    client.put(
        f"/api/userfields/userentity-Books/{first}",
        json={"Alpha": "First edition", "beta": "Discarded"},
    ).raise_for_status()

    async def pad_and_cross_namespace():
        async with get_session_factory()() as session:
            # PDO reads empty TEXT as NULL, while SQLite still sorts it after numeric values.
            await session.execute(
                text("UPDATE userfields SET config='' WHERE id IN (:beta,:trailing)"),
                {"beta": fields["beta"], "trailing": fields["trailing"]},
            )
            assert (
                await session.scalar(
                    text("SELECT typeof(sort_number) FROM userfields WHERE id=:id"),
                    {"id": fields["trailing"]},
                )
                == "text"
            )
            await session.execute(
                text("UPDATE userfield_values SET object_id=:padded WHERE field_id=:field"),
                {"padded": f"0{first}", "field": fields["Alpha"]},
            )
            # Native triggers delete an empty value rather than retaining a null entry.
            await session.execute(
                text("UPDATE userfield_values SET value='' WHERE field_id=:field"),
                {"field": fields["beta"]},
            )
            assert (
                await session.scalar(
                    text("SELECT count(*) FROM userfield_values WHERE field_id=:field"),
                    {"field": fields["beta"]},
                )
                == 0
            )
            await session.execute(
                text(
                    "INSERT INTO userfield_values(field_id,object_id,value) "
                    "VALUES (:field,:object,'Do not leak')"
                ),
                {"field": foreign, "object": str(first)},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(pad_and_cross_namespace)
    return client, upper, lower, empty, fields, first, second, other


def test_userobjects_context_keeps_exact_namespace_native_field_order_and_loose_value_join(
    custom_objects,
):
    client, upper, _lower, empty, _fields, first, second, other = custom_objects
    response = client.get("/api/v2/custom-data/userobjects/Books")
    response.raise_for_status()
    context = response.json()
    assert context["userentity"] == {
        "id": upper,
        "name": "Books",
        "caption": "Library",
        "description": "Shelves",
        "show_in_sidebar_menu": 0,
        "icon_css_class": "fas fa-book",
    }
    assert [field["name"] for field in context["fields"]] == ["zebra", "Alpha", "beta", "trailing"]
    assert [field["config"] for field in context["fields"]] == [None, "first\nsecond", None, None]
    assert context["fields"][0]["sort_number"] is None
    assert context["fields"][-1]["sort_number"] is None
    all_fields = client.get("/api/v2/custom-data/fields")
    all_fields.raise_for_status()
    shared_fields = [field for field in all_fields.json() if field["entity"] == "userentity-Books"]
    assert [field["name"] for field in shared_fields] == ["zebra", "Alpha", "beta", "trailing"]
    assert [field["sort_number"] for field in shared_fields] == [None, 1, 1, None]
    assert context["fields"][1]["entity"] == "userentity-Books"
    assert "input_required" in context["fields"][1]
    assert context["rows"] == [
        {
            "id": first,
            "userentity_id": upper,
            "values": {"Alpha": "First edition"},
        },
        {
            "id": second,
            "userentity_id": upper,
            "values": {},
        },
    ]
    lower_context = client.get("/api/v2/custom-data/userobjects/books").json()
    assert [row["id"] for row in lower_context["rows"]] == [other]
    assert lower_context["rows"][0]["values"] == {}
    assert client.get("/api/v2/custom-data/userobjects/BOOKS").status_code == 404
    assert client.get("/api/v2/custom-data/userobjects/Empty").json()["rows"] == []
    empty_object = create(client, "userobjects", userentity_id=empty)
    empty_context = client.get("/api/v2/custom-data/userobjects/Empty").json()
    assert empty_context["fields"] == []
    assert empty_context["rows"] == [{"id": empty_object, "userentity_id": empty, "values": {}}]


def test_userobjects_projection_reflects_value_changes_and_native_deletions(custom_objects):
    client, upper, _lower, _empty, fields, first, second, other = custom_objects
    path = "/api/v2/custom-data/userobjects/Books"
    client.put(
        f"/api/userfields/userentity-Books/{second}", json={"beta": "Current"}
    ).raise_for_status()
    assert client.get(path).json()["rows"][1]["values"]["beta"] == "Current"
    client.delete(f"/api/objects/userfields/{fields['Alpha']}").raise_for_status()
    assert [field["name"] for field in client.get(path).json()["fields"]] == [
        "zebra",
        "beta",
        "trailing",
    ]
    assert "Alpha" not in client.get(path).json()["rows"][0]["values"]
    client.delete(f"/api/objects/userobjects/{first}").raise_for_status()
    assert [row["id"] for row in client.get(path).json()["rows"]] == [second]
    assert client.get("/api/v2/custom-data/userobjects/books").json()["rows"][0]["id"] == other
    client.delete(f"/api/objects/userentities/{upper}").raise_for_status()
    assert client.get(path).status_code == 404
    entities = client.get("/api/v2/custom-data/catalog").json()["entities"]
    assert "userentity-Books" not in entities
    assert "userentity-books" in entities


def test_custom_data_context_is_authenticated_read_without_master_data_permission(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/custom-data/userobjects/missing").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Custom reader", "password": ""}
    ).raise_for_status()
    user = next(
        row
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Custom reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user["id"]}).json()[
        "api_key"
    ]
    client.headers.update(api_headers)
    namespace = create(client, "userentities", name="ReadOnly", caption="Read only")
    client.headers.update({"GROCY-API-KEY": key})
    assert client.get("/api/v2/custom-data/catalog").status_code == 200
    assert client.get("/api/v2/custom-data/fields").status_code == 200
    assert (
        client.get("/api/v2/custom-data/userobjects/ReadOnly").json()["userentity"]["id"]
        == namespace
    )
    assert client.get("/api/users").status_code == 403
    assert (
        client.post("/api/objects/userobjects", json={"userentity_id": namespace}).status_code
        == 403
    )
