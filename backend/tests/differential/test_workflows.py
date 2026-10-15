"""Public workflows checked against both implementations of the pinned Grocy API."""

import base64
import json
import os
import re
import sqlite3
from datetime import datetime
from io import BytesIO
from typing import Any
from uuid import uuid4

import httpx
import pytest


@pytest.fixture(params=["local", "php"])
def api(request, api_headers):
    if request.param == "local":
        url = os.getenv("GROCY_BACKEND_URL")
        if not url:
            client = request.getfixturevalue("client")
            client.headers.update(api_headers)
            yield client
            return
        if os.getenv("GROCY_BACKEND_DISPOSABLE") != "1":
            pytest.fail("The backend database must be disposable")
        key = os.getenv("GROCY_BACKEND_API_KEY", api_headers["GROCY-API-KEY"])
    else:
        url = os.getenv("GROCY_REFERENCE_URL")
        if not url:
            pytest.skip("Set GROCY_REFERENCE_URL for PHP comparison")
        if os.getenv("GROCY_REFERENCE_DISPOSABLE") != "1":
            pytest.fail("The reference database must be disposable")
        key = os.environ["GROCY_REFERENCE_API_KEY"]
    with httpx.Client(base_url=url, headers={"GROCY-API-KEY": key}, timeout=15) as backend:
        assert backend.get("/api/system/info").json()["grocy_version"]["Version"] == "4.5.0"
        yield backend


def create(api, resource, **fields):
    response = api.post(f"/api/objects/{resource}", json=fields)
    assert response.status_code == 200, response.text
    return int(response.json()["created_object_id"])


def rows(api, entity, **filters):
    response = api.get(
        f"/api/objects/{entity}",
        params=[("query[]", f"{key}={value}") for key, value in filters.items()],
    )
    assert response.status_code == 200, response.text
    return response.json()


def user_key(api, user):
    reference_url = os.getenv("GROCY_REFERENCE_URL")
    if reference_url and api.base_url == httpx.URL(reference_url):
        database_path = os.getenv("GROCY_REFERENCE_DATABASE")
        if not database_path:
            pytest.skip("Set GROCY_REFERENCE_DATABASE to create a reference user key")
        key = uuid4().hex
        with sqlite3.connect(database_path) as database:
            database.execute(
                "INSERT INTO api_keys (api_key, user_id, expires) "
                "VALUES (?, ?, '2999-12-31 23:59:59')",
                (key, user),
            )
        return key
    response = api.post("/api/v2/api-keys", json={"user_id": user})
    assert response.status_code == 200, response.text
    return response.json()["api_key"]


@pytest.fixture
def catalog(api):
    name = f"Parity {uuid4().hex}"
    unit = create(api, "quantity_units", name=name)
    other = create(api, "quantity_units", name=name + " small")
    location = create(api, "locations", name=name)
    product = create(
        api, "products", name=name, location_id=location, qu_id_stock=unit, qu_id_purchase=unit
    )
    return product, unit, other, location


def test_file_creation_preserves_existing_content(api, tmp_path, monkeypatch):
    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    name = f"{uuid4().hex}.txt"
    encoded = base64.b64encode(name.encode()).decode()
    path = f"/api/files/productpictures/{encoded}"
    assert api.put(path, content=b"first").status_code == 204
    try:
        assert api.put(path, content=b"second").status_code == 400
        response = api.get(path)
        assert response.content == b"first"
        assert response.headers["content-disposition"] == f'inline; filename="{name}"'
        assert response.headers["cache-control"] == "max-age=2592000"
    finally:
        assert api.delete(path).status_code == 204


def test_picture_mode_preserves_format_and_controls_resize(api, tmp_path, monkeypatch):
    from PIL import Image

    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    original = BytesIO()
    Image.new("RGB", (100, 50), "red").save(original, "JPEG")
    name = base64.b64encode(f"{uuid4().hex}.jpg".encode()).decode()
    path = f"/api/files/productpictures/{name}"
    assert api.put(path, content=original.getvalue()).status_code == 204
    try:
        assert api.get(path, params={"best_fit_width": 20}).content == original.getvalue()
        response = api.get(
            path,
            params={"force_serve_as": "picture", "best_fit_width": 20, "best_fit_height": 20},
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        with Image.open(BytesIO(response.content)) as picture:
            assert picture.size == (20, 10)
        assert api.get(path).content == original.getvalue()
    finally:
        assert api.delete(path).status_code == 204


@pytest.mark.parametrize(
    ("values", "query", "order", "expected"),
    [
        (["ABC", "AXXC"], "name~A_C", "id", [0]),
        (["ABBC", "AC"], "name~A%C", "id", [0, 1]),
        (["Ignored A", "Ignored B"], "name!>A", "id", [0, 1]),
        (["A", "B"], "name=A😀", "id", [0]),
        (["Emoji A", "Emoji B"], "name=😀", "id", None),
        (["A", "B"], "description=", "id", None),
        (["ÄBC", "äBC"], "name~äBC", "id", [1]),
        ([None, "text", "null"], "description!=null", "id", [0, 1]),
        ([None, "text", "null"], "description=null", "id", [0, 2]),
        ([None, "text"], None, "description:asc", [0, 1]),
    ],
)
def test_list_queries_follow_sqlite_comparison_rules(api, values, query, order, expected):
    group = uuid4().hex
    ids = [
        create(
            api,
            "locations",
            name=value if query and query.startswith("name") else f"{group} {index}",
            **({"description": value} if value is not None else {}),
        )
        for index, value in enumerate(values)
    ]
    params = [("order", order), ("query[]", f"id>={ids[0]}"), ("query[]", f"id<={ids[-1]}")]
    if query:
        params.append(("query[]", query))
    response = api.get("/api/objects/locations", params=params)
    if expected is None:
        assert response.status_code == 500, response.text
        return
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [ids[index] for index in expected]


def test_text_filters_keep_leading_zeros(api, catalog):
    product, *_ = catalog
    barcode = create(api, "product_barcodes", product_id=product, barcode="00123")
    response = api.get(
        "/api/objects/product_barcodes",
        params=[("query[]", f"id={barcode}"), ("query[]", "barcode=123")],
    )
    assert response.status_code == 200, response.text
    assert response.json() == []


def test_barcode_lookup_uses_sqlite_case_rules_and_stock_errors(api, catalog):
    product, *_ = catalog
    barcode = "Ä" + uuid4().hex
    create(api, "product_barcodes", product_id=product, barcode=barcode)
    path = "/api/stock/products/by-barcode/"
    response = api.get(path + barcode)
    assert response.status_code == 200, response.text
    assert response.json()["product"]["id"] == product
    assert api.get(path + barcode.replace("Ä", "ä")).status_code == 400
    assert api.get(path + uuid4().hex).status_code == 400
    assert api.put(f"/api/objects/products/{product}", json={"active": 0}).status_code == 204
    assert api.get(path + barcode).status_code == 400


@pytest.mark.parametrize(
    "method,path,body,status,payload",
    [
        ("GET", "/api/objects/locations/2147483647", None, 404, None),
        ("PUT", "/api/objects/locations/2147483647", {"name": "Missing"}, 400, None),
        ("DELETE", "/api/objects/locations/2147483647", None, 400, None),
        ("GET", "/api/stock/products/2147483647", None, 400, None),
        ("GET", "/api/stock/products/2147483647/printlabel", None, 400, None),
        ("GET", "/api/stock/entry/2147483647/printlabel", None, 500, None),
        ("GET", "/api/chores/2147483647/printlabel", None, 400, None),
        ("GET", "/api/batteries/2147483647/printlabel", None, 400, None),
        (
            "GET",
            "/api/recipes/2147483647/printlabel",
            None,
            200,
            {
                "recipe": None,
                "grocycode": "grcy:r:2147483647",
                "details": None,
                "font_family": "Source Sans Pro (Regular)",
            },
        ),
        ("GET", "/api/stock/products/2147483647/entries", None, 200, []),
        ("GET", "/api/stock/products/2147483647/locations", None, 200, []),
        ("GET", "/api/stock/locations/2147483647/entries", None, 500, None),
        ("GET", "/api/stock/entry/2147483647", None, 200, None),
        ("GET", "/api/stock/bookings/2147483647", None, 400, None),
        ("POST", "/api/stock/bookings/2147483647/undo", None, 400, None),
        ("GET", "/api/stock/transactions/missing", None, 400, None),
        ("POST", "/api/stock/transactions/missing/undo", None, 400, None),
        ("GET", "/api/chores/2147483647", None, 400, None),
        ("POST", "/api/chores/2147483647/execute", {}, 400, None),
        ("GET", "/api/batteries/2147483647", None, 400, None),
        ("POST", "/api/batteries/2147483647/charge", {}, 400, None),
        ("POST", "/api/tasks/2147483647/complete", {}, 400, None),
        ("POST", "/api/tasks/2147483647/undo", None, 400, None),
    ],
)
def test_missing_records_keep_grocy_status_and_empty_results(
    api, method, path, body, status, payload
):
    response = api.request(method, path, json=body)
    assert response.status_code == status, response.text
    if status == 200:
        assert response.json() == payload


def test_user_dto_shapes_and_permission_row_ids(api):
    response = api.get("/api/user")
    assert response.status_code == 200
    current = response.json()
    assert isinstance(current, list) and len(current) == 1
    name = uuid4().hex
    assert api.post("/api/users", json={"username": name, "password": "keep"}).status_code == 204
    users = api.get("/api/users", params={"query[]": f"username={name}"}).json()
    assert len(users) == 1
    user = users[0]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", user["row_created_timestamp"])
    assert user["first_name"] is None
    assert user["last_name"] is None
    assert user["picture_file_name"] is None
    assert user["display_name"] == name
    permissions = api.get(f"/api/users/{user['id']}/permissions").json()
    assert len(permissions) == 1
    assert permissions[0]["permission_id"] == 1
    assert permissions[0]["user_id"] == user["id"]
    assert isinstance(permissions[0]["id"], int)


def test_authenticated_access_without_module_permissions(api, catalog):
    reference_url = os.getenv("GROCY_REFERENCE_URL")
    is_reference = reference_url and api.base_url == httpx.URL(reference_url)
    if is_reference and not os.getenv("GROCY_REFERENCE_DATABASE"):
        pytest.skip("Set GROCY_REFERENCE_DATABASE to create a restricted reference key")
    product, *_ = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    chore = create(api, "chores", name=uuid4().hex, period_type="manually")
    task = create(api, "tasks", name=uuid4().hex)
    battery = create(api, "batteries", name=uuid4().hex)
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    assert api.put(f"/api/users/{user}/permissions", json={"permissions": []}).status_code == 204
    key = user_key(api, user)
    original = api.headers["GROCY-API-KEY"]
    api.headers["GROCY-API-KEY"] = key
    try:
        query_login = api.get(
            "/api/user", headers={"GROCY-API-KEY": "invalid"}, params={"GROCY-API-KEY": key}
        )
        assert query_login.status_code == 200, query_login.text
        assert query_login.json()[0]["id"] == user
        for path in (
            "/api/stock",
            "/api/stock/volatile",
            f"/api/stock/products/{product}",
            "/api/chores",
            f"/api/chores/{chore}",
            "/api/tasks",
            "/api/batteries",
            f"/api/recipes/{recipe}/fulfillment",
            "/api/recipes/fulfillment",
            "/api/objects/products",
            f"/api/userfields/products/{product}",
            "/api/calendar/ical",
            "/api/calendar/ical/sharing-link",
            "/api/system/config",
        ):
            response = api.get(path)
            assert response.status_code == 200, (path, response.text)
        assert api.get("/api/users").status_code == 403
        assert api.post(f"/api/stock/products/{product}/add", json={"amount": 1}).status_code == 403
        assert api.post("/api/objects/products", json={"name": uuid4().hex}).status_code == 403
        for resource, record, action in (
            ("chores", chore, "execute"),
            ("tasks", task, "complete"),
            ("batteries", battery, "charge"),
        ):
            for content, content_type in (
                (b"{}", None),
                (b"{}", "application/json; charset=utf-8"),
                (b"null", "application/json"),
                (b"{}", "application/json"),
            ):
                headers = {"Content-Type": content_type} if content_type else {}
                response = api.post(
                    f"/api/{resource}/{record}/{action}", content=content, headers=headers
                )
                expected = 400 if resource == "chores" else 403
                assert response.status_code == expected, (resource, content_type, response.text)
                if resource == "chores" and content_type == "application/json":
                    assert response.json() == {
                        "error_message": "Permission missing: CHORE_TRACK_EXECUTION"
                    }
        for method, path, permission, body in (
            ("POST", "/api/chores/executions/0/undo", "CHORE_UNDO_EXECUTION", {}),
            ("GET", f"/api/users/{user}/permissions", "ADMIN", None),
            ("POST", f"/api/users/{user}/permissions", "ADMIN", {"permission_id": 1}),
            ("PUT", f"/api/users/{user}/permissions", "ADMIN", {"permissions": [1]}),
        ):
            response = api.request(method, path, json=body)
            assert response.status_code == (400 if permission != "ADMIN" else 403), (
                method,
                path,
                response.text,
            )
            assert response.json() == {"error_message": f"Permission missing: {permission}"}
        assert rows(api, "chores_log", chore_id=chore) == []
        assert rows(api, "battery_charge_cycles", battery_id=battery) == []
        assert api.get(f"/api/objects/tasks/{task}").json()["done"] == 0
        assert api.post(f"/api/recipes/{recipe}/copy").status_code == 200
        response = api.post(
            "/api/chores/executions/calculate-next-assignments", json={"chore_id": chore}
        )
        assert response.status_code == 204, response.text
    finally:
        api.headers["GROCY-API-KEY"] = original


@pytest.mark.parametrize("permissions", [[], [5]])
def test_user_can_replace_own_administrator_permission(api, permissions):
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    key = user_key(api, user)
    owner = api.headers["GROCY-API-KEY"]
    api.headers["GROCY-API-KEY"] = key
    try:
        response = api.put(f"/api/users/{user}/permissions", json={"permissions": permissions})
        assert response.status_code == 204, response.text
        assert api.get("/api/user").json()[0]["id"] == user
        assert api.get("/api/users").status_code == (200 if 5 in permissions else 403)
        response = api.put(f"/api/users/{user}/permissions", json={"permissions": [1]})
        assert response.status_code == 403, response.text
    finally:
        api.headers["GROCY-API-KEY"] = owner
    assert [row["permission_id"] for row in api.get(f"/api/users/{user}/permissions").json()] == (
        permissions
    )


@pytest.mark.parametrize("permissions", [[], [10], [30]])
def test_chore_merge_requires_master_data_permission(api, permissions):
    keep = create(api, "chores", name=uuid4().hex, period_type="manually")
    remove = create(api, "chores", name=uuid4().hex, period_type="manually")
    execution = api.post(f"/api/chores/{remove}/execute", json={})
    assert execution.status_code == 200, execution.text
    log = execution.json()["id"]
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    key = user_key(api, user)
    assert (
        api.put(f"/api/users/{user}/permissions", json={"permissions": permissions}).status_code
        == 204
    )
    owner = api.headers["GROCY-API-KEY"]
    api.headers["GROCY-API-KEY"] = key
    try:
        response = api.post(f"/api/chores/{keep}/merge/{remove}")
        assert response.status_code == (204 if 30 in permissions else 403), response.text
    finally:
        api.headers["GROCY-API-KEY"] = owner
    assert api.get(f"/api/objects/chores/{keep}").status_code == 200
    assert api.get(f"/api/objects/chores/{remove}").status_code == (
        404 if 30 in permissions else 200
    )
    assert api.get(f"/api/objects/chores_log/{log}").json()["chore_id"] == (
        keep if 30 in permissions else remove
    )


@pytest.mark.parametrize("delete_self", [False, True])
def test_user_deletion_keeps_history_and_permissions(api, catalog, delete_self):
    product, *_ = catalog
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    key = user_key(api, user)
    permissions = api.get(f"/api/users/{user}/permissions").json()
    task = create(api, "tasks", name=uuid4().hex, assigned_to_user_id=user)
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="manually",
        next_execution_assigned_to_user_id=user,
        rescheduled_next_execution_assigned_to_user_id=user,
    )
    owner = api.headers["GROCY-API-KEY"]
    api.headers["GROCY-API-KEY"] = key
    try:
        setting = "deletion_" + uuid4().hex
        assert api.put(f"/api/user/settings/{setting}", json={"value": "kept"}).status_code == 204
        execution = api.post(f"/api/chores/{chore}/execute", json={})
        assert execution.status_code == 200, execution.text
        assert (
            api.put(
                f"/api/objects/chores/{chore}",
                json={
                    "next_execution_assigned_to_user_id": user,
                    "rescheduled_next_execution_assigned_to_user_id": user,
                },
            ).status_code
            == 204
        )
        booking = api.post(f"/api/stock/products/{product}/add", json={"amount": 1})
        assert booking.status_code == 200, booking.text
        if not delete_self:
            api.headers["GROCY-API-KEY"] = owner
        response = api.delete(f"/api/users/{user}")
        assert response.status_code == 204, response.text
    finally:
        api.headers["GROCY-API-KEY"] = owner
    assert api.get("/api/users", params={"query[]": f"id={user}"}).json() == []
    assert api.get(f"/api/users/{user}/permissions").json() == permissions
    assert api.get(f"/api/objects/tasks/{task}").json()["assigned_to_user_id"] == user
    saved_chore = api.get(f"/api/objects/chores/{chore}").json()
    assert saved_chore["next_execution_assigned_to_user_id"] == user
    assert saved_chore["rescheduled_next_execution_assigned_to_user_id"] == user
    assert (
        api.get(f"/api/objects/chores_log/{execution.json()['id']}").json()["done_by_user_id"]
        == user
    )
    assert api.get(f"/api/objects/stock_log/{booking.json()[0]['id']}").json()["user_id"] == user
    assert api.get("/api/user", headers={"GROCY-API-KEY": key}).status_code == 401
    assert (
        api.get(
            "/api/user", headers={"GROCY-API-KEY": key}, params={"GROCY-API-KEY": owner}
        ).status_code
        == 401
    )
    next_username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": next_username, "password": "test"}).status_code
        == 204
    )
    next_user = api.get("/api/users", params={"query[]": f"username={next_username}"}).json()[0][
        "id"
    ]
    assert next_user > user
    assert api.get("/api/user", headers={"GROCY-API-KEY": key}).status_code == 401


def test_missing_user_deletion_returns_grocy_error(api):
    response = api.delete("/api/users/2147483647")
    assert response.status_code == 500, response.text
    assert response.json()["error_message"] == "Call to a member function delete() on null"


@pytest.mark.parametrize(
    "body,status,expected,error",
    [
        (b'{"permissions":[]}', 204, [], None),
        (
            b'{"permissions":[7,7]}',
            400,
            [],
            "UNIQUE constraint failed: user_permissions.user_id, user_permissions.permission_id",
        ),
        (b'{"permissions":[999999]}', 204, [999999], None),
        (
            b'{"permissions":[7,null]}',
            400,
            [],
            "NOT NULL constraint failed: user_permissions.permission_id",
        ),
        (b'{"permissions":[false,true]}', 204, [0, 1], None),
        (b'{"permissions":[1.5]}', 204, [1.5], None),
        (b'{"permissions":["x",""]}', 204, [None, "x"], None),
        (
            b'{"permissions":[[7]]}',
            500,
            [],
            "PDO::quote(): Argument #1 ($string) must be of type string, array given",
        ),
        (b'{"permissions":{"a":7,"b":5}}', 204, [5, 7], None),
        (b'{"permissions":"7"}', 204, [], None),
        (b"{}", 204, [], None),
        (b"null", 204, [], None),
        (b"{", 204, [], None),
        (b"[7]", 204, [], None),
        (b'{"permissions":null}', 204, [], None),
        (
            b'{"permissions":[1,"1.0"]}',
            400,
            [],
            "UNIQUE constraint failed: user_permissions.user_id, user_permissions.permission_id",
        ),
        (b'{"permissions":[1e400]}', 204, ["INF"], None),
        (b'{"permissions":["7\\u0000x"]}', 204, [7], None),
    ],
)
def test_permission_replacement_matches_grocy_failures_and_values(
    api, body, status, expected, error
):
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    response = api.put(
        f"/api/users/{user}/permissions", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == status, response.text
    if error:
        prefix = "SQLSTATE[23000]: Integrity constraint violation: 19 " if status == 400 else ""
        assert response.json()["error_message"] == prefix + error
        if status == 400:
            assert response.json() == {"error_message": prefix + error}
    assert [
        row["permission_id"] for row in api.get(f"/api/users/{user}/permissions").json()
    ] == expected


@pytest.mark.parametrize(
    "body,status,expected,error",
    [
        (b'{"permission_id":7}', 204, [1, 7], None),
        (
            b'{"permission_id":1}',
            400,
            [1],
            "UNIQUE constraint failed: user_permissions.user_id, user_permissions.permission_id",
        ),
        (b'{"permission_id":999999}', 204, [1, 999999], None),
        (b'{"permission_id":null}', 204, [1, None], None),
        (b'{"permission_id":false}', 204, [0, 1], None),
        (b'{"permission_id":1.5}', 204, [1, 1.5], None),
        (b'{"permission_id":"x"}', 204, [1, "x"], None),
        (
            b'{"permission_id":[]}',
            400,
            [1],
            "table user_permissions has no column named permission_id_id",
        ),
        (b"{}", 400, [1], "NOT NULL constraint failed: user_permissions.permission_id"),
        (b"null", 400, [1], "NOT NULL constraint failed: user_permissions.permission_id"),
        (b"{", 400, [1], "NOT NULL constraint failed: user_permissions.permission_id"),
        (b"[]", 400, [1], "NOT NULL constraint failed: user_permissions.permission_id"),
        (b'{"permission_id":"&#55;"}', 204, [1, 7], None),
        (b'{"permission_id":1e400}', 204, [1, "INF"], None),
    ],
)
def test_permission_add_matches_grocy_values_and_errors(api, body, status, expected, error):
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    response = api.post(
        f"/api/users/{user}/permissions", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == status, response.text
    if error:
        prefix = (
            "SQLSTATE[HY000]: General error: 1 "
            if "no column named" in error
            else "SQLSTATE[23000]: Integrity constraint violation: 19 "
        )
        assert response.json() == {"error_message": prefix + error}
    assert [
        row["permission_id"] for row in api.get(f"/api/users/{user}/permissions").json()
    ] == expected


@pytest.mark.parametrize("method", ["POST", "PUT"])
@pytest.mark.parametrize("text_id", [False, True])
def test_permissions_allow_a_user_id_without_a_user_row(api, method, text_id):
    user = "missing'" + uuid4().hex if text_id else 2000000000 + int(uuid4().hex[:4], 16)
    body = {"permission_id": 7} if method == "POST" else {"permissions": [7]}
    response = api.request(method, f"/api/users/{user}/permissions", json=body)
    assert response.status_code == 204, response.text
    saved = api.get(f"/api/users/{user}/permissions").json()
    assert len(saved) == 1 and saved[0]["permission_id"] == 7 and saved[0]["user_id"] == user


def test_permission_row_ids_keep_input_order_and_never_reuse_deleted_ids(api):
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    path = f"/api/users/{user}/permissions"
    previous = api.get(path).json()[0]["id"]
    assert api.put(path, json={"permissions": [30, 5, 7]}).status_code == 204
    assert [(row["permission_id"], row["id"]) for row in api.get(path).json()] == [
        (5, previous + 2),
        (7, previous + 3),
        (30, previous + 1),
    ]
    assert api.put(path, json={"permissions": []}).status_code == 204
    assert api.post(path, json={"permission_id": 7}).status_code == 204
    assert api.get(path).json()[0]["id"] == previous + 4


@pytest.mark.parametrize(
    "content_type,body,expected",
    [
        ("application/json; charset=utf-8", b'{"permissions":[7]}', [7]),
        ("application/vnd.grocy+json", b'{"permissions":[7]}', [7]),
        ("Application/JSON", b'{"permissions":[7]}', [7]),
        ("application/x-www-form-urlencoded", b"permissions[]=7&permissions[]=5", [5, 7]),
        ("text/plain", b'{"permissions":[7]}', []),
        (None, b'{"permissions":[7]}', []),
        ("application/xml", b"<request><permissions>7</permissions></request>", []),
    ],
)
def test_permission_replacement_uses_grocy_media_type_parsers(api, content_type, body, expected):
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    response = api.put(
        f"/api/users/{user}/permissions",
        content=body,
        headers={"Content-Type": content_type} if content_type else {},
    )
    assert response.status_code == 204, response.text
    assert [
        row["permission_id"] for row in api.get(f"/api/users/{user}/permissions").json()
    ] == expected


def test_permission_add_bad_content_type_keeps_the_existing_permissions(api):
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    path = f"/api/users/{user}/permissions"
    before = api.get(path).json()
    response = api.post(
        path,
        content=b'{"permission_id":7}',
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert response.status_code == 400
    assert response.json() == {"error_message": "Bad Content-Type"}
    assert api.get(path).json() == before


@pytest.mark.parametrize(
    "entity",
    [
        "locations",
        "quantity_units",
        "product_groups",
        "shopping_locations",
        "shopping_lists",
        "task_categories",
        "tasks",
        "batteries",
        "chores",
        "equipment",
        "userentities",
        "userfields",
        "userobjects",
        "meal_plan_sections",
        "products",
        "product_barcodes",
        "quantity_unit_conversions",
        "shopping_list",
        "recipes",
        "recipes_pos",
        "recipes_nestings",
        "meal_plan",
    ],
)
def test_deleted_catalog_ids_are_not_reused(api, catalog, entity):
    product, unit, other, location = catalog
    name = uuid4().hex
    body = {"name": name}
    if entity == "products":
        body.update(location_id=location, qu_id_stock=unit, qu_id_purchase=unit)
    elif entity == "product_barcodes":
        body = {"product_id": product, "barcode": name}
    elif entity == "quantity_unit_conversions":
        body = {"from_qu_id": unit, "to_qu_id": other, "factor": 2, "product_id": product}
    elif entity == "shopping_list":
        body = {"product_id": product, "amount": 1, "shopping_list_id": 1}
    elif entity == "userfields":
        body.update(entity="locations", caption=name, type="text-single-line")
    elif entity == "userentities":
        body["caption"] = name
    elif entity == "userobjects":
        body = {"userentity_id": create(api, "userentities", name=name, caption=name)}
    elif entity in {"recipes_pos", "recipes_nestings"}:
        recipe = create(api, "recipes", name=name)
        body = {"recipe_id": recipe}
        if entity == "recipes_pos":
            body.update(product_id=product, amount=1, qu_id=unit)
        else:
            body.update(
                includes_recipe_id=create(api, "recipes", name=name + " included"), servings=1
            )
    elif entity == "meal_plan":
        body = {
            "day": "2027-01-04",
            "type": "note",
            "note": name,
            "section_id": create(api, "meal_plan_sections", name=name),
        }
    elif entity == "chores":
        body["period_type"] = "manually"
    first = create(api, entity, **body)
    deleted = api.delete(f"/api/objects/{entity}/{first}")
    assert deleted.status_code == 204, deleted.text
    second = create(api, entity, **body)
    step = 2 if entity == "quantity_unit_conversions" else 1
    assert second == first + step, (entity, first, second)


def test_consumed_stock_entry_id_is_not_reused(api, catalog):
    product, *_ = catalog
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 1}).status_code == 200
    first = api.get(f"/api/stock/products/{product}/entries").json()[0]["id"]
    assert api.post(f"/api/stock/products/{product}/consume", json={"amount": 1}).status_code == 200
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 1}).status_code == 200
    second = api.get(f"/api/stock/products/{product}/entries").json()[0]["id"]
    assert second == first + 1


@pytest.mark.parametrize(
    "resource,action,entity",
    [
        ("chores", "execute", "chores_log"),
        ("batteries", "charge", "battery_charge_cycles"),
    ],
)
def test_deleted_parent_history_ids_are_not_reused(api, resource, action, entity):
    body = {"name": uuid4().hex}
    if resource == "chores":
        body["period_type"] = "manually"
    first_parent = create(api, resource, **body)
    first = api.post(f"/api/{resource}/{first_parent}/{action}", json={})
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]
    assert api.delete(f"/api/objects/{resource}/{first_parent}").status_code == 204
    second_parent = create(api, resource, **body)
    second = api.post(f"/api/{resource}/{second_parent}/{action}", json={})
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first_id + 1
    assert (
        rows(
            api, entity, **{("chore_id" if resource == "chores" else "battery_id"): second_parent}
        )[0]["id"]
        == second.json()["id"]
    )


def test_deleted_product_stock_history_id_is_not_reused(api, catalog):
    product, unit, _other, location = catalog
    first = api.post(f"/api/stock/products/{product}/add", json={"amount": 1})
    assert first.status_code == 200, first.text
    assert api.delete(f"/api/objects/products/{product}").status_code == 204
    product = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    second = api.post(f"/api/stock/products/{product}/add", json={"amount": 1})
    assert second.status_code == 200, second.text
    assert second.json()[0]["id"] == first.json()[0]["id"] + 1


@pytest.mark.parametrize(
    "entity,field,valid,invalid,expression",
    [
        *[
            (entity, "active", 0, 2, "active IN (0, 1)")
            for entity in (
                "batteries",
                "chores",
                "locations",
                "product_groups",
                "products",
                "quantity_units",
                "shopping_locations",
                "task_categories",
            )
        ],
        ("chores", "period_interval", 2, 0, "period_interval > 0"),
        ("tasks", "done", 1, 2, "done IN (0, 1)"),
        ("meal_plan", "done", 1, 2, "done IN (0, 1)"),
        ("recipes_pos", "round_up", 1, 2, "round_up IN (0, 1)"),
        ("userfields", "input_required", 1, 2, "input_required IN (0, 1)"),
        *[
            ("products", field, 1, 2, f"{field} IN (0, 1)")
            for field in (
                "hide_on_stock_overview",
                "should_not_be_frozen",
                "treat_opened_as_out_of_stock",
                "no_own_stock",
                "move_on_open",
                "auto_reprint_stock_label",
                "disable_open",
            )
        ],
        ("products", "due_type", 2, 0, "due_type IN (1, 2)"),
        (
            "products",
            "default_purchase_price_type",
            3,
            0,
            "default_purchase_price_type IN (1, 2, 3)",
        ),
    ],
)
def test_generic_check_constraints_preserve_rejected_records(
    api, catalog, entity, field, valid, invalid, expression
):
    product, unit, _other, location = catalog
    name = uuid4().hex
    body = {"name": name}
    if entity == "products":
        body.update(location_id=location, qu_id_stock=unit, qu_id_purchase=unit)
    elif entity == "chores":
        body["period_type"] = "manually"
    elif entity == "userfields":
        body.update(entity="locations", caption=name, type="text-single-line")
    elif entity == "meal_plan":
        body = {"day": "2027-01-04", "type": "note", "note": name}
    elif entity == "recipes_pos":
        body = {
            "recipe_id": create(api, "recipes", name=name),
            "product_id": product,
            "qu_id": unit,
            "amount": 1,
        }
    path = f"/api/objects/{entity}"
    expected = {
        "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 "
        f"CHECK constraint failed: {expression}"
    }
    rejected = api.post(path, json={**body, field: invalid})
    assert rejected.status_code == 400, rejected.text
    assert rejected.json() == expected
    record = create(api, entity, **body, **{field: valid})
    path += f"/{record}"
    before = api.get(path).json()
    rejected = api.put(path, json={field: invalid})
    assert rejected.status_code == 400, rejected.text
    assert rejected.json() == expected
    assert api.get(path).json() == before


@pytest.mark.parametrize(
    "value,expected",
    [
        ("1e0", 1),
        (" 1 ", 1),
        ("0.0", 0),
        (True, 1),
        (None, None),
        ("invalid", None),
        (0.5, None),
        ("0_1", None),
    ],
)
def test_generic_checked_numbers_use_sqlite_affinity(api, value, expected):
    response = api.post("/api/objects/tasks", json={"name": uuid4().hex, "done": value})
    if expected is None:
        assert response.status_code == 400, response.text
        assert response.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint "
            "violation: 19 CHECK constraint failed: done IN (0, 1)"
        }
    else:
        assert response.status_code == 200, response.text
        record = response.json()["created_object_id"]
        assert api.get(f"/api/objects/tasks/{record}").json()["done"] == expected


def test_generic_creation_returns_the_native_id_response(api):
    response = api.post("/api/objects/locations", json={"name": uuid4().hex})
    assert response.status_code == 200, response.text
    record = response.json()["created_object_id"]
    assert response.json() == {"created_object_id": str(record)}
    assert api.get(f"/api/objects/locations/{record}").status_code == 200


def generic_body(api, catalog, entity) -> dict[str, Any]:
    product, unit, other, location = catalog
    name = uuid4().hex
    body: dict[str, Any] = {"name": name}
    if entity == "products":
        body.update(
            location_id=location,
            qu_id_stock=unit,
            qu_id_purchase=unit,
            qu_id_consume=unit,
            qu_id_price=unit,
            parent_product_id=product,
            default_consume_location_id=location,
            product_group_id=create(api, "product_groups", name=name),
        )
    elif entity == "chores":
        body.update(period_type="manually", product_id=product)
    elif entity == "tasks":
        body["category_id"] = create(api, "task_categories", name=name)
    elif entity == "recipes":
        body["product_id"] = product
    elif entity == "userfields":
        body.update(entity="locations", caption=name, type="text-single-line")
    elif entity == "userentities":
        body["caption"] = name
    elif entity == "userobjects":
        body = {"userentity_id": create(api, "userentities", name=name, caption=name)}
    elif entity == "product_barcodes":
        body = {"product_id": product, "qu_id": unit, "barcode": name}
    elif entity == "quantity_unit_conversions":
        body = {"from_qu_id": unit, "to_qu_id": other, "product_id": product, "factor": 2}
    elif entity == "shopping_list":
        body = {"product_id": product, "qu_id": unit, "shopping_list_id": 1, "amount": 1}
    elif entity in {"recipes_pos", "recipes_nestings", "meal_plan"}:
        recipe = create(api, "recipes", name=name)
        if entity == "recipes_pos":
            body = {"recipe_id": recipe, "product_id": product, "qu_id": unit, "amount": 1}
        elif entity == "recipes_nestings":
            body = {
                "recipe_id": recipe,
                "includes_recipe_id": create(api, "recipes", name=name + " child"),
                "servings": 1,
            }
        else:
            body = {
                "day": "2027-01-04",
                "type": "note",
                "note": name,
                "section_id": create(api, "meal_plan_sections", name=name),
                "recipe_id": recipe,
                "recipe_servings": 1,
                "product_id": product,
                "product_amount": 1,
                "product_qu_id": unit,
            }
    return body


@pytest.mark.parametrize(
    "entity",
    [
        "batteries",
        "chores",
        "equipment",
        "locations",
        "product_groups",
        "products",
        "quantity_units",
        "shopping_locations",
        "shopping_lists",
        "task_categories",
        "tasks",
        "recipes",
        "meal_plan_sections",
        "userfields",
        "userentities",
    ],
)
def test_generic_names_accept_empty_values_with_native_required_and_unique_rules(
    api, catalog, entity
):
    body = generic_body(api, catalog, entity)
    without_name = {key: value for key, value in body.items() if key != "name"}
    missing = api.post(f"/api/objects/{entity}", json=without_name)
    if without_name:
        assert missing.status_code == 400, missing.text
        assert missing.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 "
            f"NOT NULL constraint failed: {entity}.name"
        }
    else:
        assert missing.status_code == 200, missing.text
        assert missing.json() == {"created_object_id": "0"}
    if entity == "meal_plan_sections":
        rejected = api.post(f"/api/objects/{entity}", json={**body, "name": ""})
        assert rejected.status_code == 400, rejected.text
        assert rejected.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 "
            "UNIQUE constraint failed: meal_plan_sections.name"
        }
    else:
        body["name"] = ""
    record = create(api, entity, **body)
    path = f"/api/objects/{entity}/{record}"
    try:
        assert api.get(path).json()["name"] == (body["name"] or None)
        assert api.put(path, json={"name": "   "}).status_code == 204
        assert api.get(path).json()["name"] == "   "
    finally:
        assert api.delete(path).status_code == 204


@pytest.mark.parametrize(
    "entity,field",
    [
        *[
            ("products", field)
            for field in (
                "location_id",
                "qu_id_purchase",
                "qu_id_stock",
                "default_consume_location_id",
                "parent_product_id",
                "product_group_id",
                "qu_id_consume",
                "qu_id_price",
            )
        ],
        ("product_barcodes", "product_id"),
        ("product_barcodes", "qu_id"),
        ("chores", "product_id"),
        ("tasks", "category_id"),
        *[
            ("meal_plan", field)
            for field in ("product_id", "product_qu_id", "recipe_id", "section_id")
        ],
        ("recipes", "product_id"),
        *[("recipes_pos", field) for field in ("product_id", "qu_id", "recipe_id")],
        ("recipes_nestings", "includes_recipe_id"),
        ("recipes_nestings", "recipe_id"),
        ("userobjects", "userentity_id"),
        *[("shopping_list", field) for field in ("product_id", "qu_id", "shopping_list_id")],
        *[
            ("quantity_unit_conversions", field)
            for field in ("from_qu_id", "product_id", "to_qu_id")
        ],
    ],
)
def test_generic_references_accept_missing_parents_after_native_insert_checks(
    api, catalog, entity, field
):
    body = generic_body(api, catalog, entity)
    missing = 2147483647
    errors = {
        ("products", "qu_id_stock"): "QU conversion already exists",
        ("product_barcodes", "product_id"): "product_id doesn't reference a existing product",
        (
            "recipes_pos",
            "product_id",
        ): "Provided qu_id doesn't have a related conversion for that product",
        (
            "recipes_pos",
            "qu_id",
        ): "Provided qu_id doesn't have a related conversion for that product",
    }
    if (entity, field) in errors:
        rejected = api.post(f"/api/objects/{entity}", json={**body, field: missing})
        assert rejected.status_code == 400, rejected.text
        assert rejected.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 "
            + errors[entity, field]
        }
        record = create(api, entity, **body)
    else:
        record = create(api, entity, **{**body, field: missing})
        assert api.get(f"/api/objects/{entity}/{record}").json()[field] == missing
    path = f"/api/objects/{entity}/{record}"
    restored = api.put(path, json={field: body[field]})
    assert restored.status_code == 204, restored.text
    replaced = api.put(path, json={field: missing})
    assert replaced.status_code == 204, replaced.text
    assert api.get(path).json()[field] == missing


@pytest.mark.parametrize("entity", ["product_barcodes", "recipes_pos", "shopping_list"])
def test_orphan_product_defaults_keep_null_units_or_reject_the_insert(api, catalog, entity):
    body = generic_body(api, catalog, entity)
    body.pop("qu_id")
    body["product_id"] = 2147483647
    response = api.post(f"/api/objects/{entity}", json=body)
    if entity != "shopping_list":
        error = (
            "product_id doesn't reference a existing product"
            if entity == "product_barcodes"
            else "Provided qu_id doesn't have a related conversion for that product"
        )
        assert response.status_code == 400, response.text
        assert response.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 " + error
        }
        return
    assert response.status_code == 200, response.text
    record = response.json()["created_object_id"]
    saved = api.get(f"/api/objects/{entity}/{record}").json()
    assert saved["product_id"] == 2147483647
    assert saved["qu_id"] is None


def test_internal_meal_section_keeps_the_native_delete_guard(api):
    path = "/api/objects/meal_plan_sections/-1"
    before = api.get(path)
    assert before.status_code == 200, before.text
    assert before.json()["name"] is None
    assert before.json()["sort_number"] == -1
    rejected = api.delete(path)
    assert rejected.status_code == 500, rejected.text
    assert rejected.json()["error_message"] == (
        "SQLSTATE[23000]: Integrity constraint violation: 19 "
        "This is an internally used/required default section and therefore can't be deleted"
    )
    assert api.get(path).json() == before.json()


def test_disabled_feature_flags_control_dates_calendar_and_labels(api, catalog, monkeypatch):
    from datetime import date, timedelta

    from grocy.core.config import clear_settings_cache

    flags = (
        "TASKS",
        "CHORES",
        "BATTERIES",
        "RECIPES_MEALPLAN",
        "STOCK_BEST_BEFORE_DATE_TRACKING",
        "STOCK_PRODUCT_FREEZING",
    )
    reference_url = os.getenv("GROCY_REFERENCE_URL")
    is_reference = reference_url and api.base_url == httpx.URL(reference_url)
    if is_reference and os.getenv("GROCY_FEATURE_FLAG_TASKS") != "false":
        pytest.skip("Run the disabled feature flag reference profile")
    if not is_reference:
        for flag in flags:
            monkeypatch.setenv(f"GROCY_FEATURE_FLAG_{flag}", "false")
        monkeypatch.setenv("GROCY_FEATURE_FLAG_STOCK_PRICE_TRACKING", "off")
        clear_settings_cache()
    config = api.get("/api/system/config").json()
    assert all(config[f"FEATURE_FLAG_{flag}"] is False for flag in flags)
    assert config["FEATURE_FLAG_STOCK_PRICE_TRACKING"] == "off"
    product, _, _, location = catalog
    freezer = create(api, "locations", name=uuid4().hex, is_freezer=1)
    assert (
        api.put(
            f"/api/objects/products/{product}",
            json={
                "default_best_before_days": 2,
                "default_best_before_days_after_freezing": 30,
                "default_best_before_days_after_thawing": 5,
            },
        ).status_code
        == 204
    )
    path = f"/api/stock/products/{product}"
    bought = api.post(path + "/add", json={"amount": 1, "location_id": freezer, "price": 3})
    assert bought.status_code == 200, bought.text
    due = (date.today() + timedelta(days=2)).isoformat()
    entry = api.get(path + "/entries").json()[0]
    assert entry["best_before_date"] == due
    assert entry["price"] == 3
    label = api.get(f"/api/stock/entry/{entry['id']}/printlabel")
    assert label.status_code == 200, label.text
    assert "due_date" not in label.json()
    transferred = api.post(
        path + "/transfer",
        json={
            "amount": 1,
            "location_id_from": freezer,
            "location_id_to": location,
        },
    )
    assert transferred.status_code == 200, transferred.text
    assert api.get(path + "/entries").json()[0]["best_before_date"] == due
    create(api, "tasks", name=uuid4().hex, due_date="2030-02-03")
    create(api, "chores", name=uuid4().hex, period_type="daily", start_date="2030-02-03 12:00:00")
    battery = create(api, "batteries", name=uuid4().hex, charge_interval_days=1)
    assert (
        api.post(
            f"/api/batteries/{battery}/charge", json={"tracked_time": "2030-02-03 12:00:00"}
        ).status_code
        == 200
    )
    create(api, "meal_plan", day="2030-02-03", type="note", note=uuid4().hex)
    calendar = api.get("/api/calendar/ical")
    assert calendar.status_code == 200, calendar.text
    assert "BEGIN:VEVENT" not in calendar.text
    assert api.get("/api/tasks").status_code == 200
    assert api.get(path).status_code == 200


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("GET", "", None),
        ("GET", "/price-history", None),
        ("POST", "/add", {"amount": 1}),
        ("POST", "/consume", {"amount": 1}),
        ("POST", "/open", {"amount": 1}),
        ("POST", "/inventory", {"new_amount": 3}),
        ("POST", "/transfer", {"amount": 1}),
    ],
)
def test_inactive_products_reject_stock_actions(api, catalog, method, suffix, body):
    product, _, _, location = catalog
    path = f"/api/stock/products/{product}"
    assert api.post(path + "/add", json={"amount": 2}).status_code == 200
    assert api.put(f"/api/objects/products/{product}", json={"active": 0}).status_code == 204
    assert api.get(f"/api/objects/products/{product}").json()["active"] == 0
    assert api.get(path + "/entries").status_code == 200
    if suffix == "/transfer":
        destination = create(api, "locations", name=uuid4().hex)
        body = {**body, "location_id_from": location, "location_id_to": destination}
    response = api.request(method, path + suffix, json=body)
    assert response.status_code == 400, response.text


def test_chore_consumption_uses_gross_tare_amount(api, catalog):
    product, *_ = catalog
    assert (
        api.put(
            f"/api/objects/products/{product}",
            json={"enable_tare_weight_handling": 1, "tare_weight": 100},
        ).status_code
        == 204
    )
    path = f"/api/stock/products/{product}"
    assert api.post(path + "/add", json={"amount": 1100}).status_code == 200
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="manually",
        consume_product_on_execution=1,
        product_id=product,
        product_amount=600,
    )
    response = api.post(f"/api/chores/{chore}/execute", json={})
    assert response.status_code == 200, response.text
    assert api.get(path).json()["stock_amount"] == 500
    assert (
        api.put(
            f"/api/objects/chores/{chore}",
            json={"product_amount": 2000, "rescheduled_date": "2030-02-03 14:15:16"},
        ).status_code
        == 204
    )
    failed = api.post(f"/api/chores/{chore}/execute", json={})
    assert failed.status_code == 400, failed.text
    assert len(rows(api, "chores_log", chore_id=chore)) == 2
    assert api.get(path).json()["stock_amount"] == 500
    assert (
        api.get(f"/api/objects/chores/{chore}").json()["rescheduled_date"].startswith("2030-02-03")
    )


@pytest.mark.parametrize("action", ["add", "consume", "transfer-from", "transfer-to", "inventory"])
def test_inactive_locations_reject_stock_bookings(api, catalog, action):
    product, _, _, location = catalog
    path = f"/api/stock/products/{product}"
    assert api.post(path + "/add", json={"amount": 2}).status_code == 200
    other = create(api, "locations", name=uuid4().hex)
    assert api.put(f"/api/objects/locations/{location}", json={"active": 0}).status_code == 204
    body = {"amount": 1, "location_id": location}
    route = action
    if action == "inventory":
        body = {"new_amount": 3, "location_id": location}
    elif action.startswith("transfer-"):
        route = "transfer"
        source, target = (location, other) if action == "transfer-from" else (other, location)
        if action == "transfer-to":
            assert (
                api.post(path + "/add", json={"amount": 2, "location_id": other}).status_code == 200
            )
        body = {"amount": 1, "location_id_from": source, "location_id_to": target}
    response = api.post(path + "/" + route, json=body)
    assert response.status_code == 400, response.text


@pytest.mark.parametrize("factor,opened", [(10, 12), (None, 1)])
def test_open_child_stock_follows_grocy_entry_conversion(api, catalog, factor, opened):
    product, unit, other, location = catalog
    child = create(
        api,
        "products",
        name=uuid4().hex,
        parent_product_id=product,
        location_id=location,
        qu_id_stock=other,
        qu_id_purchase=other,
    )
    if factor is not None:
        create(
            api,
            "quantity_unit_conversions",
            product_id=child,
            from_qu_id=unit,
            to_qu_id=other,
            factor=factor,
        )
    for due in ("2031-01-01", "2032-01-01"):
        assert (
            api.post(
                f"/api/stock/products/{child}/add", json={"amount": 6, "best_before_date": due}
            ).status_code
            == 200
        )
    response = api.post(
        f"/api/stock/products/{product}/open",
        json={"amount": 1, "allow_subproduct_substitution": True},
    )
    assert response.status_code == 200, response.text
    entries = api.get(f"/api/stock/products/{child}/entries").json()
    assert sum(row["amount"] for row in entries if row["open"]) == opened
    assert sum(row["amount"] for row in response.json()) == opened


@pytest.mark.parametrize(
    "entity,action,log_entity",
    [
        ("chores", "execute", "chores_log"),
        ("batteries", "charge", "battery_charge_cycles"),
    ],
)
def test_household_actions_return_the_stored_log(api, entity, action, log_entity):
    item = create(
        api, entity, name=uuid4().hex, **({"period_type": "manually"} if entity == "chores" else {})
    )
    response = api.post(
        f"/api/{entity}/{item}/{action}",
        json={"tracked_time": "2027-02-03 14:15:16"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["tracked_time"] == "2027-02-03 14:15:16"
    stored = api.get(f"/api/objects/{log_entity}/{payload['id']}").json()
    stored.pop("userfields", None)
    assert payload == stored


def test_least_done_assignment_breaks_ties_by_user_id(api):
    ids = []
    for prefix in ("Z", "A"):
        username = prefix + uuid4().hex
        assert (
            api.post("/api/users", json={"username": username, "password": "test"}).status_code
            == 204
        )
        ids.append(
            api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
        )
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="manually",
        assignment_type="who-least-did-first",
        assignment_config=",".join(map(str, ids)),
    )
    response = api.post(
        "/api/chores/executions/calculate-next-assignments", json={"chore_id": chore}
    )
    assert response.status_code == 204, response.text
    result = api.get(f"/api/chores/{chore}").json()
    assigned = result["next_execution_assigned_user"]
    assert assigned["id"] == ids[0]
    users = api.get("/api/users", params={"query[]": f"id={ids[0]}"}).json()
    assert assigned == users[0]
    assert (
        api.put(
            f"/api/objects/chores/{chore}",
            json={"rescheduled_next_execution_assigned_to_user_id": ids[1]},
        ).status_code
        == 204
    )
    assert api.get(f"/api/chores/{chore}").json()["next_execution_assigned_user"]["id"] == ids[0]
    response = api.post(
        "/api/chores/executions/calculate-next-assignments", json={"chore_id": chore}
    )
    assert response.status_code == 204, response.text
    assert api.get(f"/api/chores/{chore}").json()["next_execution_assigned_user"]["id"] == ids[1]


def test_stock_unit_change_converts_history_and_undo(api, catalog):
    product, unit, other, _ = catalog
    create(api, "quantity_unit_conversions", from_qu_id=unit, to_qu_id=other, factor=10)
    base = f"/api/stock/products/{product}"
    assert api.post(base + "/add", json={"amount": 2, "price": 4}).status_code == 200
    used = api.post(base + "/consume", json={"amount": 1})
    assert used.status_code == 200, used.text
    assert (
        api.put(f"/api/objects/products/{product}", json={"qu_id_stock": other}).status_code == 204
    )
    details = api.get(base).json()
    assert details["stock_amount"] == 10
    assert details["last_price"] == pytest.approx(0.4)
    logs = rows(api, "stock_log", product_id=product)
    assert sorted(log["amount"] for log in logs) == [-10, 20]
    assert api.post(f"/api/stock/bookings/{used.json()[0]['id']}/undo").status_code == 204
    entries = api.get(base + "/entries").json()
    assert sum(row["amount"] for row in entries) == 20
    assert all(row["price"] == pytest.approx(0.4) for row in entries)


def test_stock_unit_change_requires_conversion_after_purchase(api, catalog):
    product, unit, other, _ = catalog
    base = f"/api/stock/products/{product}"
    assert api.post(base + "/add", json={"amount": 2}).status_code == 200
    response = api.put(f"/api/objects/products/{product}", json={"qu_id_stock": other})
    assert response.status_code == 400, response.text
    assert api.get(f"/api/objects/products/{product}").json()["qu_id_stock"] == unit
    assert api.get(base).json()["stock_amount"] == 2


def test_conversion_inverse_tracks_edits_and_delete(api, catalog):
    _, unit, other, _ = catalog
    conversion = create(
        api, "quantity_unit_conversions", from_qu_id=unit, to_qu_id=other, factor=10
    )
    inverse = rows(api, "quantity_unit_conversions", from_qu_id=other, to_qu_id=unit)
    assert len(inverse) == 1
    assert inverse[0]["factor"] == pytest.approx(0.1)
    assert (
        api.put(
            f"/api/objects/quantity_unit_conversions/{conversion}", json={"factor": 4}
        ).status_code
        == 204
    )
    assert rows(api, "quantity_unit_conversions", from_qu_id=other, to_qu_id=unit)[0][
        "factor"
    ] == pytest.approx(0.25)
    assert api.delete(f"/api/objects/quantity_unit_conversions/{conversion}").status_code == 204
    assert rows(api, "quantity_unit_conversions", from_qu_id=other, to_qu_id=unit) == []


def test_catalog_defaults_and_zero_shopping_amount(api, catalog):
    product, unit, _, _ = catalog
    assert api.get(f"/api/objects/products/{product}").json()["treat_opened_as_out_of_stock"] == 1
    barcode = create(api, "product_barcodes", product_id=product, barcode=uuid4().hex)
    assert api.get(f"/api/objects/product_barcodes/{barcode}").json()["qu_id"] == unit
    recipe = create(api, "recipes", name=uuid4().hex)
    ingredient = create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2)
    assert api.get(f"/api/objects/recipes_pos/{ingredient}").json()["qu_id"] == unit
    item = create(api, "shopping_list", product_id=product, amount=0)
    assert api.get(f"/api/objects/shopping_list/{item}").json()["qu_id"] == unit


def test_delete_product_cascades_current_records(api, catalog):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex, product_id=product)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    create(api, "product_barcodes", product_id=product, barcode=uuid4().hex)
    create(api, "shopping_list", product_id=product, amount=1)
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 2}).status_code == 200
    assert api.delete(f"/api/objects/products/{product}").status_code == 204
    assert api.get(f"/api/objects/recipes/{recipe}").json()["product_id"] is None
    for entity in ("stock", "stock_log", "product_barcodes", "shopping_list", "recipes_pos"):
        assert rows(api, entity, product_id=product) == []


def test_meal_plan_internal_recipes_follow_servings(api, catalog):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex, base_servings=2)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=6, qu_id=unit)
    day = "2036-03-17"
    entry = create(api, "meal_plan", day=day, type="recipe", recipe_id=recipe, recipe_servings=4)
    day_recipes = rows(api, "recipes", name=day, type="mealplan-day")
    assert len(day_recipes) == 1
    resolved = rows(api, "recipes_pos_resolved", recipe_id=day_recipes[0]["id"])
    assert resolved[0]["recipe_amount"] == 12
    shadow = rows(api, "recipes", name=f"{day}#{entry}", type="mealplan-shadow")
    assert len(shadow) == 1
    assert (
        api.put(f"/api/objects/recipes/{recipe}", json={"product_id": product}).status_code == 204
    )
    assert api.post(f"/api/recipes/{shadow[0]['id']}/consume").status_code == 204
    assert api.get(f"/api/stock/products/{product}").json()["stock_amount"] == 4
    assert (
        api.put(f"/api/objects/meal_plan/{entry}", json={"recipe_servings": 2}).status_code == 204
    )
    day_recipe = rows(api, "recipes", name=day, type="mealplan-day")[0]
    assert rows(api, "recipes_pos_resolved", recipe_id=day_recipe["id"])[0]["recipe_amount"] == 6
    assert api.delete(f"/api/objects/meal_plan/{entry}").status_code == 204
    day_recipe = rows(api, "recipes", name=day, type="mealplan-day")[0]
    assert rows(api, "recipes_pos_resolved", recipe_id=day_recipe["id"]) == []


def test_recipe_shopping_excludes_supplied_product_ids(api, catalog):
    product, unit, _, location = catalog
    other_product = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    recipe = create(api, "recipes", name=uuid4().hex)
    for product_id in (product, other_product):
        create(api, "recipes_pos", recipe_id=recipe, product_id=product_id, amount=2, qu_id=unit)
    response = api.post(
        f"/api/recipes/{recipe}/add-not-fulfilled-products-to-shoppinglist",
        json={"excludedProductIds": [product]},
    )
    assert response.status_code == 204, response.text
    assert rows(api, "shopping_list", product_id=product) == []
    assert rows(api, "shopping_list", product_id=other_product)[0]["amount"] == 2


def test_inventory_increase_uses_last_price_and_store(api, catalog):
    product, _, _, _ = catalog
    store = create(api, "shopping_locations", name=uuid4().hex)
    base = f"/api/stock/products/{product}"
    assert (
        api.post(
            base + "/add", json={"amount": 2, "price": 3, "shopping_location_id": store}
        ).status_code
        == 200
    )
    inventory = api.post(base + "/inventory", json={"new_amount": 4})
    assert inventory.status_code == 200, inventory.text
    assert inventory.json()[0]["price"] == 3
    assert inventory.json()[0]["shopping_location_id"] == store


def test_stock_entry_label_has_product_details_and_entry(api, catalog):
    product, _, _, _ = catalog
    base = f"/api/stock/products/{product}"
    assert (
        api.post(base + "/add", json={"amount": 2, "best_before_date": "2036-01-01"}).status_code
        == 200
    )
    entry = api.get(base + "/entries").json()[0]
    label = api.get(f"/api/stock/entry/{entry['id']}/printlabel").json()
    assert label["details"]["product"]["id"] == product
    assert label["stock_entry"]["stock_id"] == entry["stock_id"]
    assert label["due_date"] == "DD: 2036-01-01"


def test_recipe_fulfillment_has_costs_calories_and_price_state(api, catalog):
    product, unit, _, _ = catalog
    assert api.put(f"/api/objects/products/{product}", json={"calories": 80}).status_code == 204
    assert (
        api.post(f"/api/stock/products/{product}/add", json={"amount": 3, "price": 2}).status_code
        == 200
    )
    recipe = create(api, "recipes", name=uuid4().hex, base_servings=2)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    response = api.get(f"/api/recipes/{recipe}/fulfillment")
    assert response.status_code == 200
    result = response.json()
    assert result["costs_per_serving"] == 2
    assert result["calories"] == 80
    assert result["prices_incomplete"] == 0
    assert result["need_fulfilled"] == 1
    assert (
        result["product_names_comma_separated"]
        == api.get(f"/api/objects/products/{product}").json()["name"]
    )


def test_shopping_api_preserves_the_requested_unit(api, catalog):
    product, unit, other, _ = catalog
    create(
        api,
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=other,
        to_qu_id=unit,
        factor=10,
    )
    assert (
        api.put(f"/api/objects/products/{product}", json={"qu_id_purchase": other}).status_code
        == 204
    )
    body = {"product_id": product, "product_amount": 2, "note": "first"}
    assert api.post("/api/stock/shoppinglist/add-product", json=body).status_code == 204
    item = rows(api, "shopping_list", product_id=product)[0]
    assert (item["amount"], item["qu_id"]) == (2, other)
    assert (
        api.post(
            "/api/stock/shoppinglist/add-product", json={"product_id": product, "product_amount": 1}
        ).status_code
        == 204
    )
    item = rows(api, "shopping_list", product_id=product)[0]
    assert item["amount"] == 3
    assert item["note"] is None


def test_minimum_stock_setting_adds_shopping_after_consumption(api, catalog):
    product, unit, _, _ = catalog
    shopping_list = create(api, "shopping_lists", name=uuid4().hex)
    settings = {
        "shopping_list_auto_add_below_min_stock_amount": True,
        "shopping_list_auto_add_below_min_stock_amount_list_id": shopping_list,
    }
    for key, value in settings.items():
        assert api.put(f"/api/user/settings/{key}", json={"value": value}).status_code == 204
    try:
        assert api.post(f"/api/stock/products/{product}/add", json={"amount": 3}).status_code == 200
        assert (
            api.put(f"/api/objects/products/{product}", json={"min_stock_amount": 2}).status_code
            == 204
        )
        assert (
            api.post(f"/api/stock/products/{product}/consume", json={"amount": 2}).status_code
            == 200
        )
        item = rows(api, "shopping_list", product_id=product)[0]
        assert (item["amount"], item["qu_id"], item["shopping_list_id"]) == (1, unit, shopping_list)
        assert (
            api.post(f"/api/stock/products/{product}/consume", json={"amount": 1}).status_code
            == 200
        )
        assert rows(api, "shopping_list", product_id=product)[0]["amount"] == 2
    finally:
        for key in settings:
            assert api.delete(f"/api/user/settings/{key}").status_code == 204


def test_merge_products_converts_quantities_and_output_references(api, catalog):
    product, unit, other, location = catalog
    keep = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=other,
        qu_id_purchase=other,
    )
    create(
        api,
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=unit,
        to_qu_id=other,
        factor=10,
    )
    recipe = create(api, "recipes", name=uuid4().hex, product_id=product)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    assert (
        api.post(f"/api/stock/products/{product}/add", json={"amount": 2, "price": 4}).status_code
        == 200
    )
    merged = api.post(f"/api/stock/products/{keep}/merge/{product}")
    assert merged.status_code == 204, merged.text
    assert api.get(f"/api/stock/products/{keep}").json()["stock_amount"] == 20
    assert api.get(f"/api/objects/recipes/{recipe}").json()["product_id"] == keep
    assert rows(api, "recipes_pos", recipe_id=recipe)[0]["amount"] == 20


def test_presence_only_recipe_keeps_an_unrelated_shopping_unit(api, catalog):
    product, unit, other, location = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    create(
        api,
        "recipes_pos",
        recipe_id=recipe,
        product_id=product,
        amount=2,
        qu_id=other,
        only_check_single_unit_in_stock=1,
    )
    response = api.post(
        f"/api/recipes/{recipe}/add-not-fulfilled-products-to-shoppinglist", json={}
    )
    assert response.status_code == 204, response.text
    item = rows(api, "shopping_list", product_id=product)[0]
    assert (item["amount"], item["qu_id"]) == (2, other)
    second_product = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=other,
    )
    conversions = rows(api, "quantity_unit_conversions", product_id=second_product)
    assert {(row["from_qu_id"], row["to_qu_id"]) for row in conversions} == {
        (unit, other),
        (other, unit),
    }


def test_inventory_counts_all_locations_and_rejects_an_unchanged_count(api, catalog):
    product, _, _, location = catalog
    second = create(api, "locations", name=uuid4().hex)
    base = f"/api/stock/products/{product}"
    for place, amount in ((location, 5), (second, 3)):
        assert (
            api.post(base + "/add", json={"amount": amount, "location_id": place}).status_code
            == 200
        )
    assert (
        api.post(base + "/inventory", json={"new_amount": 2, "location_id": location}).status_code
        == 200
    )
    assert api.get(base).json()["stock_amount"] == 2
    assert api.post(base + "/inventory", json={"new_amount": 2}).status_code == 400


def test_shopping_removal_uses_the_configured_decimal_threshold(api, catalog):
    product, unit, _, _ = catalog
    item = create(api, "shopping_list", product_id=product, amount=1.005, qu_id=unit)
    assert (
        api.put("/api/user/settings/stock_decimal_places_amounts", json={"value": 2}).status_code
        == 204
    )
    try:
        assert (
            api.post(
                "/api/stock/shoppinglist/remove-product",
                json={"product_id": product, "product_amount": 1},
            ).status_code
            == 204
        )
        assert api.get(f"/api/objects/shopping_list/{item}").status_code == 404
    finally:
        assert api.delete("/api/user/settings/stock_decimal_places_amounts").status_code == 204


def test_child_stock_locations_keep_each_product_id(api, catalog):
    product, unit, _, location = catalog
    child = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        parent_product_id=product,
    )
    for identifier, amount in ((product, 2), (child, 3)):
        assert (
            api.post(f"/api/stock/products/{identifier}/add", json={"amount": amount}).status_code
            == 200
        )
    response = api.get(
        f"/api/stock/products/{product}/locations", params={"include_sub_products": True}
    )
    assert response.status_code == 200
    assert sorted((row["product_id"], row["amount"]) for row in response.json()) == [
        (product, 2),
        (child, 3),
    ]


def test_equivalent_purchases_compact_and_follow_reference_undo(api, catalog):
    product, _, _, _ = catalog
    base = f"/api/stock/products/{product}"
    bookings = []
    for amount in (2, 3):
        response = api.post(
            base + "/add",
            json={"amount": amount, "price": 2, "best_before_date": "2037-01-01", "note": "{"},
        )
        assert response.status_code == 200, response.text
        bookings.append(response.json()[0]["id"])
    entries = api.get(base + "/entries").json()
    assert len(entries) == 1
    assert entries[0]["amount"] == 5
    logs = rows(api, "stock_log", product_id=product)
    assert len({row["stock_id"] for row in logs}) == 1
    for booking, expected in zip(reversed(bookings), (0, 0), strict=True):
        assert api.post(f"/api/stock/bookings/{booking}/undo").status_code == 204
        assert api.get(base).json()["stock_amount"] == expected


def test_stock_custom_fields_use_booking_transactions_and_prevent_compaction(api, catalog):
    product, _, _, _ = catalog
    field = "batch_" + uuid4().hex
    create(api, "userfields", entity="stock", name=field, caption="Batch", type="text-single-line")
    base = f"/api/stock/products/{product}"
    body = {"amount": 2, "price": 2, "best_before_date": "2037-02-01"}
    purchase = api.post(base + "/add", json=body)
    assert purchase.status_code == 200
    entry = api.get(base + "/entries").json()[0]
    path = f"/api/userfields/stock/{entry['stock_id']}"
    response = api.put(
        f"/api/userfields/stock/{purchase.json()[0]['transaction_id']}", json={field: "Batch A"}
    )
    assert response.status_code == 204, response.text
    assert api.get(path).json() == {field: "Batch A"}
    assert api.post(base + "/add", json=body).status_code == 200
    assert len(api.get(base + "/entries").json()) == 2
    stored = api.get(f"/api/objects/stock/{entry['id']}").json()
    assert stored["userfields"] == {field: "Batch A"}


@pytest.mark.parametrize(("mode", "amounts"), [(0, [2.5]), (1, [2.5]), (2, [1, 1])])
def test_stock_labels_follow_php_modes_and_fractional_amounts(api, catalog, mode, amounts):
    product, _, _, _ = catalog
    response = api.post(
        f"/api/stock/products/{product}/add", json={"amount": 2.5, "stock_label_type": mode}
    )
    assert response.status_code == 200, response.text
    assert [row["amount"] for row in response.json()] == amounts
    assert api.get(f"/api/stock/products/{product}").json()["stock_amount"] == sum(amounts)


def test_full_transfer_undo_uses_grocy_default_location_and_open_state(api, catalog):
    product, _, _, default_location = catalog
    source = create(api, "locations", name=uuid4().hex)
    store = create(api, "shopping_locations", name=uuid4().hex)
    base = f"/api/stock/products/{product}"
    assert (
        api.post(
            base + "/add", json={"amount": 3, "location_id": source, "shopping_location_id": store}
        ).status_code
        == 200
    )
    assert api.post(base + "/open", json={"amount": 3}).status_code == 200
    transfer = api.post(
        base + "/transfer",
        json={"amount": 3, "location_id_from": source, "location_id_to": default_location},
    )
    assert transfer.status_code == 200
    assert api.post(f"/api/stock/bookings/{transfer.json()[0]['id']}/undo").status_code == 204
    entry = api.get(base + "/entries").json()[0]
    assert (
        entry["amount"],
        entry["location_id"],
        entry["open"],
        entry["shopping_location_id"],
    ) == (3, default_location, 0, None)


def test_recipe_copy_uses_the_grocy_name_and_serving_defaults(api, catalog):
    product, unit, _, _ = catalog
    name = uuid4().hex
    recipe = create(api, "recipes", name=name, base_servings=2)
    assert (
        api.put(f"/api/objects/recipes/{recipe}", json={"desired_servings": 6}).status_code == 204
    )
    create(
        api, "recipes_pos", recipe_id=recipe, product_id=product, amount=1.5, qu_id=unit, round_up=1
    )
    response = api.post(f"/api/recipes/{recipe}/copy")
    assert response.status_code == 200
    copied = response.json()["created_object_id"]
    row = api.get(f"/api/objects/recipes/{copied}").json()
    assert row["name"] == f"Copy of {name}"
    assert row["desired_servings"] == 2
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", row["row_created_timestamp"])
    ingredient = rows(api, "recipes_pos", recipe_id=copied)[0]
    assert (ingredient["amount"], ingredient["round_up"]) == (1.5, 0)


def test_stock_edit_undo_after_consumption_restores_the_original_amount(api, catalog):
    product, _, _, _ = catalog
    base = f"/api/stock/products/{product}"
    assert api.post(base + "/add", json={"amount": 4, "price": 2}).status_code == 200
    assert api.post(base + "/consume", json={"amount": 1}).status_code == 200
    entry = api.get(base + "/entries").json()[0]
    edited = api.put(
        f"/api/stock/entry/{entry['id']}",
        json={"amount": 5, "price": 3, "open": False, "purchased_date": entry["purchased_date"]},
    )
    assert edited.status_code == 200, edited.text
    assert api.post(base + "/consume", json={"amount": 1}).status_code == 200
    undone = api.post(f"/api/stock/bookings/{edited.json()[0]['id']}/undo")
    assert undone.status_code == 204, undone.text
    assert api.get(base).json()["stock_amount"] == 3
    assert api.get(base + "/entries").json()[0]["price"] == 2


@pytest.mark.parametrize(
    "resource,action,field,log_entity",
    [
        ("tasks", "complete", "done_time", None),
        ("batteries", "charge", "tracked_time", "battery_charge_cycles"),
        ("chores", "execute", "tracked_time", "chores_log"),
    ],
)
@pytest.mark.parametrize(
    "value",
    [
        "2027-01-04 16:20:00",
        "2027-01-04",
        "2027-01-04T16:20:00",
        "2027-01-04 16:20:00+00:00",
        "2027-01-04 16:20:00.000",
        "2027-02-29 16:20:00",
        "invalid",
        1800000000,
        None,
        [],
        {},
    ],
)
def test_household_time_input_matches_grocy(api, resource, action, field, log_entity, value):
    options = {"period_type": "daily", "track_date_only": 0} if resource == "chores" else {}
    record = create(api, resource, name=uuid4().hex, **options)
    before = api.get("/api/system/time").json()["time_local_sqlite3"]
    response = api.post(f"/api/{resource}/{record}/{action}", json={field: value})
    if isinstance(value, (list, dict)):
        assert response.status_code == 500, response.text
        if resource == "tasks":
            assert api.get(f"/api/objects/tasks/{record}").json()["done"] == 0
        else:
            owner = "battery_id" if resource == "batteries" else "chore_id"
            assert rows(api, log_entity, **{owner: record}) == []
        return
    assert response.status_code == (204 if resource == "tasks" else 200), response.text
    if resource == "tasks":
        actual = api.get(f"/api/objects/tasks/{record}").json()["done_timestamp"]
    else:
        actual = response.json()["tracked_time"]
        stored = api.get(f"/api/objects/{log_entity}/{response.json()['id']}").json()
        assert stored["tracked_time"] == actual
    if value == "2027-01-04 16:20:00" or (resource == "chores" and value == "2027-01-04"):
        assert actual == value
    else:
        after = api.get("/api/system/time").json()["time_local_sqlite3"]
        assert (
            datetime.fromisoformat(before)
            <= datetime.fromisoformat(actual)
            <= datetime.fromisoformat(after)
        )


def test_chore_date_precision_survives_reads_and_recurrence(api):
    chore = create(api, "chores", name=uuid4().hex, period_type="adaptive", track_date_only=0)
    times = ["2027-01-04", "2027-01-04 00:00:00", "2027-01-05 12:00:00", "2027-01-05 13:00:00"]
    for tracked in times:
        response = api.post(f"/api/chores/{chore}/execute", json={"tracked_time": tracked})
        assert response.status_code == 200, response.text
        assert response.json()["tracked_time"] == tracked
        assert api.get(f"/api/chores/{chore}").json()["last_tracked"] == tracked
    details = api.get(f"/api/chores/{chore}").json()
    assert details["average_execution_frequency_hours"] == 12
    assert details["next_estimated_execution_time"] == "2027-01-06 01:00:00"
    assert api.put(f"/api/objects/chores/{chore}", json={"track_date_only": 1}).status_code == 204
    response = api.post(f"/api/chores/{chore}/execute", json={"tracked_time": "2027-01-06"})
    assert response.status_code == 200, response.text
    assert response.json()["tracked_time"] == "2027-01-06 00:00:00"


@pytest.mark.parametrize(
    "value,expected",
    [
        (
            '<p style="color:red;position:fixed" onclick="x()">Hello<script>alert(1)</script></p>',
            '<p style="color:#FF0000;">Hello</p>',
        ),
        ('<a href="javascript:alert(1)">Link</a>', "<a>Link</a>"),
        ("Tom &amp; Jerry &lt;food&gt;", "Tom & Jerry <food>"),
        ("", None),
        (None, None),
        (1.25, "1.25"),
        (True, "1"),
        (False, "0"),
    ],
)
def test_html_input_matches_grocy_storage(api, value, expected):
    location = create(api, "locations", name=uuid4().hex, description=value)
    assert api.get(f"/api/objects/locations/{location}").json()["description"] == expected
    assert (
        api.put(f"/api/objects/locations/{location}", json={"description": value}).status_code
        == 204
    )
    assert api.get(f"/api/objects/locations/{location}").json()["description"] == expected


def test_stock_input_is_purified_before_numeric_and_date_parsing(api, catalog):
    product, _unit, _other, _location = catalog
    response = api.post(
        f"/api/stock/products/{product}/add",
        json={
            "amount": "&#50;",
            "best_before_date": "2037&#45;01&#45;01",
            "note": '<a href="javascript:alert(1)">Link</a>',
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()[0]["amount"] == 2
    assert response.json()[0]["note"] == "<a>Link</a>"
    entry = api.get(f"/api/stock/products/{product}/entries").json()[0]
    assert entry["best_before_date"] == "2037-01-01"
    assert entry["note"] == "<a>Link</a>"


@pytest.mark.parametrize(
    "content_type", [None, "text/plain", "application/json; charset=utf-8", "Application/JSON"]
)
def test_filtered_input_requires_exact_json_content_type(api, content_type):
    headers = {"Content-Type": content_type} if content_type is not None else {}
    response = api.post(
        "/api/objects/locations", content=json.dumps({"name": uuid4().hex}), headers=headers
    )
    assert response.status_code == 400, response.text
    response = api.post(
        "/api/objects/locations", content=b"{}", headers={**headers, "GROCY-API-KEY": "invalid"}
    )
    assert response.status_code == 401, response.text


def test_unfiltered_permission_input_accepts_json_parameters(api):
    response = api.put(
        "/api/users/1/permissions",
        content=b'{"permissions":[1]}',
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert response.status_code == 204, response.text
    assert api.get("/api/users/1/permissions").json()[0]["permission_id"] == 1


def test_user_fields_and_settings_use_the_same_purifier(api):
    raw = '<a href="javascript:alert(1)">Link</a>'
    setting = "purifier_" + uuid4().hex
    path = f"/api/user/settings/{setting}"
    try:
        assert api.put(path, json={"value": raw}).status_code == 204
        assert api.get(path).json()["value"] == "<a>Link</a>"
    finally:
        assert api.delete(path).status_code == 204
    name = uuid4().hex
    location = create(api, "locations", name=name)
    create(api, "userfields", entity="locations", name=name, caption=name, type="text-single-line")
    path = f"/api/userfields/locations/{location}"
    assert api.put(path, json={name: raw}).status_code == 204
    assert api.get(path).json()[name] == "<a>Link</a>"
    username = "purifier_" + uuid4().hex
    assert (
        api.post(
            "/api/users", json={"username": username, "first_name": raw, "password": "secret"}
        ).status_code
        == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()
    assert len(user) == 1 and user[0]["first_name"] == "<a>Link</a>"


@pytest.mark.parametrize(
    "content",
    [b"{", b'{"name":"value","description":"\\ud800"}', b'{"name":NaN}', b'{"name":"\xff"}'],
)
def test_invalid_json_input_returns_grocy_status(api, content):
    response = api.post(
        "/api/objects/locations", content=content, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400, response.text
    name = uuid4().hex
    location = create(api, "locations", name=name, description='<a href="javascript:x()">Link</a>')
    assert api.get(f"/api/objects/locations/{location}").json()["description"] == "<a>Link</a>"


def test_large_html_input_keeps_the_complete_filtered_value(api):
    text = "food" * 25000
    location = create(
        api, "locations", name=uuid4().hex, description="<p>" + text + "<script>bad</script></p>"
    )
    assert (
        api.get(f"/api/objects/locations/{location}").json()["description"] == "<p>" + text + "</p>"
    )


@pytest.mark.parametrize("content", [b"", b"null", b"false", b'"value"', b"{"])
@pytest.mark.parametrize(
    "kind,status", [("locations", 400), ("tasks", 500), ("setting", 204), ("shopping", 500)]
)
def test_unparsed_body_follows_each_grocy_handler(api, content, kind, status):
    task = None
    if kind == "tasks":
        task = create(api, "tasks", name=uuid4().hex)
        path, method = f"/api/tasks/{task}/complete", "POST"
    elif kind == "setting":
        path, method = f"/api/user/settings/{uuid4().hex}", "PUT"
    elif kind == "shopping":
        path, method = "/api/stock/shoppinglist/add-missing-products", "POST"
    else:
        path, method = "/api/objects/locations", "POST"
    try:
        response = api.request(
            method, path, content=content, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == status, response.text
        if kind == "setting":
            assert api.get(path).json()["value"] is None
        elif task is not None:
            assert api.get(f"/api/objects/tasks/{task}").json()["done"] == 0
    finally:
        if kind == "setting":
            assert api.delete(path).status_code == 204


@pytest.mark.parametrize(
    "resource,action,status",
    [("tasks", "complete", 204), ("chores", "execute", 200), ("batteries", "charge", 200)],
)
@pytest.mark.parametrize("content", [b"[]", b'["ignored"]'])
def test_array_body_keeps_php_array_key_rules(api, resource, action, status, content):
    options = {"period_type": "daily"} if resource == "chores" else {}
    record = create(api, resource, name=uuid4().hex, **options)
    response = api.post(
        f"/api/{resource}/{record}/{action}",
        content=content,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == status, response.text


@pytest.mark.parametrize("number,expected", [("1e400", "INF"), ("-1e400", "-INF")])
def test_numeric_json_is_parsed_by_the_php_runtime(api, number, expected):
    content = '{"name":"' + uuid4().hex + '","description":' + number + "}"
    response = api.post(
        "/api/objects/locations", content=content, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 200, response.text
    location = response.json()["created_object_id"]
    assert api.get(f"/api/objects/locations/{location}").json()["description"] == expected


@pytest.mark.parametrize("empty", [None, ""])
def test_empty_optional_stock_values_use_grocy_defaults(api, catalog, empty):
    product, _unit, _other, location = catalog
    today = api.get("/api/system/time").json()["time_local_sqlite3"][:10]
    response = api.post(
        f"/api/stock/products/{product}/add",
        json={
            "amount": 1,
            "best_before_date": empty,
            "purchased_date": empty,
            "price": empty,
            "location_id": empty,
            "shopping_location_id": empty,
            "stock_label_type": empty,
            "note": empty,
        },
    )
    assert response.status_code == 200, response.text
    entry = api.get(f"/api/stock/products/{product}/entries").json()[0]
    assert entry["best_before_date"] == today
    assert entry["purchased_date"] == today
    assert entry["location_id"] == location
    assert (
        entry["price"] is None and entry["shopping_location_id"] is None and entry["note"] is None
    )


def test_empty_chore_options_keep_the_current_actor_and_default_flags(api):
    chore = create(api, "chores", name=uuid4().hex, period_type="daily")
    response = api.post(f"/api/chores/{chore}/execute", json={"done_by": None, "skipped": None})
    assert response.status_code == 200, response.text
    assert response.json()["done_by_user_id"] == 1
    assert not response.json()["skipped"]
