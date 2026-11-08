"""Native ProductsList reads real catalog/stock data, independently of write grants."""

from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def create(client, headers, table, **values):
    response = client.post(f"/api/objects/{table}", headers=headers, json=values)
    response.raise_for_status()
    return int(response.json()["created_object_id"])


def context(client, headers, query=""):
    response = client.get("/api/v2/products/context" + query, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_products_master_filters_use_aggregated_stock_and_raw_php_presence(client, api_headers):
    identities = {}
    for name in ["Parent", "Child", "Empty", "Inactive"]:
        identities[name] = create(
            client,
            api_headers,
            "products",
            name="Master " + name,
            location_id=1,
            qu_id_stock=1,
            qu_id_purchase=1,
            **({"parent_product_id": identities["Parent"]} if name == "Child" else {}),
        )
    for name in ["Child", "Inactive"]:
        client.post(
            f"/api/stock/products/{identities[name]}/add",
            headers=api_headers,
            json={"amount": 2, "best_before_date": "2999-12-31"},
        ).raise_for_status()
    client.put(
        f"/api/objects/products/{identities['Inactive']}", headers=api_headers, json={"active": 0}
    ).raise_for_status()

    def selected(query):
        return {row["id"] for row in context(client, api_headers, query)["products"]} & set(
            identities.values()
        )

    active = {identities[name] for name in ["Parent", "Child", "Empty"]}
    assert selected("") == active
    for query in [
        "?include_disabled",
        "?include_disabled=",
        "?include_disabled=0",
        "?include.disabled=1",
        "?include+disabled=1",
        "?include_disabled[]=0",
        "?include_disabled=0&include_disabled[x]=1",
    ]:
        assert selected(query) == set(identities.values()), query
    assert selected("?include_disabled[broken=1") == active
    assert selected("?only_in_stock=0") == {identities["Parent"], identities["Child"]}
    assert selected("?only_out_of_stock[]=") == {identities["Empty"]}
    assert selected("?include_disabled&only_in_stock") == {
        identities["Parent"],
        identities["Child"],
    }
    # stock_current itself excludes disabled products, even with saved own stock.
    assert selected("?include_disabled&only_out_of_stock") == {
        identities["Empty"],
        identities["Inactive"],
    }
    assert selected("?include_disabled&only_in_stock&only_out_of_stock") == set()
    rows = context(client, api_headers)["products"]
    assert [row["name"] for row in rows] == sorted([row["name"] for row in rows], key=str.lower)
    parent = next(row for row in rows if row["id"] == identities["Parent"])
    assert set(parent) == {
        "id",
        "name",
        "active",
        "picture_file_name",
        "location_id",
        "min_stock_amount",
        "qu_id_purchase",
        "qu_id_stock",
        "product_group_id",
        "shopping_location_id",
    }


def test_products_master_references_and_custom_values_keep_native_order_and_absence(
    client, api_headers
):
    references = {}
    for entity in ["locations", "quantity_units", "product_groups", "shopping_locations"]:
        references[entity] = [
            create(client, api_headers, entity, name=name, active=active)
            for name, active in [("Z master", 1), ("a master", 0)]
        ]
    product = create(
        client,
        api_headers,
        "products",
        name="Master raw fields",
        location_id=references["locations"][1],
        qu_id_stock=references["quantity_units"][1],
        qu_id_purchase=references["quantity_units"][0],
        product_group_id=references["product_groups"][1],
        shopping_location_id=references["shopping_locations"][1],
    )
    fields = {}
    for name, sort in [("z null", None), ("beta", 1), ("Alpha", 1), ("empty text", "")]:
        fields[name] = create(
            client,
            api_headers,
            "userfields",
            entity="products",
            name=name,
            caption=name,
            type="text-single-line",
            show_as_column_in_tables=1,
            **({"sort_number": sort} if sort is not None else {}),
        )
    foreign = create(
        client,
        api_headers,
        "userfields",
        entity="recipes",
        name="Alpha",
        caption="Foreign",
        type="text-single-line",
    )

    async def raw_values():
        async with get_session_factory()() as session:
            # Imported rows can predate the native trigger which removes empty values.
            # Restore it after the import; the reader must not fill other missing keys.
            trigger = await session.scalar(
                text("SELECT sql FROM sqlite_master WHERE name='prevent_empty_userfields_INS'")
            )
            await session.execute(text("DROP TRIGGER prevent_empty_userfields_INS"))
            for field, object_id, value in [
                (fields["Alpha"], f"0{product}", "Alias value"),
                (fields["beta"], str(product), ""),
                (foreign, str(product), "Do not leak"),
            ]:
                await session.execute(
                    text(
                        "INSERT INTO userfield_values(field_id,object_id,value) "
                        "VALUES (:field,:object,:value)"
                    ),
                    {"field": field, "object": object_id, "value": value},
                )
            await session.execute(text(trigger))
            await session.commit()

    client.portal.call(raw_values)
    body = context(client, api_headers)
    for entity, ids in references.items():
        selected = [row["id"] for row in body[entity] if row["id"] in ids]
        assert selected == (ids[:1] if entity == "product_groups" else list(reversed(ids)))
    assert [field["name"] for field in body["userfields"]] == [
        "z null",
        "Alpha",
        "beta",
        "empty text",
    ]
    assert [field["sort_number"] for field in body["userfields"]] == [None, 1, 1, None]
    assert body["userfields"][1]["show_as_column_in_tables"] == 1
    assert body["userfield_values"] == [
        {"object_id": f"0{product}", "name": "Alpha", "value": "Alias value"},
        {"object_id": str(product), "name": "beta", "value": None},
    ]
    row = next(row for row in body["products"] if row["id"] == product)
    assert row["location_id"] == references["locations"][1]
    assert row["product_group_id"] == references["product_groups"][1]


def test_products_master_context_is_auth_only_and_actor_localized_under_base_prefix(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/products/context").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Master reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Master reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    reader = {"GROCY-API-KEY": key, "Accept-Language": "fr"}
    client.put("/api/user/settings/locale", headers=reader, json={"value": "de"}).raise_for_status()
    client.put(
        "/api/user/settings/datatables_state_products-table",
        headers=reader,
        json={"value": '{"order":[[1,"desc"]]}'},
    ).raise_for_status()
    monkeypatch.setattr(get_settings(), "feature_flag_stock", False)
    monkeypatch.setattr(get_settings(), "base_path", "/pantry")
    response = client.get("/pantry/api/v2/products/context", headers=reader)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["products"]
    assert body["locale"] == body["config"]["LOCALE"] == "de"
    assert body["config"]["FEATURE_FLAG_STOCK"] is False
    assert body["user_settings"]["datatables_state_products-table"] == '{"order":[[1,"desc"]]}'
    other = client.get("/pantry/api/v2/products/context", headers=api_headers).json()
    assert other["locale"] == "en"
    assert (
        other["user_settings"].get("datatables_state_products-table")
        != body["user_settings"]["datatables_state_products-table"]
    )
