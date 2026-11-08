import pytest

from grocy.core.config import get_settings


@pytest.fixture
def settings_reader(client, api_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Settings reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Settings reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()
    return {"GROCY-API-KEY": key["api_key"]}


def test_stock_settings_choices_require_login_but_no_domain_or_feature_grant(
    client, api_headers, settings_reader, monkeypatch
):
    expected = {}
    for entity in ["locations", "quantity_units", "product_groups"]:
        records = {}
        for name, active in [
            ("Zulu settings", 1),
            ("alpha settings", 1),
            ("Alpha settings", 1),
            ("Äther settings", 1),
            ("äther settings", 1),
            ("Hidden settings", 0),
        ]:
            response = client.post(
                f"/api/objects/{entity}", headers=api_headers, json={"name": name, "active": active}
            )
            response.raise_for_status()
            records[name] = int(response.json()["created_object_id"])
        expected[entity] = records
    monkeypatch.setattr(get_settings(), "feature_flag_stock", False)
    path = "/api/v2/settings/stock-context"
    assert client.get(path).status_code == 401
    response = client.get(path, headers=settings_reader)
    assert response.status_code == 200, response.text
    context = response.json()
    assert set(context) == {"locations", "quantity_units", "product_groups"}
    for entity, records in expected.items():
        rows = context[entity]
        selected = [row for row in rows if row["id"] in records.values()]
        assert [row["name"] for row in selected] == [
            "alpha settings",
            "Alpha settings",
            "Zulu settings",
            "Äther settings",
            "äther settings",
        ]
        assert records["Hidden settings"] not in {row["id"] for row in rows}
        assert all(set(row) == {"id", "name"} for row in rows)
        assert all(row["id"] > 0 for row in rows)
    assert (
        client.post(
            "/api/objects/locations",
            headers=settings_reader,
            json={"name": "Denied settings write"},
        ).status_code
        == 403
    )


def test_shopping_settings_include_all_lists_in_native_nocase_order_for_authenticated_readers(
    client, api_headers, settings_reader, monkeypatch
):
    ids = set()
    for name in [
        "Zulu settings",
        "alpha settings",
        "Alpha settings",
        "Äther settings",
        "äther settings",
    ]:
        response = client.post(
            "/api/objects/shopping_lists", headers=api_headers, json={"name": name}
        )
        response.raise_for_status()
        ids.add(int(response.json()["created_object_id"]))
    client.post(
        "/api/objects/shopping_lists", headers=api_headers, json={"id": 0, "name": "Zero settings"}
    ).raise_for_status()
    monkeypatch.setattr(get_settings(), "feature_flag_shoppinglist", False)
    path = "/api/v2/settings/shopping-context"
    assert client.get(path).status_code == 401
    response = client.get(path, headers=settings_reader)
    assert response.status_code == 200, response.text
    rows = response.json()["shopping_lists"]
    assert [row["name"] for row in rows if row["id"] in ids] == [
        "alpha settings",
        "Alpha settings",
        "Zulu settings",
        "Äther settings",
        "äther settings",
    ]
    assert {0, 1, *ids} == {row["id"] for row in rows}
    assert next(row for row in rows if row["id"] == 0)["name"] == "Zero settings"
    assert all(set(row) == {"id", "name"} for row in rows)
    assert (
        client.post(
            "/api/objects/shopping_lists",
            headers=settings_reader,
            json={"name": "Denied settings write"},
        ).status_code
        == 403
    )
