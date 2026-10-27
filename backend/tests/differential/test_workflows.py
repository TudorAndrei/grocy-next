"""Public workflows checked against both implementations of the pinned Grocy API."""

import base64
import json
import os
import re
import sqlite3
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest

from php_runtime import DEVELOPMENT_PROFILES


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
def execute_sql(api):
    reference = api.base_url == httpx.URL(os.getenv("GROCY_REFERENCE_URL", "http://unused"))
    if not hasattr(api, "portal") and not reference:
        pytest.skip("The trigger fixture needs access to the disposable database")

    def execute(statement):
        if hasattr(api, "portal"):
            from grocy.db.session import get_session_factory

            async def run():
                async with get_session_factory()() as session:
                    connection = await session.connection()
                    result = await connection.exec_driver_sql(statement)
                    rows = [tuple(row) for row in result] if result.returns_rows else None
                    await session.commit()
                    return rows

            return api.portal.call(run)
        else:
            with sqlite3.connect(os.environ["GROCY_REFERENCE_DATABASE"]) as database:
                result = database.execute(statement)
                return result.fetchall() if result.description else None

    return execute


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


@pytest.fixture
def custom_field(api, request):
    def create_field(**values):
        field = create(api, "userfields", **values)
        request.addfinalizer(lambda: api.delete(f"/api/objects/userfields/{field}"))
        return field

    return create_field


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
        ([None, "text"], "description§^$", "id", [0]),
        (["text", "other"], "description§[", "id", []),
        (["a" * 300, "other"], "description§" + "a" * 300, "id", [0]),
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
                elif resource in {"tasks", "batteries"}:
                    permission = (
                        "TASKS_MARK_COMPLETED"
                        if resource == "tasks"
                        else "BATTERIES_TRACK_CHARGE_CYCLE"
                    )
                    assert response.json()["error_message"] == f"Permission missing: {permission}"
                    assert set(response.json()) == {"error_message", "error_details"}
                    assert response.headers["access-control-allow-origin"] == "*"
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


@pytest.mark.parametrize(
    "entity,target,rename",
    [
        ("locations", "locations", True),
        ("products", "products", True),
        ("stock", "stock", True),
        ("locations", "tasks", False),
        ("locations", "tasks", True),
    ],
)
def test_custom_field_definition_changes_keep_saved_values(
    api, custom_field, catalog, entity, target, rename
):
    product, _unit, _other, location = catalog
    name = "field" + uuid4().hex
    field = custom_field(entity=entity, name=name, caption=name, type="text-single-line")
    reference = str(product if entity in {"products", "stock"} else location)
    write_reference = reference
    if entity == "stock":
        purchase = api.post(f"/api/stock/products/{product}/add", json={"amount": 1})
        assert purchase.status_code == 200, purchase.text
        write_reference = purchase.json()[0]["transaction_id"]
        reference = purchase.json()[0]["stock_id"]
    assert (
        api.put(f"/api/userfields/{entity}/{write_reference}", json={name: "Saved"}).status_code
        == 204
    )
    new_name = name + "new" if rename else name
    changed = api.put(f"/api/objects/userfields/{field}", json={"name": new_name, "entity": target})
    assert changed.status_code == 204, changed.text
    assert api.get(f"/api/userfields/{target}/{reference}").json()[new_name] == "Saved"
    assert (
        api.put(f"/api/userfields/{target}/{reference}", json={new_name: "Updated"}).status_code
        == 204
    )
    assert api.get(f"/api/userfields/{target}/{reference}").json()[new_name] == "Updated"


@pytest.mark.parametrize(
    "names,expected",
    [
        (["0"], ["Saved 0"]),
        (["1", "0"], ["Saved 0", "Saved 1"]),
        (["0", "2"], {"0": "Saved 0", "2": "Saved 2"}),
        (["00", "0"], {"0": "Saved 0", "00": "Saved 0"}),
        (["z", "a", "B"], {"a": "Saved a", "B": "Saved B", "z": "Saved z"}),
    ],
)
def test_custom_field_response_shape_and_order(api, custom_field, names, expected):
    name = "fields_" + uuid4().hex
    create(api, "userentities", name=name, caption=name)
    namespace = "userentity-" + name
    for field in names:
        custom_field(
            entity=namespace, name=field, caption=field, type="text-single-line", sort_number=0
        )
    path = f"/api/userfields/{namespace}/text-key"
    assert api.put(path, json={field: f"Saved {field}" for field in names}).status_code == 204
    response = api.get(path)
    assert response.status_code == 200
    assert response.json() == expected
    if isinstance(expected, dict):
        assert list(response.json()) == list(expected)


def test_custom_record_field_namespaces_and_generic_response_shapes(api, custom_field):
    name = "fields_" + uuid4().hex
    entity = create(api, "userentities", name=name, caption=name)
    record = create(api, "userobjects", userentity_id=entity)
    namespace = "userentity-" + name
    custom_field(entity=namespace, name="saved", caption="Saved", type="text-single-line")
    path = f"/api/userfields/{namespace}/{record}"
    assert api.put(path, json={"saved": "Namespace value"}).status_code == 204
    alias = f"/api/userfields/userobjects/{record}"
    assert api.get(alias).json() == []
    assert api.get(f"/api/objects/userobjects/{record}").json()["userfields"] is None
    listed = rows(api, "userobjects", id=record)
    assert len(listed) == 1 and "userfields" not in listed[0]
    rejected = api.put(alias, json={"saved": "Wrong namespace"})
    assert rejected.status_code == 400
    assert rejected.json()["error_message"] == (
        "Field saved is not a valid userfield of the given entity"
    )
    assert api.get(path).json() == {"saved": "Namespace value"}
    custom_field(entity="userobjects", name="0", caption="Direct", type="text-single-line")
    assert api.get(f"/api/objects/userobjects/{record}").json()["userfields"] == [None]
    assert rows(api, "userobjects", id=record)[0]["userfields"] == [None]
    assert api.put(alias, json={"0": "Direct value"}).status_code == 204
    assert api.get(alias).json() == ["Direct value"]
    assert api.get(f"/api/objects/userobjects/{record}").json()["userfields"] == ["Direct value"]
    assert rows(api, "userobjects", id=record)[0]["userfields"] == ["Direct value"]
    assert api.get(path).json() == {"saved": "Namespace value"}
    custom_field(entity="userobjects", name="saved", caption="Direct", type="text-single-line")
    assert api.put(alias, json={"saved": "Hidden direct value"}).status_code == 204
    expected = {"0": "Direct value", "saved": "Namespace value"}
    assert api.get(alias).json() == expected
    assert api.get(f"/api/objects/userobjects/{record}").json()["userfields"] == expected
    assert rows(api, "userobjects", id=record)[0]["userfields"] == expected


def test_generic_field_lists_use_numeric_object_comparison(api, custom_field):
    name = "fields_" + uuid4().hex
    entity = create(api, "userentities", name=name, caption=name)
    record = create(api, "userobjects", userentity_id=entity)
    custom_field(entity="userobjects", name="saved", caption="Saved", type="text-single-line")
    assert (
        api.put(
            f"/api/userfields/userobjects/0{record}", json={"saved": "Leading zero"}
        ).status_code
        == 204
    )
    assert api.get(f"/api/userfields/userobjects/{record}").json() == {"saved": None}
    assert api.get(f"/api/objects/userobjects/{record}").json()["userfields"] == {"saved": None}
    assert rows(api, "userobjects", id=record)[0]["userfields"] == {"saved": "Leading zero"}


@pytest.mark.parametrize("entity", ["locations", "products", "recipes"])
@pytest.mark.parametrize("format_id", ["0{}", "{}.0", "{}e0", "+{}", " {} "])
def test_generic_object_text_ids_keep_field_keys_and_allow_writes(
    api, custom_field, catalog, entity, format_id
):
    record = catalog[0] if entity == "products" else create(api, entity, name=uuid4().hex)
    key = format_id.format(record)
    field = "key_" + uuid4().hex
    custom_field(entity=entity, name=field, caption=field, type="text-single-line")
    assert (
        api.put(f"/api/userfields/{entity}/{record}", json={field: "Canonical"}).status_code == 204
    )
    assert api.put(f"/api/userfields/{entity}/{key}", json={field: "Text key"}).status_code == 204
    path = f"/api/objects/{entity}/{key}"
    fetched = api.get(path)
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["id"] == record
    assert fetched.json()["userfields"][field] == "Text key"
    assert api.put(path, json={"description": "Updated by text key"}).status_code == 204
    assert api.get(f"/api/objects/{entity}/{record}").json()["description"] == "Updated by text key"
    assert api.get(f"/api/userfields/{entity}/{record}").json()[field] == "Canonical"
    assert api.delete(path).status_code == 204
    missing = api.get(f"/api/objects/{entity}/{record}")
    assert missing.status_code == 404
    assert missing.json() == {"error_message": "Object not found"}


@pytest.mark.parametrize(
    "key", ["text-id", "9223372036854775808", "1.5", "999999999999999999999e999"]
)
def test_generic_missing_text_ids_return_native_errors(api, key):
    path = f"/api/objects/locations/{key}"
    for method, status, kwargs in [
        ("get", 404, {}),
        ("put", 400, {"json": {"description": "Rejected"}}),
        ("delete", 400, {}),
    ]:
        response = getattr(api, method)(path, **kwargs)
        assert response.status_code == status, response.text
        assert response.json() == {"error_message": "Object not found"}


@pytest.mark.parametrize(
    "entity", ["stock_current_locations", "products_last_purchased", "products_average_price"]
)
def test_generic_view_dummy_ids_keep_sqlite_comparison_rules(api, catalog, entity):
    product = catalog[0]
    purchased = api.post(
        f"/api/stock/products/{product}/add",
        json={"amount": 1, "best_before_date": "2999-12-31", "price": 2},
    )
    assert purchased.status_code == 200, purchased.text
    listed = rows(api, entity, product_id=product)
    assert listed and listed[0]["id"] == 1
    for key in ("1", "01", "1e0"):
        response = api.get(f"/api/objects/{entity}/{key}")
        assert response.status_code == 404, response.text
        assert response.json() == {"error_message": "Object not found"}


@pytest.mark.parametrize("key", ["1", "01", "1e0", "+1", "1.0", " 1 "])
def test_generic_permission_ids_use_native_integer_affinity(api, key):
    response = api.get(f"/api/objects/permission_hierarchy/{key}")
    assert response.status_code == 200, response.text
    assert response.json() == {"id": 1, "name": "ADMIN", "parent": None, "userfields": None}


@pytest.mark.parametrize(
    "method,entity,suffix,message",
    [
        ("get", "unknown_entity", "", "Entity does not exist or is not exposed"),
        ("get", "unknown_entity", "/text-id", "Entity does not exist or is not exposed"),
        ("post", "unknown_entity", "", "Entity does not exist or is not exposed"),
        ("put", "unknown_entity", "/text-id", "Entity does not exist or is not exposed"),
        ("delete", "unknown_entity", "/text-id", "Invalid entity"),
        ("get", "api_keys", "", "Entity does not exist or is not exposed"),
        ("get", "api_keys", "/text-id", "Entity does not exist or is not exposed"),
        ("post", "stock", "", "Entity does not exist or is not exposed"),
        ("put", "stock", "/text-id", "Entity does not exist or is not exposed"),
        ("delete", "stock", "/text-id", "Invalid entity"),
    ],
)
def test_generic_entity_operation_guards_return_native_errors(api, method, entity, suffix, message):
    kwargs = {"json": {"name": "Rejected"}} if method in {"post", "put"} else {}
    response = getattr(api, method)(f"/api/objects/{entity}{suffix}", **kwargs)
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": message}


def test_custom_field_failed_definition_change_keeps_both_values(api, custom_field, catalog):
    _product, _unit, _other, location = catalog
    names = ["field" + uuid4().hex, "field" + uuid4().hex]
    fields = [
        custom_field(entity="locations", name=name, caption=name, type="text-single-line")
        for name in names
    ]
    path = f"/api/userfields/locations/{location}"
    values = dict(zip(names, ["First", "Second"], strict=True))
    assert api.put(path, json=values).status_code == 204
    before = api.get(f"/api/objects/userfields/{fields[0]}").json()
    rejected = api.put(
        f"/api/objects/userfields/{fields[0]}", json={"name": names[1], "caption": "Rejected"}
    )
    assert rejected.status_code == 400, rejected.text
    assert {name: api.get(path).json()[name] for name in names} == values
    assert api.get(f"/api/objects/userfields/{fields[0]}").json() == before


def test_custom_field_object_keys_keep_text_identity_and_partial_writes(api, custom_field):
    name = "field" + uuid4().hex
    field = custom_field(entity="locations", name=name, caption=name, type="text-single-line")
    paths = [f"/api/userfields/locations/{key}" for key in ("1", "01", "record-text")]
    for index, path in enumerate(paths):
        response = api.put(path, json={name: str(index)})
        assert response.status_code == 204, response.text
    assert [api.get(path).json()[name] for path in paths] == ["0", "1", "2"]
    rejected = api.put(paths[0], json={name: "Committed first", "unknown" + name: "Rejected"})
    assert rejected.status_code == 400, rejected.text
    assert api.get(paths[0]).json()[name] == "Committed first"
    assert api.delete(f"/api/objects/userfields/{field}").status_code == 204
    replacement = custom_field(entity="locations", name=name, caption=name, type="text-single-line")
    assert replacement > field
    assert [api.get(path).json()[name] for path in paths] == [None, None, None]


@pytest.mark.parametrize(
    "entity,kept",
    [
        ("locations", True),
        ("tasks", True),
        ("products", False),
        ("chores", False),
        ("batteries", False),
        ("userobjects", True),
    ],
)
def test_custom_field_values_follow_native_object_deletion(
    api, custom_field, catalog, entity, kept
):
    name = "field" + uuid4().hex
    body = generic_body(api, catalog, entity)
    record = create(api, entity, **body)
    custom_field(entity=entity, name=name, caption=name, type="text-single-line")
    path = f"/api/userfields/{entity}/{record}"
    assert api.put(path, json={name: "Saved"}).status_code == 204
    assert api.delete(f"/api/objects/{entity}/{record}").status_code == 204
    values = api.get(path)
    assert values.status_code == 200, values.text
    assert values.json()[name] == ("Saved" if kept else None)


def test_custom_entity_deletion_keeps_records_definitions_and_values(api, custom_field):
    name = "entity" + uuid4().hex
    entity = create(api, "userentities", name=name, caption=name)
    record = create(api, "userobjects", userentity_id=entity)
    namespace = "userentity-" + name
    field = custom_field(entity=namespace, name="saved", caption="Saved", type="text-single-line")
    path = f"/api/userfields/{namespace}/{record}"
    assert api.put(path, json={"saved": "Value"}).status_code == 204
    assert api.delete(f"/api/objects/userentities/{entity}").status_code == 204
    assert api.get(f"/api/objects/userobjects/{record}").json()["userentity_id"] == entity
    assert api.get(f"/api/objects/userfields/{field}").json()["entity"] == namespace
    assert api.get(path).status_code == 400
    replacement = create(api, "userentities", name=name, caption=name)
    assert replacement > entity
    assert api.get(path).json() == {"saved": "Value"}


@pytest.mark.parametrize(
    "entity,empty_name",
    [
        ("equipment", False),
        ("equipment", True),
        ("shopping_lists", False),
        ("shopping_lists", True),
        ("recipes_nestings", False),
    ],
)
def test_generic_unique_values_reject_duplicate_writes_and_keep_saved_rows(
    api, catalog, entity, empty_name
):
    name = f"Unique {uuid4().hex}"
    path = f"/api/objects/{entity}"
    if entity == "recipes_nestings":
        first_body = generic_body(api, catalog, entity)
        second_body = {**first_body, "includes_recipe_id": create(api, "recipes", name=name)}
        update = {"includes_recipe_id": first_body["includes_recipe_id"], "servings": 3}
        alternate = {**first_body, "recipe_id": create(api, "recipes", name=name + " parent")}
        columns = "recipes_nestings.recipe_id, recipes_nestings.includes_recipe_id"
    else:
        missing = api.post(path, json={"description": name})
        assert missing.status_code == 400, missing.text
        assert missing.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 "
            f"NOT NULL constraint failed: {entity}.name"
        }
        first_body = {"name": "" if empty_name else name, "description": "First"}
        second_body = {"name": name + " second", "description": "Second"}
        update = {"name": first_body["name"], "description": "Rejected change"}
        alternate = {"name": "   " if empty_name else name.upper()}
        columns = f"{entity}.name"
    first = create(api, entity, **first_body)
    second = create(api, entity, **second_body)
    before = [api.get(f"{path}/{record}").json() for record in (first, second)]
    expected = {
        "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 "
        f"UNIQUE constraint failed: {columns}"
    }
    duplicate = api.post(path, json=first_body)
    assert duplicate.status_code == 400, duplicate.text
    assert duplicate.json() == expected
    duplicate = api.put(f"{path}/{second}", json=update)
    assert duplicate.status_code == 400, duplicate.text
    assert duplicate.json() == expected
    assert [api.get(f"{path}/{record}").json() for record in (first, second)] == before
    third = create(api, entity, **alternate)
    assert third == second + 1
    for record in (first, second, third):
        assert api.delete(f"{path}/{record}").status_code == 204


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
    assert set(response.json()) == {"error_message", "error_details"}
    assert response.json()["error_message"] == "Bad Content-Type"
    assert set(response.json()["error_details"]) == {"stack_trace", "file", "line"}
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
@pytest.mark.parametrize("operation", ["create", "edit", "fields"])
def test_invalid_json_input_returns_grocy_status(api, content, operation):
    location = create(api, "locations", name=uuid4().hex)
    method, path = {
        "create": ("POST", "/api/objects/locations"),
        "edit": ("PUT", f"/api/objects/locations/{location}"),
        "fields": ("PUT", f"/api/userfields/locations/{location}"),
    }[operation]
    response = api.request(
        method, path, content=content, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400, response.text
    assert response.json() == {
        "error_message": "Request body could not be parsed "
        "(probably invalid JSON format or missing/wrong Content-Type header)"
    }
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
        elif kind == "locations":
            assert response.json() == {
                "error_message": "Request body could not be parsed "
                "(probably invalid JSON format or missing/wrong Content-Type header)"
            }
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


@pytest.mark.parametrize("method", ["post", "put"])
@pytest.mark.parametrize(
    "field,value,error,kept",
    [
        (
            "userfields",
            {"serial": "Value"},
            "table locations has no column named userfields_id",
            False,
        ),
        ("userfields", [], "table locations has no column named userfields_id", False),
        ("userfields", None, "table locations has no column named userfields", False),
        ("userfields", "Value", "table locations has no column named userfields", False),
        ("locationsList", [], None, True),
        (
            "locationsList",
            [{"name": float("inf")}],
            "table locations has no column named locations_id",
            True,
        ),
        (
            "locationsList",
            [{"name": "Child"}],
            "table locations has no column named locations_id",
            True,
        ),
        (
            "nutrition_proposalsList",
            [{"note": "Child"}],
            "no such table: nutrition_proposals",
            True,
        ),
        (
            "description",
            {"name": "Child"},
            "table locations has no column named description_id",
            False,
        ),
    ],
)
def test_native_generic_structures_keep_statement_order(
    api, custom_field, method, field, value, error, kept
):
    custom_field(entity="locations", name="serial", caption="Serial", type="text-single-line")
    name = "structure_" + uuid4().hex
    original = create(api, "locations", name=name + "_old") if method == "put" else None
    path = "/api/objects/locations" + (f"/{original}" if original is not None else "")
    content = json.dumps({"name": name, field: value}).replace("Infinity", "1e400")
    response = getattr(api, method)(
        path, content=content, headers={"Content-Type": "application/json"}
    )
    if error is None:
        assert response.status_code == (200 if method == "post" else 204), response.text
    else:
        assert response.status_code == 400, response.text
        if (
            method == "put"
            and not kept
            and error.startswith("table locations has no column named ")
        ):
            error = "no such column: " + error.removeprefix("table locations has no column named ")
        assert response.json() == {"error_message": "SQLSTATE[HY000]: General error: 1 " + error}
    saved = rows(api, "locations", name=name)
    assert len(saved) == int(kept)
    if original is not None:
        stored = api.get(f"/api/objects/locations/{original}").json()
        assert stored["name"] == (name if kept else name + "_old")
    elif kept:
        following = create(api, "locations", name=name + "_next")
        assert following == saved[0]["id"] + 1


@pytest.mark.parametrize("method", ["post", "put"])
def test_native_nested_shopping_rows_return_last_insert_and_parent_links(api, method):
    marker = "structure_" + uuid4().hex
    root = create(api, "shopping_list", note=marker + "_old") if method == "put" else None
    body = {
        "note": marker + "_root",
        "shopping_listList": [
            {"note": marker + "_first"},
            {"note": marker + "_second", "shopping_listList": [{"note": marker + "_last"}]},
        ],
    }
    path = "/api/objects/shopping_list" + (f"/{root}" if root is not None else "")
    response = getattr(api, method)(path, json=body)
    assert response.status_code == (200 if method == "post" else 204), response.text
    saved = api.get("/api/objects/shopping_list", params={"query[]": "note~" + marker}).json()
    indexed = {row["note"].removeprefix(marker): row for row in saved}
    assert set(indexed) == {"_root", "_first", "_second", "_last"}
    assert indexed["_first"]["shopping_list_id"] == indexed["_root"]["id"]
    assert indexed["_second"]["shopping_list_id"] == indexed["_root"]["id"]
    assert indexed["_last"]["shopping_list_id"] == indexed["_second"]["id"]
    if method == "post":
        assert response.json() == {"created_object_id": str(indexed["_last"]["id"])}
    else:
        assert indexed["_root"]["id"] == root


@pytest.mark.parametrize(
    "entity,body,field,expected",
    [
        (
            "userfields",
            {"entity": "locations", "caption": "Native", "type": "text-single-line"},
            "sort_number",
            None,
        ),
        ("chores", {"period_type": "manually"}, "assignment_type", None),
        ("meal_plan_sections", {}, "sort_number", None),
        ("recipes", {"base_servings": -2}, "desired_servings", -2),
        ("batteries", {"charge_interval_days": -2}, "charge_interval_days", -2),
    ],
)
def test_native_generic_omissions_and_scalar_values(
    api, custom_field, entity, body, field, expected
):
    name = "scalar_" + uuid4().hex
    if entity == "userfields":
        record = custom_field(name=name, **body)
    else:
        record = create(api, entity, name=name, **body)
    assert api.get(f"/api/objects/{entity}/{record}").json()[field] == expected


def test_native_generic_primary_keys_and_unparsed_timestamps(api):
    marker = "explicit_" + uuid4().hex
    existing = api.get("/api/objects/locations").json()
    original = max(row["id"] for row in existing) + 1000
    response = api.post(
        "/api/objects/locations",
        json={
            "id": original,
            "name": marker,
            "row_created_timestamp": "not a timestamp",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"created_object_id": str(original)}
    saved = api.get(f"/api/objects/locations/{original}").json()
    assert saved["row_created_timestamp"] == "not a timestamp"
    changed = api.put(
        f"/api/objects/locations/{original}",
        json={
            "id": original + 1,
            "row_created_timestamp": None,
        },
    )
    assert changed.status_code == 204, changed.text
    assert api.get(f"/api/objects/locations/{original}").status_code == 404
    moved = api.get(f"/api/objects/locations/{original + 1}").json()
    assert moved["name"] == marker and moved["row_created_timestamp"] is None
    following = create(api, "locations", name=marker + "_next")
    assert following == original + 2


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("value", [[], {"name": "Child"}, ["Child"], [float("inf")]])
def test_native_field_structures_keep_earlier_values(api, custom_field, existing, value):
    prefix = "field_" + uuid4().hex
    first, target, last = [prefix + suffix for suffix in ("first", "target", "last")]
    for name in (first, target, last):
        custom_field(entity="locations", name=name, caption=name, type="text-single-line")
    path = "/api/userfields/locations/structured-key"
    if existing:
        assert api.put(path, json={target: "Before"}).status_code == 204
    content = json.dumps({first: "Committed first", target: value, last: "Not reached"})
    response = api.put(
        path,
        content=content.replace("Infinity", "1e400"),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400, response.text
    detail = (
        "no such column: value_id"
        if existing
        else "table userfield_values has no column named value_id"
    )
    assert response.json() == {"error_message": "SQLSTATE[HY000]: General error: 1 " + detail}
    expected = {first: "Committed first", target: "Before" if existing else None, last: None}
    values = api.get(path).json()
    assert {name: values[name] for name in expected} == expected
    saved = api.put(path, json={target: "After"})
    assert saved.status_code == 204, saved.text
    values = api.get(path).json()
    assert {name: values[name] for name in expected} == {**expected, target: "After"}


@pytest.mark.parametrize(
    "parameters,status,expected,message",
    [
        ([("limit", "-2")], 200, [0, 1, 2], None),
        ([("limit", "1.9")], 200, [0], None),
        ([("limit", "1e1")], 200, [0, 1, 2], None),
        ([("limit", "bad")], 200, [], None),
        ([("limit[]", "1")], 200, [0], None),
        ([("offset", "-2"), ("limit", "1")], 200, [0], None),
        ([("offset", "1tail"), ("limit", "1")], 200, [1], None),
        ([("offset[]", "1"), ("limit", "1")], 200, [1], None),
        ([("order", "name:asc:ignored")], 200, [0, 1, 2], None),
        ([("order", "name:DESC")], 500, None, "Invalid sort order DESC"),
        (
            [("order[]", "name")],
            500,
            None,
            "explode(): Argument #2 ($string) must be of type string, array given",
        ),
        (
            [("order", "missingSort")],
            500,
            None,
            "SQLSTATE[HY000]: General error: 1 no such column: missingSort",
        ),
        (
            [("query", "description=alpha")],
            500,
            None,
            "Grocy\\Controllers\\BaseApiController::filter(): "
            "Argument #2 ($query) must be of type array, string given",
        ),
        ([("query[one]", "description=alpha")], 200, [0], None),
        (
            [("query[one][two]", "description=alpha")],
            500,
            None,
            "preg_match(): Argument #2 ($subject) must be of type string, array given",
        ),
        (
            [("query[]", "missing=1")],
            500,
            None,
            "SQLSTATE[HY000]: General error: 1 no such column: missing",
        ),
    ],
)
def test_native_generic_query_parameters(api, parameters, status, expected, message):
    marker = "queries_" + uuid4().hex
    ids = [
        create(api, "locations", name=marker + str(index), description=value)
        for index, value in enumerate(("alpha", "Beta", "12"))
    ]
    response = api.get(
        "/api/objects/locations",
        params=[
            ("query[]", f"id>={ids[0]}"),
            ("query[]", f"id<={ids[-1]}"),
            *parameters,
        ],
    )
    assert response.status_code == status, response.text
    if expected is not None:
        assert [row["id"] for row in response.json()] == [ids[index] for index in expected]
    else:
        body = response.json()
        assert set(body) == {"error_message", "error_details"}
        assert body["error_message"].startswith(message)
        details = body["error_details"]
        assert set(details) == {"stack_trace", "file", "line"}
        assert isinstance(details["stack_trace"], str) and details["stack_trace"]
        assert isinstance(details["file"], str) and details["file"].endswith((".py", ".php"))
        assert isinstance(details["line"], int) and details["line"] > 0


def test_native_generic_json_uses_php_encoding(api):
    name, timestamp = uuid4().hex, "2027-01-02 03:04:05"
    record = create(
        api, "locations", name=name, description="Ä/🧀", row_created_timestamp=timestamp
    )
    response = api.get(f"/api/objects/locations/{record}")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/json"
    assert b'"description":"\\u00c4\\/\\ud83e\\uddc0"' in response.content
    assert response.json()["description"] == "Ä/🧀"
    prefix = (
        json.dumps(
            {"id": record, "name": name, "description": "Ä/🧀", "row_created_timestamp": timestamp},
            ensure_ascii=True,
            separators=(",", ":"),
        )
        .replace("/", "\\/")
        .encode()
    )
    assert response.content.startswith(prefix[:-1] + b",")


def test_native_nonfinite_number_returns_a_serialization_error(api, catalog):
    product, *_ = catalog
    try:
        saved = api.put(f"/api/objects/products/{product}", json={"min_stock_amount": "1e9999"})
        assert saved.status_code == 204, saved.text
        response = api.get(f"/api/objects/products/{product}")
        assert response.status_code == 500
        assert response.json()["error_message"] == (
            "fwrite(): Argument #2 ($data) must be of type string, false given"
        )
        assert "error_details" in response.json()
    finally:
        assert api.delete(f"/api/objects/products/{product}").status_code == 204


@pytest.mark.parametrize("value,valid", [(b"Saved/\xc3\x84", True), (b"", True), (b"\xff", False)])
def test_native_generic_reads_keep_saved_blob_bytes(api, value, valid):
    record = create(api, "locations", name=uuid4().hex)
    statement = "UPDATE locations SET description=? WHERE id=?"
    if hasattr(api, "portal"):
        from grocy.db.session import get_session_factory

        async def save():
            async with get_session_factory()() as session:
                connection = await session.connection()
                await connection.exec_driver_sql(statement, (value, record))
                await session.commit()

        api.portal.call(save)
    elif api.base_url == httpx.URL(os.getenv("GROCY_REFERENCE_URL", "http://unused")):
        with sqlite3.connect(os.environ["GROCY_REFERENCE_DATABASE"]) as database:
            database.execute(statement, (value, record))
    else:
        pytest.skip("This stored-value check needs access to the disposable SQLite fixture")
    response = api.get(f"/api/objects/locations/{record}")
    if valid:
        assert response.status_code == 200, response.text
        assert response.json()["description"] == ("Saved/Ä" if value else None)
        matching = api.get(
            "/api/objects/locations",
            params=[
                ("query[]", f"id={record}"),
                ("query[]", "description§^Saved" if value else "description§^$"),
            ],
        )
        assert matching.status_code == 200, matching.text
        assert [row["id"] for row in matching.json()] == [record]
    else:
        assert response.status_code == 500, response.text
        assert response.json()["error_message"] == (
            "fwrite(): Argument #2 ($data) must be of type string, false given"
        )


@pytest.mark.parametrize("method", ["POST", "PUT"])
@pytest.mark.parametrize("entity", ["unknown", "stock_current", "api_keys"])
def test_native_entity_guard_precedes_body_parsing(api, method, entity):
    path = f"/api/objects/{entity}" + ("/9999999" if method == "PUT" else "")
    response = api.request(method, path, content=b"{", headers={"Content-Type": "text/plain"})
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": "Entity does not exist or is not exposed"}


@pytest.mark.parametrize("method", ["post", "put"])
@pytest.mark.parametrize("number", ["1e400", "-1e400"])
def test_native_nested_nonfinite_numbers_use_lessql_storage(api, method, number):
    marker = "number_" + uuid4().hex
    root = create(api, "shopping_list", note=marker + "_old") if method == "put" else None
    body = (
        '{"note":"'
        + marker
        + '_root","shopping_listList":[{"note":"'
        + marker
        + '_child","amount":'
        + number
        + "}]}"
    )
    path = "/api/objects/shopping_list" + (f"/{root}" if root is not None else "")
    response = getattr(api, method)(
        path, content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == (200 if method == "post" else 204), response.text
    saved = rows(api, "shopping_list", note=marker + "_child")
    parent = rows(api, "shopping_list", note=marker + "_root")
    assert len(saved) == len(parent) == 1
    assert saved[0]["amount"] == 0
    assert saved[0]["shopping_list_id"] == parent[0]["id"]
    if method == "post":
        assert response.json() == {"created_object_id": str(saved[0]["id"])}
    else:
        assert parent[0]["id"] == root


@pytest.fixture(
    params=[
        "tasks",
        "chores",
        "batteries",
        "users",
        "recipes",
        "product_entries",
        "product_locations",
        "location_entries",
    ]
)
def native_filtered_list(api, request):
    kind = request.param
    marker = "list_" + uuid4().hex
    key = "id"
    if kind in {"product_entries", "product_locations", "location_entries"}:
        product, _unit, _other, location = request.getfixturevalue("catalog")
        locations = [location, location]
        if kind == "product_locations":
            locations[1] = create(api, "locations", name=marker + "_other")
            key = "location_id"
        for index, place in enumerate(locations):
            response = api.post(
                f"/api/stock/products/{product}/add",
                json={
                    "amount": index + 2,
                    "location_id": place,
                    "best_before_date": f"2037-01-0{index + 1}",
                    "note": marker,
                },
            )
            assert response.status_code == 200, response.text
        path = (
            f"/api/stock/locations/{location}/entries"
            if kind == "location_entries"
            else f"/api/stock/products/{product}/"
            + ("entries" if kind == "product_entries" else "locations")
        )
        ids = (
            locations
            if kind == "product_locations"
            else [row["id"] for row in rows(api, "stock", product_id=product)]
        )
    elif kind == "users":
        for index in range(2):
            response = api.post(
                "/api/users", json={"username": marker + str(index), "password": "secret"}
            )
            assert response.status_code == 204, response.text
        path = "/api/users"
        response = api.get(path, params={"query[]": f"username~{marker}"})
        assert response.status_code == 200, response.text
        ids = [row["id"] for row in response.json()]
    else:
        options = {"period_type": "daily"} if kind == "chores" else {}
        ids = [create(api, kind, name=marker + str(index), **options) for index in range(2)]
        path = "/api/recipes/fulfillment" if kind == "recipes" else f"/api/{kind}"
        if kind == "recipes":
            key = "recipe_id"
    ids = sorted(ids)
    assert len(ids) == 2 and ids[0] != ids[1]
    return kind, path, key, ids


@pytest.mark.parametrize("profile", ["numbers", "arrays", "errors"])
def test_native_filtered_lists_use_php_and_sql_rules(api, native_filtered_list, profile):
    kind, path, key, ids = native_filtered_list
    base = [("query[]", f"{key}>={ids[0]}"), ("query[]", f"{key}<={ids[1]}"), ("order", key)]
    caught = 400 if kind in {"recipes", "users"} else 500
    if profile == "numbers":
        cases = [
            ([("limit", "-2")], 200, ids),
            ([("limit", "1.9")], 200, ids[:1]),
            ([("limit", "1e1")], 200, ids),
            ([("limit", "bad")], 200, []),
            ([("offset", "-2"), ("limit", "1")], 200, ids[:1]),
            ([("offset", "1tail"), ("limit", "1")], 200, ids[1:]),
            ([("order", key + ":asc:ignored")], 200, ids),
        ]
    elif profile == "arrays":
        cases = [
            ([("limit[]", "1")], 200, ids[:1]),
            ([("offset[]", "1")], 200, ids[1:]),
            ([("query[one]", f"{key}={ids[0]}")], 200, ids[:1]),
            (
                [("query", f"{key}={ids[0]}")],
                500,
                "Grocy\\Controllers\\BaseApiController::filter():",
            ),
            ([("query[one][two]", "value")], 500, "preg_match(): Argument #2"),
            ([("order[]", key)], 500, "explode(): Argument #2"),
        ]
    else:
        cases = [
            (
                [("order", "missingSort")],
                caught,
                "SQLSTATE[HY000]: General error: 1 no such column: missingSort",
            ),
            ([("order", key + ":DESC")], caught, "Invalid sort order DESC"),
            (
                [("query[]", "missingField=1")],
                caught,
                "SQLSTATE[HY000]: General error: 1 no such column: missingField",
            ),
            ([("query[]", "???")], caught, "Invalid query"),
        ]
    for extra, status, expected in cases:
        response = api.get(path, params=base + extra)
        assert response.status_code == status, (extra, response.text)
        assert response.headers["content-type"] == "application/json"
        assert response.headers["access-control-allow-origin"] == "*"
        assert response.headers["access-control-allow-headers"] == "*"
        assert response.headers["access-control-allow-methods"] == "GET, POST, PUT, DELETE, OPTIONS"
        body = response.json()
        if status == 200:
            assert [row[key] for row in body] == expected, extra
        else:
            assert body["error_message"].startswith(expected), (extra, body)
            assert set(body) == (
                {"error_message", "error_details"} if status == 500 else {"error_message"}
            )
            if status == 500:
                assert set(body["error_details"]) == {"stack_trace", "file", "line"}


def test_native_current_tasks_ignore_include_done_and_keep_php_json(api):
    marker = "current_" + uuid4().hex
    pending = create(api, "tasks", name=marker + "Ä/", done=0)
    create(api, "tasks", name=marker + "_done", done=1)
    for parameter in [("include_done", "true"), ("include_done", "bad"), ("include_done[]", "1")]:
        response = api.get("/api/tasks", params=[("query[]", "name~" + marker), parameter])
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == [pending]
        assert b"\\u00c4\\/" in response.content
        assert response.headers["content-type"] == "application/json"


@pytest.mark.parametrize("action", ["entries", "locations"])
def test_native_stock_lists_parse_subproduct_flags_in_php(api, catalog, action):
    product, unit, _other, location = catalog
    child = create(
        api,
        "products",
        name=uuid4().hex,
        parent_product_id=product,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    for identity in [product, child]:
        response = api.post(
            f"/api/stock/products/{identity}/add",
            json={"amount": 2, "best_before_date": "2037-01-01"},
        )
        assert response.status_code == 200, response.text
    for name, value, included in [
        ("include_sub_products", "yes", True),
        ("include_sub_products", "off", False),
        ("include_sub_products", "bad", False),
        ("include_sub_products[]", "1", False),
    ]:
        response = api.get(f"/api/stock/products/{product}/{action}", params=[(name, value)])
        assert response.status_code == 200, response.text
        assert {row["product_id"] for row in response.json()} == (
            {product, child} if included else {product}
        )


@pytest.mark.parametrize("action", ["entries", "locations", "location_entries"])
def test_native_stock_list_ids_keep_php_and_sql_conversion(api, catalog, action):
    product, _unit, _other, location = catalog
    assert (
        api.post(
            f"/api/stock/products/{product}/add",
            json={"amount": 2, "best_before_date": "2037-01-01"},
        ).status_code
        == 200
    )
    for suffix in [".0", "e0"]:
        path = (
            f"/api/stock/locations/{location}{suffix}/entries"
            if action == "location_entries"
            else f"/api/stock/products/{product}{suffix}/{action}"
        )
        response = api.get(path)
        assert response.status_code == 200, response.text
        assert len(response.json()) == 1 and response.json()[0]["product_id"] == product
    path = (
        "/api/stock/locations/invalid/entries"
        if action == "location_entries"
        else f"/api/stock/products/invalid/{action}"
    )
    response = api.get(path)
    assert response.status_code == 500, response.text
    message = response.json()["error_message"]
    if action == "location_entries":
        assert message == "Location does not exist"
    else:
        assert message.startswith("Grocy\\Services\\StockService::GetProductStock")
        assert "must be of type int, string given" in message


def test_native_filtered_lists_keep_saved_dates_and_related_rows(api):
    category = create(api, "task_categories", name=uuid4().hex)
    task = create(
        api,
        "tasks",
        name=uuid4().hex,
        due_date="0000-01-01",
        row_created_timestamp="0000-01-01 00:00:00.123456",
        assigned_to_user_id=1,
        category_id=category,
    )
    response = api.get("/api/tasks")
    assert response.status_code == 200, response.text
    saved = next(row for row in response.json() if row["id"] == task)
    assert saved["due_date"] == "0000-01-01"
    assert saved["row_created_timestamp"] == "0000-01-01 00:00:00.123456"
    assert saved["assigned_to_user"]["id"] == 1
    assert saved["category"]["id"] == category


def test_native_volatile_stock_uses_sqlite_dates_and_php_days(api, catalog):
    product, unit, _other, location = catalog
    today = datetime.now(UTC).date()
    products = {}
    for offset in [-1, 0, 1, 2, 6]:
        identity = (
            product
            if offset == -1
            else create(
                api,
                "products",
                name=uuid4().hex,
                location_id=location,
                qu_id_stock=unit,
                qu_id_purchase=unit,
                due_type=2,
            )
        )
        assert api.put(f"/api/objects/products/{identity}", json={"due_type": 2}).status_code == 204
        response = api.post(
            f"/api/stock/products/{identity}/add",
            json={"amount": 1, "best_before_date": (today + timedelta(days=offset)).isoformat()},
        )
        assert response.status_code == 200, response.text
        products[offset] = identity
    own = set(products.values())
    for key, value, days in [
        ("due_soon_days", "0", 5),
        ("due_soon_days", "1.9", 1),
        ("due_soon_days", "1e1", 10),
        ("due_soon_days", "bad", 5),
        ("due_soon_days", "-2", -2),
        ("due_soon_days[]", "2", 5),
    ]:
        response = api.get("/api/stock/volatile", params=[(key, value)])
        assert response.status_code == 200, response.text
        selected = {
            kind: {row.get("product_id", row.get("id")) for row in group} & own
            for kind, group in response.json().items()
        }
        assert selected == {
            "due_products": {
                identity for offset, identity in products.items() if 0 <= offset <= days
            },
            "overdue_products": {products[-1]},
            "expired_products": {products[-1]},
            "missing_products": set(),
        }


def test_shopping_expiry_uses_the_same_sqlite_day_as_stock(api, catalog):
    product, unit, _other, location = catalog
    today = datetime.now(UTC).date()
    expired = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        due_type=2,
    )
    assert api.put(f"/api/objects/products/{product}", json={"due_type": 2}).status_code == 204
    for identity, day in [(product, today), (expired, today - timedelta(days=1))]:
        response = api.post(
            f"/api/stock/products/{identity}/add",
            json={"amount": 1, "best_before_date": day.isoformat()},
        )
        assert response.status_code == 200, response.text
    response = api.post("/api/stock/shoppinglist/add-expired-products", json={})
    assert response.status_code == 204, response.text
    assert rows(api, "shopping_list", product_id=product) == []
    saved = rows(api, "shopping_list", product_id=expired)
    assert len(saved) == 1 and saved[0]["amount"] == 1


@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
@pytest.mark.parametrize(
    "group,name,message",
    [
        ("invalid", "file.txt", "Invalid file group"),
        ("productpictures", "NoExtension", "Invalid filename"),
        ("userfiles", "bad;name.txt", "Invalid filename"),
        ("equipmentmanuals", "../escape.txt", "Invalid filename"),
    ],
)
def test_native_file_validation_and_error_order(api, group, name, message, method):
    token = base64.b64encode(name.encode()).decode()
    response = api.request(method, f"/api/files/{group}/{token}", content=b"data")
    assert response.status_code == (404 if method == "GET" else 400), response.text
    data = response.json()
    assert data["error_message"] == message
    assert set(data) == (
        {"error_message", "error_details"} if method == "GET" else {"error_message"}
    )
    assert response.headers["content-type"] == "application/json"
    assert response.headers["access-control-allow-origin"] == "*"


@pytest.mark.parametrize(
    "value,expected,mime",
    [
        (b"0", b"", "application/x-empty"),
        (b"", b"", "application/x-empty"),
        (b"\x00", b"\x00", "application/octet-stream"),
        (b"hello", b"hello", "text/plain;charset=UTF-8"),
        (b"x" * 1048576 + b"0", b"x" * 1048576, "text/plain;charset=UTF-8"),
    ],
    ids=["zero", "empty", "binary", "text", "full_chunk_and_zero"],
)
def test_native_file_streams_keep_chunk_and_header_rules(api, value, expected, mime):
    name = uuid4().hex + ".jpg"
    token = base64.b64encode(name.encode()).decode()
    path = f"/api/files/userfiles/{token}"
    try:
        uploaded = api.put(path, content=value)
        assert uploaded.status_code == 204, uploaded.text
        downloaded = api.get(path, headers={"Range": "bytes=0-0"})
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.content == expected
        assert downloaded.headers["content-type"] == mime
        assert downloaded.headers["content-disposition"] == f'inline; filename="{name}"'
        assert downloaded.headers["cache-control"] == "max-age=2592000"
        head = api.head(path)
        assert head.status_code == 200 and head.content == b""
        assert head.headers["content-type"] == mime
    finally:
        assert api.delete(path).status_code == 204


@pytest.mark.parametrize(
    "parameters,status,size",
    [
        ({"best_fit_height": "20"}, 500, None),
        ({"best_fit_width": "0"}, 200, (100, 50)),
        ({"best_fit_width": "-2"}, 500, None),
        ({"best_fit_width": "1.9"}, 200, (1, 1)),
        ({"best_fit_width": "bad", "best_fit_height": "bad"}, 200, (100, 50)),
        ({"best_fit_width[]": "20"}, 200, (100, 50)),
    ],
)
def test_native_picture_parameters_follow_php_and_gd(api, parameters, status, size):
    from PIL import Image

    original = BytesIO()
    Image.new("RGBA", (100, 50), (10, 20, 30, 120)).save(original, "PNG")
    token = base64.b64encode((uuid4().hex + ".png").encode()).decode()
    path = f"/api/files/productpictures/{token}"
    assert api.put(path, content=original.getvalue()).status_code == 204
    try:
        response = api.get(path, params={"force_serve_as": "picture", **parameters})
        assert response.status_code == status, response.text if status != 200 else status
        if status == 200:
            with Image.open(BytesIO(response.content)) as picture:
                assert picture.size == size
        else:
            assert response.json()["error_message"] == (
                "imagecreatetruecolor(): Argument #1 ($width) must be greater than 0"
            )
            assert "error_details" in response.json()
        assert api.get(path).content == original.getvalue()
    finally:
        assert api.delete(path).status_code == 204


def test_native_picture_cache_is_reused_and_deleted_with_the_original(api):
    from PIL import Image

    output = BytesIO()
    Image.new("RGB", (16, 8), "red").save(output, "PNG")
    name = uuid4().hex + ".png"

    def url(value):
        return "/api/files/productpictures/" + base64.b64encode(value.encode()).decode()

    original = url(name)
    cached = url(name[:-4] + "__downscaledtoautox8.png")
    assert api.put(original, content=output.getvalue()).status_code == 204
    try:
        response = api.get(original, params={"force_serve_as": "picture", "best_fit_width": 8})
        assert response.status_code == 200, response.text
        assert api.get(cached).content == response.content
        assert api.put(cached, content=b"replacement").status_code == 400
        assert (
            api.get(original, params={"force_serve_as": "picture", "best_fit_width": 8}).content
            == response.content
        )
        assert api.delete(original).status_code == 204
        missing = api.get(cached)
        assert missing.status_code == 404
        assert missing.json()["error_message"] == "File not found"
    finally:
        api.delete(original)
        api.delete(cached)


def test_native_files_keep_unicode_header_bytes_and_invalid_image_status(api):
    name = uuid4().hex + "_漢字.txt"
    path = "/api/files/userfiles/" + base64.b64encode(name.encode()).decode()
    assert api.put(path, content=b"plain text").status_code == 204
    try:
        if hasattr(api, "portal"):
            # TestClient decodes raw response headers through ASCII; ASGITransport retains bytes.
            async def fetch():
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=api.app),
                    base_url="http://testserver",
                    headers=dict(api.headers),
                ) as connected:
                    result = await connected.get(path)
                    return result.status_code, result.headers.raw

            status, headers = api.portal.call(fetch)
        else:
            response = api.get(path)
            status, headers = response.status_code, response.headers.raw
        assert status == 200
        expected = f'inline; filename="{name}"'.encode()
        assert {key.lower(): value for key, value in headers}[b"content-disposition"] == expected
        response = api.get(path, params={"force_serve_as": "picture"})
        assert response.status_code == 404, response.text
        assert response.json()["error_message"] == "Unsupported file type"
    finally:
        assert api.delete(path).status_code == 204


@pytest.mark.parametrize(
    "resource,action,field",
    [
        ("tasks", "complete", "done_time"),
        ("batteries", "charge", "tracked_time"),
    ],
)
@pytest.mark.parametrize(
    "raw,content_type,status,message",
    [
        (
            b"{",
            "application/json",
            500,
            "array_key_exists(): Argument #2 ($array) must be of type array, null given",
        ),
        (
            b"null",
            "application/json",
            500,
            "array_key_exists(): Argument #2 ($array) must be of type array, null given",
        ),
        (b"{}", "application/json; charset=utf-8", 400, "Bad Content-Type"),
        (b"{}", "text/plain", 400, "Bad Content-Type"),
        (
            b'{"done_time":[],"tracked_time":[]}',
            "application/json",
            500,
            "DateTime::createFromFormat(): Argument #2 ($datetime) "
            "must be of type string, array given",
        ),
    ],
)
def test_native_task_and_battery_write_errors(
    api, resource, action, field, raw, content_type, status, message
):
    record = create(api, resource, name=uuid4().hex)
    response = api.post(
        f"/api/{resource}/{record}/{action}", content=raw, headers={"Content-Type": content_type}
    )
    assert response.status_code == status, response.text
    data = response.json()
    assert data["error_message"] == message
    assert set(data) == {"error_message", "error_details"}
    assert response.headers["access-control-allow-origin"] == "*"
    if resource == "tasks":
        assert api.get(f"/api/objects/tasks/{record}").json()["done"] == 0
    else:
        assert rows(api, "battery_charge_cycles", battery_id=record) == []


@pytest.mark.parametrize(
    "resource,action,field",
    [
        ("tasks", "complete", "done_time"),
        ("batteries", "charge", "tracked_time"),
    ],
)
@pytest.mark.parametrize("id_form", ["leading_zero", "decimal", "exponent", "invalid"])
def test_native_task_and_battery_action_ids(api, resource, action, field, id_form):
    record = create(api, resource, name=uuid4().hex)
    token = {
        "leading_zero": f"0{record}",
        "decimal": f"{record}.0",
        "exponent": f"{record}e0",
        "invalid": "invalid",
    }[id_form]
    response = api.post(f"/api/{resource}/{token}/{action}", json={field: "2027-01-04 16:20:00"})
    if id_form == "invalid":
        assert response.status_code == (400 if resource == "tasks" else 500), response.text
        if resource == "tasks":
            assert response.json() == {"error_message": "Task does not exist"}
        else:
            assert response.json()["error_message"].startswith(
                "Grocy\\Services\\BatteriesService::TrackChargeCycle(): Argument #1 ($batteryId) "
                "must be of type int, string given, called in "
            )
            assert "error_details" in response.json()
        return
    assert response.status_code == (204 if resource == "tasks" else 200), response.text
    if resource == "tasks":
        saved = api.get(f"/api/objects/tasks/{record}").json()
        assert saved["done"] == 1 and saved["done_timestamp"] == "2027-01-04 16:20:00"
        undo = api.post(f"/api/tasks/{token}/undo")
    else:
        saved = response.json()
        assert saved["battery_id"] == record and saved["tracked_time"] == "2027-01-04 16:20:00"
        details = api.get(f"/api/batteries/{token}")
        assert details.status_code == 200, details.text
        assert details.json()["charge_cycles_count"] == 1
        undo = api.post(f"/api/batteries/charge-cycles/{saved['id']}e0/undo")
    assert undo.status_code == 204, undo.text
    assert undo.content == b""
    if resource == "tasks":
        saved = api.get(f"/api/objects/tasks/{record}").json()
        assert saved["done"] == 0 and saved["done_timestamp"] is None
    else:
        saved = api.get(f"/api/objects/battery_charge_cycles/{saved['id']}").json()
        assert saved["undone"] == 1


@pytest.mark.parametrize(
    "resource,action,field",
    [
        ("tasks", "complete", "done_time"),
        ("batteries", "charge", "tracked_time"),
    ],
)
def test_native_task_and_battery_accept_year_zero(api, resource, action, field):
    record = create(api, resource, name=uuid4().hex)
    value = "0000-01-04 16:20:00"
    response = api.post(f"/api/{resource}/{record}/{action}", json={field: value})
    assert response.status_code == (204 if resource == "tasks" else 200), response.text
    if resource == "tasks":
        assert api.get(f"/api/objects/tasks/{record}").json()["done_timestamp"] == value
    else:
        assert response.json()["tracked_time"] == value
        details = api.get(f"/api/batteries/{record}")
        assert details.status_code == 200, details.text
        assert details.json()["last_charged"] == value


def test_native_battery_ignores_unrelated_tracking_fields(api):
    battery = create(api, "batteries", name=uuid4().hex)
    response = api.post(
        f"/api/batteries/{battery}/charge",
        json={
            "tracked_time": "2027-01-04 16:20:00",
            "done_by": [],
            "skipped": {},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["tracked_time"] == "2027-01-04 16:20:00"


@pytest.mark.parametrize("value", ["", " spaces ", None, True])
def test_native_user_creation_keeps_php_name_values(api, value):
    marker = uuid4().hex
    response = api.post(
        "/api/users",
        json={
            "username": value,
            "password": "test",
            "last_name": marker,
        },
    )
    assert response.status_code == 204, response.text
    users = api.get("/api/users", params={"query[]": f"last_name={marker}"}).json()
    assert len(users) == 1
    try:
        assert users[0]["username"] == (
            None if value in ("", None) else "1" if value is True else value
        )
    finally:
        assert api.delete(f"/api/users/{users[0]['id']}").status_code == 204


@pytest.mark.parametrize(
    "method,body,field",
    [
        ("POST", {"password": "test"}, "username"),
        ("POST", {"username": "marker"}, "password"),
        ("POST", {"username": [], "password": "test"}, "username"),
        ("POST", {"username": "marker", "password": []}, "password"),
        ("PUT", {"first_name": "Changed"}, "username"),
        ("PUT", {"username": "marker", "last_name": "Last"}, "firstName"),
        ("PUT", {"username": "marker", "first_name": "First"}, "lastName"),
    ],
)
def test_native_user_write_type_errors_keep_the_saved_profile(api, method, body, field):
    marker = uuid4().hex
    body = {key: marker if value == "marker" else value for key, value in body.items()}
    user = None
    if method == "PUT":
        assert (
            api.post("/api/users", json={"username": marker, "password": "test"}).status_code == 204
        )
        user = api.get("/api/users", params={"query[]": f"username={marker}"}).json()[0]
    try:
        response = api.request(method, "/api/users" + (f"/{user['id']}" if user else ""), json=body)
        assert response.status_code == 500, response.text
        data = response.json()
        assert set(data) == {"error_message", "error_details"}
        assert f"(${field}) must be of type" in data["error_message"]
        assert response.headers["access-control-allow-origin"] == "*"
        if user:
            assert api.get("/api/users", params={"query[]": f"id={user['id']}"}).json() == [user]
        else:
            assert api.get("/api/users", params={"query[]": f"username={marker}"}).json() == []
    finally:
        if user:
            api.delete(f"/api/users/{user['id']}")


def test_native_user_duplicate_and_full_edit_rules(api):
    marker = uuid4().hex
    body = {
        "username": marker,
        "password": "test",
        "first_name": "First",
        "last_name": "Last",
        "picture_file_name": "saved.png",
    }
    assert api.post("/api/users", json=body).status_code == 204
    user = api.get("/api/users", params={"query[]": f"username={marker}"}).json()[0]
    try:
        duplicate = api.post("/api/users", json=body)
        assert duplicate.status_code == 400, duplicate.text
        assert duplicate.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: "
            "19 UNIQUE constraint failed: users.username"
        }
        changed = api.put(
            f"/api/users/{user['id']}e0",
            json={"username": marker, "first_name": "New", "last_name": "Name"},
        )
        assert changed.status_code == 204, changed.text
        saved = api.get("/api/users", params={"query[]": f"id={user['id']}"}).json()[0]
        assert saved["first_name"] == "New" and saved["last_name"] == "Name"
        assert saved["picture_file_name"] is None
    finally:
        api.delete(f"/api/users/{user['id']}")


@pytest.mark.parametrize(
    "raw,content_type,status,details",
    [
        (b"{", "application/json", 400, False),
        (b"null", "application/json", 400, False),
        (b"{}", "application/json; charset=utf-8", 400, True),
    ],
)
def test_native_user_create_raw_body_errors(api, raw, content_type, status, details):
    response = api.post("/api/users", content=raw, headers={"Content-Type": content_type})
    assert response.status_code == status, response.text
    data = response.json()
    assert set(data) == ({"error_message", "error_details"} if details else {"error_message"})
    assert data["error_message"] == (
        "Bad Content-Type"
        if details
        else "Request body could not be parsed "
        "(probably invalid JSON format or missing/wrong Content-Type header)"
    )


@pytest.mark.parametrize("id_form", ["leading_zero", "decimal", "exponent"])
def test_native_user_self_edit_uses_php_id_comparison(api, id_form):
    marker = uuid4().hex
    body = {"username": marker, "password": "test", "first_name": "First", "last_name": "Last"}
    assert api.post("/api/users", json=body).status_code == 204
    user = api.get("/api/users", params={"query[]": f"username={marker}"}).json()[0]["id"]
    key = user_key(api, user)
    assert api.put(f"/api/users/{user}/permissions", json={"permissions": [6]}).status_code == 204
    original = api.headers["GROCY-API-KEY"]
    try:
        api.headers["GROCY-API-KEY"] = key
        token = {"leading_zero": f"0{user}", "decimal": f"{user}.0", "exponent": f"{user}e0"}[
            id_form
        ]
        response = api.put(f"/api/users/{token}", json={**body, "first_name": "Changed"})
        assert response.status_code == 204, response.text
        assert api.get("/api/user").json()[0]["first_name"] == "Changed"
        denied = api.put("/api/users/1", json={**body, "first_name": "Other"})
        assert denied.status_code == 403, denied.text
        assert denied.json()["error_message"] == "Permission missing: USERS_EDIT"
    finally:
        api.headers["GROCY-API-KEY"] = original
        api.delete(f"/api/users/{user}")


@pytest.mark.parametrize(
    "value,skipped", [("invalid", 0), ([], 0), ({}, 0), ("yes", 1), (False, 0)]
)
def test_native_chore_skip_values_use_php_boolean_filter(api, value, skipped):
    chore = create(api, "chores", name=uuid4().hex, period_type="daily")
    try:
        response = api.post(f"/api/chores/{chore}/execute", json={"skipped": value})
        assert response.status_code == 200, response.text
        assert response.json()["skipped"] == skipped
        assert type(response.json()["skipped"]) is int
        assert response.headers["access-control-allow-origin"] == "*"
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize("value", [[], {}, "invalid", "1e0"])
def test_native_chore_done_by_keeps_php_and_sql_values(api, value):
    chore = create(api, "chores", name=uuid4().hex, period_type="daily")
    actor = api.get("/api/user").json()[0]["id"]
    try:
        response = api.post(f"/api/chores/{chore}/execute", json={"done_by": value})
        if value == "invalid":
            assert response.status_code == 400, response.text
            assert response.json() == {"error_message": "User does not exist"}
            assert rows(api, "chores_log", chore_id=chore) == []
        else:
            assert response.status_code == 200, response.text
            assert response.json()["done_by_user_id"] == (1 if value == "1e0" else actor)
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize("value", ["0000-01-04", "0000-01-04 16:20:00"])
def test_native_chore_dates_keep_year_zero(api, value):
    chore = create(api, "chores", name=uuid4().hex, period_type="daily", track_date_only=0)
    try:
        response = api.post(f"/api/chores/{chore}/execute", json={"tracked_time": value})
        assert response.status_code == 200, response.text
        assert response.json()["tracked_time"] == value
        details = api.get(f"/api/chores/{chore}")
        assert details.status_code == 200, details.text
        assert details.json()["last_tracked"] == value
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize("form", ["exponent", "fraction"])
def test_native_chore_ids_use_php_conversion_and_sql_undo(api, form):
    chore = create(api, "chores", name=uuid4().hex, period_type="daily")
    token = f"{chore}e0" if form == "exponent" else f"{chore}.9"
    try:
        details = api.get(f"/api/chores/{token}")
        assert details.status_code == 200, details.text
        assert details.json()["chore"]["id"] == chore
        response = api.post(f"/api/chores/{token}/execute", json={})
        assert response.status_code == 200, response.text
        log_id = response.json()["id"]
        undone = api.post(f"/api/chores/executions/{log_id}e0/undo")
        assert undone.status_code == 204 and undone.content == b"", undone.text
        assert api.get(f"/api/objects/chores_log/{log_id}").json()["undone"] == 1
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize(
    "raw,content_type,message",
    [
        (
            b"{",
            "application/json",
            "array_key_exists(): Argument #2 ($array) must be of type array, null given",
        ),
        (
            b"null",
            "application/json",
            "array_key_exists(): Argument #2 ($array) must be of type array, null given",
        ),
        (
            b'{"tracked_time":[]}',
            "application/json",
            "DateTime::createFromFormat(): Argument #2 ($datetime) "
            "must be of type string, array given",
        ),
        (b"{}", "application/json; charset=utf-8", "Bad Content-Type"),
    ],
)
def test_native_chore_body_errors_keep_diagnostics(api, raw, content_type, message):
    chore = create(api, "chores", name=uuid4().hex, period_type="daily")
    try:
        response = api.post(
            f"/api/chores/{chore}/execute", content=raw, headers={"Content-Type": content_type}
        )
        assert response.status_code == (400 if message == "Bad Content-Type" else 500), (
            response.text
        )
        assert set(response.json()) == {"error_message", "error_details"}
        assert response.json()["error_message"] == message
        assert rows(api, "chores_log", chore_id=chore) == []
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize("form", ["zero_prefix", "decimal", "exponent"])
def test_native_chore_merge_rejects_noncanonical_integer_ids(api, form):
    keep, remove = [create(api, "chores", name=uuid4().hex, period_type="daily") for _ in range(2)]
    token = {"zero_prefix": f"0{keep}", "decimal": f"{keep}.0", "exponent": f"{keep}e0"}[form]
    try:
        response = api.post(f"/api/chores/{token}/merge/{remove}")
        assert response.status_code == 400, response.text
        assert response.json() == {
            "error_message": "Provided {choreIdToKeep} or {choreIdToRemove} is not a valid integer"
        }
        assert api.get(f"/api/objects/chores/{keep}").status_code == 200
        assert api.get(f"/api/objects/chores/{remove}").status_code == 200
    finally:
        api.delete(f"/api/objects/chores/{keep}")
        api.delete(f"/api/objects/chores/{remove}")


def test_native_chore_merge_moves_complete_execution_history(api):
    keep, remove = [create(api, "chores", name=uuid4().hex, period_type="daily") for _ in range(2)]
    try:
        first = api.post(
            f"/api/chores/{remove}/execute", json={"tracked_time": "2027-01-04 12:00:00"}
        )
        assert first.status_code == 200, first.text
        assert api.post(f"/api/chores/{remove}/execute", json={"skipped": True}).status_code == 200
        assert api.post(f"/api/chores/executions/{first.json()['id']}/undo").status_code == 204
        before = rows(api, "chores_log", chore_id=remove)
        merged = api.post(f"/api/chores/{keep}/merge/{remove}")
        assert merged.status_code == 204 and merged.content == b"", merged.text
        assert rows(api, "chores_log", chore_id=keep) == [
            {**row, "chore_id": keep} for row in before
        ]
        assert api.get(f"/api/objects/chores/{remove}").status_code == 404
    finally:
        api.delete(f"/api/objects/chores/{keep}")
        api.delete(f"/api/objects/chores/{remove}")


@pytest.mark.parametrize("form", ["exponent", "fraction"])
def test_native_chore_assignment_id_uses_php_numeric_conversion(api, form):
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="daily",
        assignment_type="in-alphabetical-order",
        assignment_config="1",
    )
    value = f"{chore}e0" if form == "exponent" else chore + 0.9
    try:
        response = api.post(
            "/api/chores/executions/calculate-next-assignments", json={"chore_id": value}
        )
        assert response.status_code == 204 and response.content == b"", response.text
        assert (
            api.get(f"/api/objects/chores/{chore}").json()["next_execution_assigned_to_user_id"]
            == 1
        )
    finally:
        api.delete(f"/api/objects/chores/{chore}")


def test_native_chore_assignment_error_keeps_earlier_execution_writes(api):
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="daily",
        assignment_type="random",
        assignment_config="",
        rescheduled_date="2030-01-04",
    )
    try:
        response = api.post(
            f"/api/chores/{chore}/execute", json={"tracked_time": "2027-01-04 12:00:00"}
        )
        assert response.status_code == 500, response.text
        version = tuple(map(int, api.get("/api/system/info").json()["php_version"].split(".")[:2]))
        description = "must not" if version >= (8, 4) else "cannot"
        assert (
            response.json()["error_message"]
            == f"array_rand(): Argument #1 ($array) {description} be empty"
        )
        saved = rows(api, "chores_log", chore_id=chore)
        assert len(saved) == 1 and saved[0]["tracked_time"] == "2027-01-04 12:00:00"
        assert api.get(f"/api/objects/chores/{chore}").json()["rescheduled_date"] is None
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize("failure", ["ABORT", "FAIL", "ROLLBACK"])
def test_native_chore_merge_failure_restores_all_rows_and_can_retry(api, failure, execute_sql):
    keep, remove = [create(api, "chores", name=uuid4().hex, period_type="daily") for _ in range(2)]
    trigger = "merge_failure_" + uuid4().hex
    try:
        assert api.post(f"/api/chores/{remove}/execute", json={}).status_code == 200
        before = rows(api, "chores_log", chore_id=remove)
        execute_sql(
            f"CREATE TRIGGER {trigger} BEFORE DELETE ON chores WHEN OLD.id={remove} "
            f"BEGIN SELECT RAISE({failure},'Merge blocked'); END"
        )
        response = api.post(f"/api/chores/{keep}/merge/{remove}")
        assert response.status_code == 400, response.text
        version = tuple(map(int, api.get("/api/system/info").json()["php_version"].split(".")[:2]))
        assert response.json() == {
            "error_message": (
                (
                    "There is no active transaction"
                    if version >= (8, 4)
                    else "SQLSTATE[HY000]: General error: 1 cannot rollback - "
                    "no transaction is active"
                )
                if failure == "ROLLBACK"
                else "SQLSTATE[23000]: Integrity constraint violation: 19 Merge blocked"
            )
        }
        assert rows(api, "chores_log", chore_id=remove) == before
        assert rows(api, "chores_log", chore_id=keep) == []
        assert api.get(f"/api/objects/chores/{remove}").status_code == 200
        execute_sql(f"DROP TRIGGER {trigger}")
        retry = api.post(f"/api/chores/{keep}/merge/{remove}")
        assert retry.status_code == 204 and retry.content == b"", retry.text
        assert rows(api, "chores_log", chore_id=keep) == [
            {**row, "chore_id": keep} for row in before
        ]
    finally:
        execute_sql(f"DROP TRIGGER IF EXISTS {trigger}")
        api.delete(f"/api/objects/chores/{keep}")
        api.delete(f"/api/objects/chores/{remove}")


@pytest.mark.parametrize(
    "case",
    json.loads((Path(__file__).parents[1] / "fixtures/household-grocy-4.5.0.json").read_text())[
        "cases"
    ],
    ids=lambda case: case["name"],
)
def test_native_chore_schedule_matches_release_view_and_calendar(api, case):
    name = case["name"] + " " + uuid4().hex[:8]
    chore = create(api, "chores", **{**case["chore"], "name": name})
    try:
        for tracked in case["tracked_times"]:
            response = api.post(f"/api/chores/{chore}/execute", json={"tracked_time": tracked})
            assert response.status_code == 200, response.text
        details = api.get(f"/api/chores/{chore}")
        assert details.status_code == 200, details.text
        expected = case["next_execution"]
        if expected and expected.startswith("TODAY"):
            today = api.get("/api/system/time").json()["time_local_sqlite3"][:10]
            expected = today + expected[5:]
        assert details.json()["next_estimated_execution_time"] == expected
        current = api.get("/api/chores", params={"query[]": f"chore_id={chore}"})
        assert current.status_code == 200 and len(current.json()) == 1, current.text
        assert current.json()[0]["next_estimated_execution_time"] == expected
        calendar = api.get("/api/calendar/ical")
        assert calendar.status_code == 200, calendar.text
        events = [
            event
            for event in calendar.text.replace("\r\n ", "").split("BEGIN:VEVENT")
            if f"SUMMARY:Chore due: {name}" in event
        ]
        if expected is None:
            assert events == []
        else:
            assert len(events) == 1
            start = re.search(r"(?m)^DTSTART[^:]*:([^\r\n]+)", events[0])
            assert start is not None
            value = expected[:10] if case["chore"]["track_date_only"] else expected
            assert start.group(1).removesuffix("Z") == value.replace("-", "").replace(
                ":", ""
            ).replace(" ", "T")
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize("start", ["omitted", None, ""])
def test_native_chore_default_start_clock_is_used_after_execution(api, start):
    before = api.get("/api/system/time").json()["time_local_sqlite3"]
    fields = {} if start == "omitted" else {"start_date": start}
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="daily",
        period_interval=2,
        track_date_only=0,
        **fields,
    )
    try:
        saved = api.get(f"/api/objects/chores/{chore}").json()["start_date"]
        after = api.get("/api/system/time").json()["time_local_sqlite3"]
        assert before <= saved <= after
        response = api.post(
            f"/api/chores/{chore}/execute", json={"tracked_time": "2027-01-04 10:30:00"}
        )
        assert response.status_code == 200, response.text
        details = api.get(f"/api/chores/{chore}")
        assert details.status_code == 200, details.text
        assert details.json()["next_estimated_execution_time"] == "2027-01-06 " + saved[11:]
    finally:
        api.delete(f"/api/objects/chores/{chore}")


@pytest.mark.parametrize("servings", ["4", "0", "-1", "invalid"])
def test_native_recipe_fulfillment_ignores_query_servings(api, catalog, servings):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex, base_servings=2)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=3, qu_id=unit)
    expected = api.get("/api/recipes/fulfillment", params={"query[]": f"recipe_id={recipe}"})
    assert expected.status_code == 200 and len(expected.json()) == 1, expected.text
    response = api.get(f"/api/recipes/{recipe}/fulfillment", params={"servings": servings})
    assert response.status_code == 200, response.text
    assert response.json() == expected.json()[0]


@pytest.mark.parametrize("servings", ["4", "invalid", "-1"])
def test_native_recipe_consumption_ignores_query_servings(api, catalog, servings):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 10}).status_code == 200
    response = api.post(f"/api/recipes/{recipe}/consume", params={"servings": servings})
    assert response.status_code == 204 and response.content == b"", response.text
    assert api.get(f"/api/stock/products/{product}").json()["stock_amount"] == 8
    bookings = rows(api, "stock_log", recipe_id=recipe)
    assert len(bookings) == 1 and bookings[0]["amount"] == -2


@pytest.mark.parametrize("action", ["fulfillment", "consume", "copy"])
@pytest.mark.parametrize("id_form", ["exponent", "decimal"])
def test_native_recipe_actions_accept_numeric_url_ids(api, action, id_form):
    recipe = create(api, "recipes", name=uuid4().hex)
    token = f"{recipe}e0" if id_form == "exponent" else f"{recipe}.0"
    response = api.request(
        "GET" if action == "fulfillment" else "POST", f"/api/recipes/{token}/{action}"
    )
    assert response.status_code == (204 if action == "consume" else 200), response.text
    if action == "consume":
        assert response.content == b""
    elif action == "copy":
        copied = response.json()["created_object_id"]
        assert isinstance(copied, str)
        assert api.get(f"/api/objects/recipes/{copied}").status_code == 200


def test_native_recipe_missing_ingredient_action_accepts_unknown_recipe(api):
    response = api.post(
        "/api/recipes/2147483647/add-not-fulfilled-products-to-shoppinglist", json={}
    )
    assert response.status_code == 204 and response.content == b"", response.text


@pytest.mark.parametrize("excluded", ["invalid", {"id": 1}])
def test_native_recipe_excluded_product_values_keep_php_rules(api, catalog, excluded):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    response = api.post(
        f"/api/recipes/{recipe}/add-not-fulfilled-products-to-shoppinglist",
        json={"excludedProductIds": excluded},
    )
    if isinstance(excluded, str):
        assert response.status_code == 500, response.text
        assert (
            response.json()["error_message"]
            == "in_array(): Argument #2 ($haystack) must be of type array, string given"
        )
        assert rows(api, "shopping_list", product_id=product) == []
    else:
        assert response.status_code == 204, response.text
        assert rows(api, "shopping_list", product_id=product)[0]["amount"] == 2


def test_native_recipe_output_error_keeps_committed_ingredient_consumption(api, catalog):
    product, unit, _, location = catalog
    output = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    recipe = create(api, "recipes", name=uuid4().hex, product_id=output)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 3}).status_code == 200
    assert api.put(f"/api/objects/products/{output}", json={"active": 0}).status_code == 204
    response = api.post(f"/api/recipes/{recipe}/consume")
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": "Product does not exist or is inactive"}
    assert api.get(f"/api/stock/products/{product}").json()["stock_amount"] == 1
    bookings = rows(api, "stock_log", recipe_id=recipe)
    assert len(bookings) == 1 and bookings[0]["amount"] == -2
    assert rows(api, "stock", product_id=output) == []


@pytest.mark.parametrize(
    "amount,expected", [(2.9, 2), (0, 1), (-1, -1), ("invalid", 1), ([], 1), ("1e0", 1)]
)
def test_native_shopping_add_amount_uses_php_integer_defaults(api, catalog, amount, expected):
    product, _, _, _ = catalog
    response = api.post(
        "/api/stock/shoppinglist/add-product",
        json={"product_id": product, "product_amount": amount},
    )
    assert response.status_code == 204 and response.content == b"", response.text
    assert rows(api, "shopping_list", product_id=product)[0]["amount"] == expected


@pytest.mark.parametrize("amount,expected", [(2.9, 3), (0, 4), (-1, 6), ("invalid", 4)])
def test_native_shopping_remove_amount_uses_php_integer_defaults(api, catalog, amount, expected):
    product, unit, _, _ = catalog
    item = create(api, "shopping_list", product_id=product, amount=5, qu_id=unit)
    response = api.post(
        "/api/stock/shoppinglist/remove-product",
        json={"product_id": product, "product_amount": amount},
    )
    assert response.status_code == 204 and response.content == b"", response.text
    assert api.get(f"/api/objects/shopping_list/{item}").json()["amount"] == expected


@pytest.mark.parametrize("product", [None, "invalid", [], 0])
def test_native_shopping_add_missing_product_has_native_error(api, product):
    response = api.post("/api/stock/shoppinglist/add-product", json={"product_id": product})
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": "No product id was supplied"}


@pytest.mark.parametrize("done_only", ["invalid", [], "yes"])
def test_native_shopping_clear_uses_php_boolean_filter(api, done_only):
    shopping_list = create(api, "shopping_lists", name=uuid4().hex)
    unfinished = create(
        api, "shopping_list", note=uuid4().hex, shopping_list_id=shopping_list, done=0
    )
    create(api, "shopping_list", note=uuid4().hex, shopping_list_id=shopping_list, done=1)
    response = api.post(
        "/api/stock/shoppinglist/clear", json={"list_id": shopping_list, "done_only": done_only}
    )
    assert response.status_code == 204 and response.content == b"", response.text
    remaining = rows(api, "shopping_list", shopping_list_id=shopping_list)
    assert [row["id"] for row in remaining] == ([unfinished] if done_only == "yes" else [])


def test_native_recipe_copy_failure_keeps_parent_and_can_retry(api, catalog, execute_sql):
    product, unit, _, _ = catalog
    name = uuid4().hex
    recipe = create(api, "recipes", name=name, base_servings=2)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=3, qu_id=unit)
    trigger = "copy_failure_" + uuid4().hex
    try:
        execute_sql(
            f"CREATE TRIGGER {trigger} BEFORE INSERT ON recipes_pos "
            f"WHEN NEW.product_id={product} AND NEW.recipe_id<>{recipe} "
            "BEGIN SELECT RAISE(ABORT,'Copy blocked'); END"
        )
        response = api.post(f"/api/recipes/{recipe}/copy")
        assert response.status_code == 400, response.text
        assert response.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 Copy blocked"
        }
        copies = rows(api, "recipes", name="Copy of " + name)
        assert len(copies) == 1
        assert copies[0]["base_servings"] == 2
        assert rows(api, "recipes_pos", recipe_id=copies[0]["id"]) == []
        execute_sql(f"DROP TRIGGER {trigger}")
        retry = api.post(f"/api/recipes/{recipe}/copy")
        assert retry.status_code == 200, retry.text
        assert isinstance(retry.json()["created_object_id"], str)
        successful = rows(api, "recipes_pos", recipe_id=retry.json()["created_object_id"])
        assert len(successful) == 1 and successful[0]["amount"] == 3
        assert len(rows(api, "recipes", name="Copy of " + name)) == 2
    finally:
        execute_sql(f"DROP TRIGGER IF EXISTS {trigger}")


@pytest.mark.parametrize(
    "action", ["add-missing-products", "add-overdue-products", "add-expired-products"]
)
@pytest.mark.parametrize("list_id", ["invalid", []])
def test_native_shopping_bulk_actions_ignore_invalid_list_ids(api, action, list_id):
    response = api.post(f"/api/stock/shoppinglist/{action}", json={"list_id": list_id})
    assert response.status_code == 204 and response.content == b"", response.text


@pytest.mark.parametrize(
    "action", ["add-product", "remove-product", "clear", "add-missing-products"]
)
def test_native_shopping_null_body_keeps_php_type_error(api, action):
    response = api.post(
        f"/api/stock/shoppinglist/{action}",
        content=b"null",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 500, response.text
    assert (
        response.json()["error_message"]
        == "array_key_exists(): Argument #2 ($array) must be of type array, null given"
    )
    assert set(response.json()) == {"error_message", "error_details"}


def test_native_recipe_duplicate_ingredient_failure_restores_stock_and_log(api, catalog):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    for amount in [3, 2]:
        create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=amount, qu_id=unit)
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 4}).status_code == 200
    before_stock = rows(api, "stock", product_id=product)
    before_log = rows(api, "stock_log", product_id=product)
    response = api.post(f"/api/recipes/{recipe}/consume")
    assert response.status_code == 400, response.text
    assert response.json() == {
        "error_message": "Amount to be consumed cannot be > current stock amount "
        "(if supplied, at the desired location)"
    }
    assert rows(api, "stock", product_id=product) == before_stock
    assert rows(api, "stock_log", product_id=product) == before_log


@pytest.mark.parametrize(
    "amount,status", [(True, 200), ([], 500), ({}, 500), ("invalid", 500), (0, 400), (-1, 400)]
)
def test_native_stock_purchase_amount_retains_php_argument_rules(api, catalog, amount, status):
    product, _, _, _ = catalog
    response = api.post(f"/api/stock/products/{product}/add", json={"amount": amount})
    assert response.status_code == status, response.text
    if status == 200:
        assert response.json()[0]["amount"] == 1
        assert rows(api, "stock", product_id=product)[0]["amount"] == 1
    elif status == 500:
        kind = "array" if isinstance(amount, (list, dict)) else "string"
        assert (
            f"Argument #2 ($amount) must be of type float, {kind} given"
            in response.json()["error_message"]
        )
        assert rows(api, "stock", product_id=product) == []
    else:
        assert response.json() == {"error_message": "Amount can't be <= 0"}
        assert rows(api, "stock", product_id=product) == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("price", "invalid"),
        ("price", True),
        ("location_id", "invalid"),
        ("shopping_location_id", "invalid"),
        ("best_before_date", "invalid"),
        ("purchased_date", "invalid"),
    ],
)
def test_native_stock_purchase_invalid_optional_values_use_defaults(api, catalog, field, value):
    product, _, _, location = catalog
    before = api.get("/api/system/time").json()["time_local_sqlite3"][:10]
    response = api.post(f"/api/stock/products/{product}/add", json={"amount": 1, field: value})
    assert response.status_code == 200, response.text
    row = response.json()[0]
    after = api.get("/api/system/time").json()["time_local_sqlite3"][:10]
    expected = {"price": None, "location_id": location, "shopping_location_id": None}
    if field in expected:
        assert row[field] == expected[field]
    else:
        assert before <= row[field] <= after


@pytest.mark.parametrize("mode", [-1, 3, "invalid"])
def test_native_stock_purchase_label_modes_keep_unrestricted_runtime_values(api, catalog, mode):
    product, _, _, _ = catalog
    response = api.post(
        f"/api/stock/products/{product}/add", json={"amount": 2.5, "stock_label_type": mode}
    )
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1 and response.json()[0]["amount"] == 2.5


@pytest.mark.parametrize("field", ["best_before_date", "purchased_date"])
def test_native_stock_purchase_keeps_year_zero_dates(api, catalog, field):
    product, _, _, _ = catalog
    response = api.post(
        f"/api/stock/products/{product}/add", json={"amount": 1, field: "0000-01-04"}
    )
    assert response.status_code == 200, response.text
    assert response.json()[0][field] == "0000-01-04"
    entries = api.get(f"/api/stock/products/{product}/entries")
    assert entries.status_code == 200 and entries.json()[0][field] == "0000-01-04"
    details = api.get(f"/api/stock/products/{product}")
    assert details.status_code == 200, details.text


@pytest.mark.parametrize("action", ["add", "consume", "open", "transfer", "inventory"])
def test_native_stock_empty_body_uses_original_required_amount_error(api, catalog, action):
    product, _, _, _ = catalog
    response = api.post(f"/api/stock/products/{product}/{action}", json={})
    assert response.status_code == 400, response.text
    message = "An new amount is required" if action == "inventory" else "An amount is required"
    assert response.json() == {"error_message": message}
    assert rows(api, "stock_log", product_id=product) == []


@pytest.mark.parametrize("spoiled", ["false", "invalid"])
def test_native_stock_consumption_uses_php_bool_argument_conversion(api, catalog, spoiled):
    product, _, _, _ = catalog
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 2}).status_code == 200
    response = api.post(
        f"/api/stock/products/{product}/consume", json={"amount": 1, "spoiled": spoiled}
    )
    assert response.status_code == 200, response.text
    assert response.json()[0]["spoiled"] == 1


@pytest.mark.parametrize(
    "body,transaction_type",
    [
        ({"transaction_type": "inventory-correction"}, "consume"),
        (
            {"transaction_type": "ignored", "transactiontype": "inventory-correction"},
            "inventory-correction",
        ),
    ],
)
def test_native_stock_consumption_retains_transaction_field_typo(
    api, catalog, body, transaction_type
):
    product, _, _, _ = catalog
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 2}).status_code == 200
    response = api.post(f"/api/stock/products/{product}/consume", json={"amount": 1, **body})
    assert response.status_code == 200, response.text
    assert response.json()[0]["transaction_type"] == transaction_type


@pytest.mark.parametrize("form", ["decimal", "exponent"])
def test_native_stock_detail_booking_and_undo_accept_numeric_url_ids(api, catalog, form):
    product, _, _, _ = catalog
    response = api.post(f"/api/stock/products/{product}/add", json={"amount": 2})
    assert response.status_code == 200, response.text
    booking = response.json()[0]["id"]
    entry = rows(api, "stock", product_id=product)[0]["id"]

    def token(value):
        return f"{value}.0" if form == "decimal" else f"{value}e0"

    for path in [
        f"products/{token(product)}",
        f"entry/{token(entry)}",
        f"bookings/{token(booking)}",
        f"products/{token(product)}/price-history",
    ]:
        result = api.get("/api/stock/" + path)
        assert result.status_code == 200, result.text
    undone = api.post(f"/api/stock/bookings/{token(booking)}/undo")
    assert undone.status_code == 204 and undone.content == b"", undone.text
    assert rows(api, "stock", product_id=product) == []


@pytest.mark.parametrize("form", ["leading_zero", "decimal", "exponent"])
def test_native_stock_merge_rejects_noncanonical_integer_ids(api, catalog, form):
    product, unit, _, location = catalog
    remove = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    token = {"leading_zero": f"0{product}", "decimal": f"{product}.0", "exponent": f"{product}e0"}[
        form
    ]
    response = api.post(f"/api/stock/products/{token}/merge/{remove}")
    assert response.status_code == 400, response.text
    assert response.json() == {
        "error_message": "Provided {productIdToKeep} or {productIdToRemove} is not a valid integer"
    }
    assert api.get(f"/api/objects/products/{product}").status_code == 200
    assert api.get(f"/api/objects/products/{remove}").status_code == 200


def test_native_stock_edit_requires_amount_and_keeps_writes_before_type_error(api, catalog):
    product, _, _, _ = catalog
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 3}).status_code == 200
    entry_id = rows(api, "stock", product_id=product)[0]["id"]
    entry = api.get(f"/api/stock/entry/{entry_id}").json()
    response = api.put(f"/api/stock/entry/{entry['id']}", json={"price": 4})
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": "An amount is required"}
    assert api.get(f"/api/stock/entry/{entry['id']}").json() == entry
    response = api.put(f"/api/stock/entry/{entry['id']}", json={"amount": 2})
    assert response.status_code == 500, response.text
    assert (
        "BoolToInt(): Argument #1 ($bool) must be of type bool, null given"
        in response.json()["error_message"]
    )
    assert api.get(f"/api/stock/entry/{entry['id']}").json() == entry
    logs = rows(api, "stock_log", product_id=product)
    assert [row["transaction_type"] for row in logs] == ["purchase", "stock-edit-old"]
    response = api.put(f"/api/stock/entry/{entry['id']}", json={"amount": 2, "open": False})
    assert response.status_code == 200, response.text
    saved = api.get(f"/api/stock/entry/{entry['id']}").json()
    assert saved["amount"] == 2 and saved["purchased_date"] is None and saved["open"] == 0


@pytest.mark.parametrize(
    "resource,kind", [("products", "p"), ("chores", "c"), ("batteries", "b"), ("recipes", "r")]
)
def test_native_label_numeric_url_uses_controller_code_id(api, catalog, resource, kind):
    if resource == "products":
        record = catalog[0]
        path = f"/api/stock/products/{record}e0/printlabel"
    else:
        extra = {"period_type": "daily"} if resource == "chores" else {}
        record = create(api, resource, name=uuid4().hex, **extra)
        path = f"/api/{resource}/{record}e0/printlabel"
    response = api.get(path)
    assert response.status_code == 200, response.text
    code_id = str(record) if resource == "products" else f"{record}e0"
    assert response.json()["grocycode"] == f"grcy:{kind}:{code_id}"


@pytest.mark.parametrize("action", ["add", "consume", "open", "transfer", "inventory"])
def test_native_stock_barcode_lookup_runs_before_action_permission(api, action):
    name = uuid4().hex
    assert api.post("/api/users", json={"username": name, "password": "test"}).status_code == 204
    user = api.get("/api/users", params={"query[]": "username=" + name}).json()[0]["id"]
    assert api.put(f"/api/users/{user}/permissions", json={"permissions": [9]}).status_code == 204
    key = user_key(api, user)
    barcode = "unknown-" + uuid4().hex
    response = api.post(
        f"/api/stock/products/by-barcode/{barcode}/{action}",
        json={},
        headers={"GROCY-API-KEY": key},
    )
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": f"No product with barcode {barcode} found"}


def test_native_stock_self_merge_keeps_original_error_and_stock(api, catalog):
    product, _, _, _ = catalog
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 2}).status_code == 200
    before_stock = rows(api, "stock", product_id=product)
    before_log = rows(api, "stock_log", product_id=product)
    response = api.post(f"/api/stock/products/{product}/merge/{product}")
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": "$productIdToKeep cannot equal $productIdToRemove"}
    assert rows(api, "stock", product_id=product) == before_stock
    assert rows(api, "stock_log", product_id=product) == before_log


def test_native_calendar_task_ids_and_description_follow_release(api):
    name = "Native calendar " + uuid4().hex
    task = create(
        api, "tasks", name=name, description="Private task details", due_date="2027-01-04"
    )
    try:
        ids = []
        for _ in range(2):
            response = api.get("/api/calendar/ical")
            assert response.status_code == 200, response.text
            assert response.headers["content-type"] == "text/calendar; charset=utf-8"
            assert response.headers["content-disposition"] == 'attachment; filename="Grocy.ics"'
            events = [
                part
                for part in response.text.replace("\r\n ", "").split("BEGIN:VEVENT")
                if "SUMMARY:Task due: " + name in part
            ]
            assert len(events) == 1
            event = events[0].split("END:VEVENT")[0]
            uid = re.search(r"(?m)^UID:([^\r\n]+)", event)
            assert uid is not None and re.fullmatch(r"[0-9a-f]{32}", uid.group(1))
            ids.append(uid.group(1))
            assert "DESCRIPTION:\r\n" in event
        assert ids[0] != ids[1]
    finally:
        api.delete(f"/api/objects/tasks/{task}")


@pytest.mark.parametrize("kind", ["stock", "task", "chore", "battery", "meal"])
def test_native_calendar_exports_year_zero_dates(api, catalog, kind):
    product, _, _, _ = catalog
    name = "Calendar zero " + uuid4().hex
    resource = record = None
    if kind == "stock":
        assert api.put(f"/api/objects/products/{product}", json={"name": name}).status_code == 204
        response = api.post(
            f"/api/stock/products/{product}/add",
            json={"amount": 1, "best_before_date": "0000-01-04"},
        )
        assert response.status_code == 200, response.text
        expected = "00000104"
    elif kind == "task":
        resource = "tasks"
        record = create(api, resource, name=name, due_date="0000-01-04")
        expected = "00000104"
    elif kind == "chore":
        resource = "chores"
        record = create(
            api,
            resource,
            name=name,
            period_type="daily",
            start_date="0000-01-04 09:00:00",
            track_date_only=0,
        )
        expected = "00000104T090000"
    elif kind == "battery":
        resource = "batteries"
        record = create(api, resource, name=name, charge_interval_days=7)
        assert (
            api.post(
                f"/api/batteries/{record}/charge", json={"tracked_time": "0000-01-01 10:00:00"}
            ).status_code
            == 200
        )
        expected = "00000108T100000"
    else:
        resource = "meal_plan"
        record = create(api, resource, day="0000-01-04", type="note", note=name)
        expected = "00000104"
    try:
        response = api.get("/api/calendar/ical")
        assert response.status_code == 200, response.text
        events = [
            part
            for part in response.text.replace("\r\n ", "").split("BEGIN:VEVENT")
            if name in part
        ]
        assert len(events) == 1
        start = re.search(r"(?m)^DTSTART[^:]*:([^\r\n]+)", events[0])
        assert start is not None and start.group(1).removesuffix("Z") == expected
    finally:
        if resource:
            api.delete(f"/api/objects/{resource}/{record}")
        else:
            api.delete(f"/api/objects/products/{product}")


def test_native_calendar_sharing_keys_keep_source_shape_and_global_reuse(api):
    first = api.get("/api/calendar/ical/sharing-link")
    assert first.status_code == 200, first.text
    link = first.json()["url"]
    key = link.split("secret=", 1)[1]
    assert re.fullmatch(r"[A-Za-z0-9]{50}", key)
    for _ in range(2):
        name = uuid4().hex
        assert (
            api.post("/api/users", json={"username": name, "password": "test"}).status_code == 204
        )
        user = api.get("/api/users", params={"query[]": "username=" + name}).json()[0]["id"]
        assert (
            api.put(f"/api/users/{user}/permissions", json={"permissions": [9]}).status_code == 204
        )
        user_token = user_key(api, user)
        headers = {"GROCY-API-KEY": user_token}
        result = api.get("/api/calendar/ical/sharing-link", headers=headers)
        assert result.status_code == 200 and result.json() == {"url": link}, result.text
        exported = api.get("/api/calendar/ical", headers=headers)
        assert exported.status_code == 200, exported.text


@pytest.mark.parametrize("kind", ["task", "meal"])
def test_native_calendar_invalid_date_retains_php_type_error(api, kind):
    name = uuid4().hex
    section = None
    if kind == "task":
        resource = "tasks"
        record = create(api, resource, name=name, due_date="invalid")
    else:
        resource = "meal_plan"
        section = create(api, "meal_plan_sections", name=name, time_info="invalid")
        record = create(api, resource, day="2027-01-04", type="note", note=name, section_id=section)
    try:
        response = api.get("/api/calendar/ical")
        assert response.status_code == 500, response.text
        assert "DateTimeInterface, false given" in response.json()["error_message"]
        assert set(response.json()) == {"error_message", "error_details"}
    finally:
        api.delete(f"/api/objects/{resource}/{record}")
        if section is not None:
            api.delete(f"/api/objects/meal_plan_sections/{section}")


@pytest.mark.parametrize("created", ["0000-01-04 10:00:00", "invalid"])
def test_native_calendar_auth_does_not_parse_unused_user_dates(api, execute_sql, created):
    name = uuid4().hex
    assert api.post("/api/users", json={"username": name, "password": "test"}).status_code == 204
    user = api.get("/api/users", params={"query[]": "username=" + name}).json()[0]["id"]
    key = user_key(api, user)
    execute_sql(f"UPDATE users SET row_created_timestamp='{created}' WHERE id={user}")
    headers = {"GROCY-API-KEY": key}
    for path in ["/api/calendar/ical", "/api/calendar/ical/sharing-link", "/api/system/config"]:
        response = api.get(path, headers=headers)
        assert response.status_code == 200, response.text


def test_native_calendar_expired_secret_uses_local_clock_and_rotates(api, execute_sql):
    execute_sql(
        "UPDATE api_keys SET expires='2000-01-01 00:00:00' "
        "WHERE key_type='special-purpose-calendar-ical'"
    )
    first = api.get("/api/calendar/ical/sharing-link")
    assert first.status_code == 200, first.text
    link = first.json()["url"]
    key = link.split("secret=", 1)[1]
    assert re.fullmatch(r"[A-Za-z0-9]{50}", key)
    assert api.get(link, headers={"GROCY-API-KEY": ""}).status_code == 200
    now = api.get("/api/system/time").json()["time_local_sqlite3"]
    expired = (datetime.fromisoformat(now) - timedelta(seconds=1)).isoformat(sep=" ")
    execute_sql(f"UPDATE api_keys SET expires='{expired}' WHERE api_key='{key}'")
    denied = api.get(link, headers={"GROCY-API-KEY": ""})
    assert denied.status_code == 401, denied.text
    replacement = api.get("/api/calendar/ical/sharing-link")
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()["url"] != link
    assert api.get(replacement.json()["url"], headers={"GROCY-API-KEY": ""}).status_code == 200


@pytest.mark.parametrize("value", ["0", "-1", "missing", "2147483647"])
def test_native_thermal_missing_list_uses_source_error(api, value):
    response = api.get("/api/print/shoppinglist/thermal", params={"list": value})
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": "Shopping list does not exist"}


def test_native_thermal_permission_error_precedes_list_validation(api):
    name = uuid4().hex
    assert api.post("/api/users", json={"username": name, "password": "test"}).status_code == 204
    user = api.get("/api/users", params={"query[]": "username=" + name}).json()[0]["id"]
    assert api.put(f"/api/users/{user}/permissions", json={"permissions": []}).status_code == 204
    response = api.get(
        "/api/print/shoppinglist/thermal?list=missing",
        headers={"GROCY-API-KEY": user_key(api, user)},
    )
    assert response.status_code == 400, response.text
    assert response.json() == {"error_message": "Permission missing: SHOPPINGLIST"}


@pytest.fixture
def barcode_plugin(api, catalog, monkeypatch, tmp_path):
    """Install a user plugin through Grocy's supported plugin directory."""
    from grocy.core.config import get_settings

    reference = api.base_url == httpx.URL(os.getenv("GROCY_REFERENCE_URL", "http://unused"))
    if reference:
        database = os.getenv("GROCY_REFERENCE_DATABASE")
        if not database:
            pytest.skip("A disposable reference data directory is required")
        root = Path(database).parent
    elif hasattr(api, "portal"):
        root = tmp_path / "native-data"
        monkeypatch.setattr(get_settings(), "datapath", root)
        monkeypatch.setattr(get_settings(), "files_root", tmp_path / "files")
    else:
        pytest.skip("User plugin checks need access to the disposable data directory")
    plugins = root / "plugins"
    plugins.mkdir(parents=True, exist_ok=True)
    path = plugins / "OpenFoodFactsBarcodeLookupPlugin.php"
    output = plugins / "lookup.json"
    previous = path.read_bytes() if path.exists() else None
    # This real user plugin replaces the bundled plugin and exposes its constructor data.
    path.write_text("""<?php
class OpenFoodFactsBarcodeLookupPlugin extends Grocy\\Helpers\\BaseBarcodeLookupPlugin {
    public const PLUGIN_NAME = 'User plugin';
    protected function ExecuteLookup($barcode) {
        $value = json_decode(file_get_contents(__DIR__ . '/lookup.json'), true);
        if (isset($value['product'])) {
            $value = $value['product'];
            $value['__barcode'] = $barcode;
            if (!isset($value['location_id'])) $value['location_id'] = $this->Locations[0]->id;
            if (!isset($value['qu_id_purchase'])) {
                $value['qu_id_purchase'] = $this->QuantityUnits[0]->id;
            }
            if (!isset($value['qu_id_stock'])) $value['qu_id_stock'] = $this->QuantityUnits[0]->id;
        }
        return $value;
    }
}
""")

    class Plugin:
        name = "Looked up " + uuid4().hex
        barcode = "code-Ä-" + uuid4().hex

        def result(self, value):
            output.write_text(json.dumps(value))

        def product(self, **fields):
            self.result(
                {
                    "product": {
                        "name": self.name,
                        "__qu_factor_purchase_to_stock": 1,
                        **fields,
                    }
                }
            )

        def request(self, **params):
            return api.get("/api/stock/barcodes/external-lookup/" + self.barcode, params=params)

    plugin = Plugin()
    plugin.product()
    try:
        yield plugin
    finally:
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(previous)
        output.unlink(missing_ok=True)


@pytest.mark.parametrize("add", [None, "true", "false", "1", "TRUE", ""])
def test_native_external_lookup_preserves_plugin_output_and_add_query(api, barcode_plugin, add):
    plugin = barcode_plugin
    response = plugin.request(**({} if add is None else {"add": add}))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["name"] == plugin.name
    assert result["__barcode"] == plugin.barcode
    assert result["__qu_factor_purchase_to_stock"] == 1
    saved = rows(api, "products", name=plugin.name)
    assert len(saved) == (1 if add == "true" else 0)
    assert ("id" in result) == (add == "true")
    if saved:
        assert result["id"] == str(saved[0]["id"])
        assert saved[0]["location_id"] == result["location_id"]
        barcodes = rows(api, "product_barcodes", product_id=result["id"])
        assert [entry["barcode"] for entry in barcodes] == [plugin.barcode]
        duplicate = plugin.request(add="true")
        assert duplicate.status_code == 400
        assert duplicate.json() == {"error_message": f'Product "{plugin.name}" already exists'}


@pytest.mark.parametrize(
    "value,message",
    [
        (None, None),
        ([], "Plugin output must be an associative array"),
        ("invalid", "Plugin output must be an associative array"),
        ({"name": "Missing fields"}, "Plugin output does not provide needed property location_id"),
        ({"product": {"location_id": -1}}, "Provided location_id (-1) is not a valid location id"),
        (
            {"product": {"qu_id_purchase": -1}},
            "Provided qu_id_purchase (-1) is not a valid quantity unit id",
        ),
        (
            {"product": {"qu_id_stock": -1}},
            "Provided qu_id_stock (-1) is not a valid quantity unit id",
        ),
        (
            {"product": {"__qu_factor_purchase_to_stock": 0}},
            "Provided __qu_factor_purchase_to_stock is empty or not a number",
        ),
    ],
)
def test_native_external_lookup_validates_user_plugin_output(api, barcode_plugin, value, message):
    if isinstance(value, dict) and "product" in value:
        barcode_plugin.product(**value["product"])
    else:
        barcode_plugin.result(value)
    response = barcode_plugin.request(add="true")
    assert response.status_code == (200 if message is None else 400), response.text
    assert response.json() == (None if message is None else {"error_message": message})


@pytest.mark.parametrize("add", ["false", "true"])
def test_native_external_lookup_requires_master_edit_before_plugin(api, barcode_plugin, add):
    name = uuid4().hex
    assert api.post("/api/users", json={"username": name, "password": "test"}).status_code == 204
    user = api.get("/api/users", params={"query[]": "username=" + name}).json()[0]["id"]
    assert api.put(f"/api/users/{user}/permissions", json={"permissions": [9]}).status_code == 204
    response = api.get(
        "/api/stock/barcodes/external-lookup/" + barcode_plugin.barcode,
        params={"add": add},
        headers={"GROCY-API-KEY": user_key(api, user)},
    )
    assert response.status_code == 403, response.text
    assert response.json()["error_message"] == "Permission missing: MASTER_DATA_EDIT"
    assert rows(api, "products", name=barcode_plugin.name) == []


def test_native_external_lookup_keeps_partial_product_on_barcode_error(
    api, barcode_plugin, execute_sql
):
    name = barcode_plugin.name.replace("'", "''")
    execute_sql(
        "CREATE TRIGGER lookup_barcode_failure BEFORE INSERT ON product_barcodes "
        f"WHEN NEW.product_id=(SELECT id FROM products WHERE name='{name}') "
        "BEGIN SELECT RAISE(ABORT,'Barcode blocked'); END"
    )
    try:
        response = barcode_plugin.request(add="true")
        assert response.status_code == 400, response.text
        assert response.json() == {
            "error_message": "SQLSTATE[23000]: Integrity constraint violation: 19 Barcode blocked"
        }
        saved = rows(api, "products", name=barcode_plugin.name)
        assert len(saved) == 1
        assert rows(api, "product_barcodes", product_id=saved[0]["id"]) == []
    finally:
        execute_sql("DROP TRIGGER lookup_barcode_failure")


@pytest.mark.parametrize("status,different_units", [(200, False), (404, False), (200, True)])
def test_native_external_lookup_saves_image_and_unit_conversion(
    api, barcode_plugin, catalog, status, different_units
):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread

    from PIL import Image

    _, unit, other_unit, _ = catalog
    output = BytesIO()
    Image.new("RGB", (3, 2), "blue").save(output, "PNG")
    picture = output.getvalue()
    requests = []

    class ImageServer(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, self.headers.get("User-Agent")))
            self.send_response(status)
            self.send_header("Content-Type", "image/png")
            self.end_headers()
            self.wfile.write(picture)

        def log_message(self, format, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), ImageServer)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        barcode_plugin.name = "Crème <b>raw</b> " + uuid4().hex
        barcode_plugin.barcode = "image-" + uuid4().hex
        barcode_plugin.product(
            qu_id_stock=unit,
            qu_id_purchase=other_unit if different_units else unit,
            __qu_factor_purchase_to_stock=2.5,
            __image_url=f"http://127.0.0.1:{server.server_port}/product.png",
        )
        response = barcode_plugin.request(add="true")
        assert response.status_code == (400 if different_units else 200), response.text
        saved = rows(api, "products", name=barcode_plugin.name)
        assert len(saved) == 1
        product = saved[0]
        assert product["name"] == barcode_plugin.name
        conversions = rows(api, "quantity_unit_conversions", product_id=product["id"])
        if different_units:
            assert response.json() == {
                "error_message": (
                    "SQLSTATE[23000]: Integrity constraint violation: 19 "
                    "QU conversion already exists"
                )
            }
            assert {(row["from_qu_id"], row["to_qu_id"], row["factor"]) for row in conversions} == {
                (other_unit, unit, 1),
                (unit, other_unit, 1),
            }
            barcodes = rows(api, "product_barcodes", product_id=product["id"])
            assert [row["barcode"] for row in barcodes] == [barcode_plugin.barcode]
        else:
            assert response.json()["id"] == str(product["id"])
            assert conversions == []
        assert requests == [("/product.png", "Grocy/4.5.0 (https://grocy.info)")]
        if status == 200:
            filename = barcode_plugin.barcode + ".png"
            assert product["picture_file_name"] == filename
            encoded = base64.b64encode(filename.encode()).decode()
            downloaded = api.get("/api/files/productpictures/" + encoded)
            assert downloaded.status_code == 200, downloaded.text
            assert downloaded.content == picture
        else:
            assert product["picture_file_name"] is None
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


@pytest.mark.parametrize(
    "plugin,message",
    [
        ("", "No barcode lookup plugin defined"),
        ("MissingPlugin", "Plugin MissingPlugin was not found"),
    ],
)
def test_native_external_lookup_keeps_plugin_loader_errors(
    api, barcode_plugin, monkeypatch, plugin, message
):
    from grocy.core.config import get_settings

    reference = api.base_url == httpx.URL(os.getenv("GROCY_REFERENCE_URL", "http://unused"))
    override = previous = None
    if reference:
        override = (
            Path(os.environ["GROCY_REFERENCE_DATABASE"]).parent
            / "settingoverrides"
            / "STOCK_BARCODE_LOOKUP_PLUGIN.txt"
        )
        override.parent.mkdir(exist_ok=True)
        previous = override.read_bytes() if override.exists() else None
        override.write_text(plugin)
    else:
        monkeypatch.setattr(get_settings(), "stock_barcode_lookup_plugin", plugin)
    try:
        response = barcode_plugin.request()
        assert response.status_code == 400, response.text
        assert response.json() == {"error_message": message}
    finally:
        if override is not None:
            if previous is None:
                override.unlink(missing_ok=True)
            else:
                override.write_bytes(previous)


@pytest.mark.parametrize(
    "params,status,offset",
    [
        ([], 200, 0),
        ([("offset", "-60")], 200, -60),
        ([("offset", "+1")], 200, 1),
        ([("offset", " 1 ")], 200, 1),
        ([("offset", "2147483648")], 200, 2147483648),
        ([("offset", "01")], 400, None),
        ([("offset", "1.0")], 400, None),
        ([("offset", "1e0")], 400, None),
        ([("offset", "")], 400, None),
        ([("offset", "true")], 400, None),
        ([("offset[]", "1")], 400, None),
        ([("offset", "bad"), ("offset", "1")], 200, 1),
        ([("offset", "9223372036854775808")], 400, None),
        ([("offset", "9223372036854775807")], 500, None),
    ],
)
def test_native_system_time_uses_php_offset_rules(api, params, status, offset):
    response = api.get("/api/system/time", params=params)
    assert response.status_code == status, response.text
    payload = response.json()
    if status == 400:
        assert payload == {"error_message": 'Query parameter "offset" is not a valid integer'}
    elif status == 500:
        assert "must be of type" in payload["error_message"]
        assert "float given" in payload["error_message"]
        assert set(payload) == {"error_message", "error_details"}
    else:
        assert set(payload) == {
            "timezone",
            "time_local",
            "time_local_sqlite3",
            "time_utc",
            "timestamp",
            "offset",
        }
        assert payload["offset"] == offset
        assert isinstance(payload["timestamp"], int)
        assert isinstance(payload["timezone"], str)
        assert all(
            isinstance(payload[key], str)
            for key in ["time_local", "time_local_sqlite3", "time_utc"]
        )
        assert (
            int(datetime.fromisoformat(payload["time_utc"]).replace(tzinfo=UTC).timestamp())
            == payload["timestamp"]
        )


def test_native_system_info_uses_request_headers_and_saved_version(api, execute_sql):
    execute_sql("INSERT INTO migrations(migration) VALUES (1337)")
    try:
        response = api.get("/api/system/info", headers={"User-Agent": "Native system agent"})
        assert response.status_code == 200, response.text
        info = response.json()
        assert set(info) == {
            "grocy_version",
            "php_version",
            "sqlite_version",
            "db_version",
            "os",
            "client",
        }
        assert info["db_version"] == 1337
        assert info["client"] == "Native system agent"
        assert info["grocy_version"] == {"Version": "4.5.0", "ReleaseDate": "2025-03-28"}
        assert all(
            isinstance(info[name], str) and info[name]
            for name in ["php_version", "sqlite_version", "os"]
        )
    finally:
        execute_sql("DELETE FROM migrations WHERE migration=1337")


@pytest.mark.parametrize("body", [b"", b"{}", b"{broken"])
def test_native_system_missing_translation_keeps_production_error(api, body):
    response = api.post(
        "/api/system/log-missing-localization",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 500, response.text
    assert response.json()["error_message"] == (
        "Slim\\Handlers\\Strategies\\RequestResponse::__invoke(): Return value must be of type "
        "Psr\\Http\\Message\\ResponseInterface, null returned"
    )
    assert set(response.json()) == {"error_message", "error_details"}


@pytest.mark.parametrize("timestamp", ["0000-01-04 10:00:00", "invalid"])
def test_native_setting_dates_do_not_block_requests(api, execute_sql, timestamp):
    key = "unused-date-" + uuid4().hex
    assert api.put("/api/user/settings/" + key, json={"value": "kept"}).status_code == 204
    columns = {row[1] for row in execute_sql("PRAGMA table_info(user_settings)")}
    added = "row_created_timestamp" not in columns
    if added:
        execute_sql("ALTER TABLE user_settings ADD COLUMN row_created_timestamp DATETIME")
    execute_sql(f"UPDATE user_settings SET row_created_timestamp='{timestamp}' WHERE key='{key}'")
    try:
        response = api.get("/api/system/info")
        assert response.status_code == 200, response.text
        assert response.json()["grocy_version"]["Version"] == "4.5.0"
        value = api.get("/api/user/settings/" + key)
        assert value.status_code == 200 and value.json() == {"value": "kept"}
    finally:
        execute_sql(f"DELETE FROM user_settings WHERE key='{key}'")
        if added:
            execute_sql("ALTER TABLE user_settings DROP COLUMN row_created_timestamp")


@pytest.mark.parametrize(
    "case,expected_status,used",
    [
        ("valid", 200, True),
        ("orphan", 401, True),
        ("null-expiry", 401, False),
        ("expired-local", 401, False),
        ("whole-second", 401, False),
        ("future-local", 200, True),
        ("text-expiry", 200, True),
        ("zero", 401, False),
        ("duplicate-header", 401, False),
        ("query-fallback", 200, True),
        ("duplicate-query", 200, True),
        ("query-array", 401, False),
        ("query-array-override", 200, True),
        ("query-array-extra", 500, False),
        ("named-query", 200, True),
        ("unknown-name", 500, False),
        ("nested-selected", 500, True),
    ],
)
def test_native_api_key_checks_and_use_records(api, execute_sql, case, expected_status, used):
    from grocy.core.time import server_timezone

    key = (
        "0"
        if case == "zero"
        else "Array"
        if case == "nested-selected"
        else "native-auth-" + uuid4().hex
    )
    now = datetime.now(server_timezone())
    expires = "2999-12-31 23:59:59"
    if case == "null-expiry":
        expires = None
    elif case in {"expired-local", "future-local", "whole-second"}:
        minutes = {"expired-local": -2, "future-local": 2, "whole-second": 0}[case]
        expires = (now + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")
    elif case == "text-expiry":
        expires = "not-a-date"
    elif case == "query-array-override":
        expires = "2000-01-01 00:00:00"
    expiry_sql = "NULL" if expires is None else f"'{expires}'"
    user_id = 2147483647 if case == "orphan" else 1
    execute_sql(
        f"INSERT INTO api_keys(api_key,user_id,expires) VALUES ('{key}',{user_id},{expiry_sql})"
    )
    headers = [("GROCY-API-KEY", key)]
    params = []
    if case == "duplicate-header":
        headers.append(("GROCY-API-KEY", "invalid"))
    elif case in {"query-fallback", "duplicate-query"}:
        headers = [("GROCY-API-KEY", "invalid")]
        if case == "duplicate-query":
            params.append(("GROCY-API-KEY", "invalid"))
        params.append(("GROCY-API-KEY", key))
    elif case.startswith("query-array"):
        headers = [("GROCY-API-KEY", "invalid")]
        params.append(("GROCY-API-KEY[]", key))
        if case != "query-array":
            params.extend(
                [("GROCY-API-KEY[]", "0000-01-01 00:00:00"), ("GROCY-API-KEY[]", "default")]
            )
        if case == "query-array-extra":
            params.append(("GROCY-API-KEY[]", "extra"))
    if case in {"named-query", "unknown-name", "nested-selected"}:
        headers = [("GROCY-API-KEY", "invalid")]
        if case == "named-query":
            params = [
                ("GROCY-API-KEY[:1]", key),
                ("GROCY-API-KEY[:2]", "0000-01-01 00:00:00"),
                ("GROCY-API-KEY[:3]", "default"),
            ]
        elif case == "unknown-name":
            params = [("GROCY-API-KEY[unknown]", key)]
        else:
            params = [
                ("GROCY-API-KEY[0][]", "invalid"),
                ("GROCY-API-KEY[1]", "0000-01-01 00:00:00"),
                ("GROCY-API-KEY[2]", "default"),
            ]
    try:
        for _ in range(2):
            before = datetime.now(server_timezone()).strftime("%Y-%m-%d %H:%M:%S")
            response = api.get("/api/system/info", headers=headers, params=params)
            after = datetime.now(server_timezone()).strftime("%Y-%m-%d %H:%M:%S")
            assert response.status_code == expected_status, response.text
            last_used = execute_sql(f"SELECT last_used FROM api_keys WHERE api_key='{key}'")[0][0]
            if used:
                assert isinstance(last_used, str) and before <= last_used <= after
            else:
                assert last_used is None
            if expected_status == 401:
                assert response.content == b""
            elif expected_status == 500:
                if case == "nested-selected":
                    assert response.json()["error_message"] == (
                        "PDO::quote(): Argument #1 ($string) must be of type string, array given"
                    )
                else:
                    assert response.json()["error_message"] == (
                        "SQLSTATE[HY000]: General error: 25 column index out of range"
                    )
    finally:
        execute_sql(f"DELETE FROM api_keys WHERE api_key='{key}'")


@pytest.mark.parametrize(
    "case,status,used",
    [
        ("invalid-query", 401, False),
        ("invalid-header", 401, False),
        ("nested-query", 401, False),
        ("stored-query", 200, True),
        ("stored-header", 200, True),
        ("stored-header-collision", 200, True),
        ("stored-nul-missing-query", 401, True),
        ("stored-nul-prefix-query", 200, True),
        ("stored-binary-nul-prefix-query", 200, True),
    ],
)
def test_native_api_key_raw_bytes_and_nested_values(api, execute_sql, case, status, used):
    from urllib.parse import quote_from_bytes

    key = b"native-byte-" + uuid4().hex.encode() + b"\xff"
    prefix_key = None
    collision_key = None
    if case == "stored-header-collision":
        collision_key = key.decode("latin1").encode().hex()
        execute_sql(
            "INSERT INTO api_keys(api_key,user_id,expires,key_type) "
            f"VALUES (CAST(X'{collision_key}' AS TEXT),2147483647,NULL,'grocy-next')"
        )
    if "nul" in case:
        prefix = key if "binary" in case else key[:-1]
        key = prefix + b"\0tail"
        if "prefix" in case:
            prefix_key = prefix.hex()
            execute_sql(
                "INSERT INTO api_keys(api_key,user_id,expires) "
                f"VALUES (CAST(X'{prefix_key}' AS TEXT),1,'2999-12-31 23:59:59')"
            )
    hex_key = key.hex()
    if used:
        execute_sql(
            "INSERT INTO api_keys(api_key,user_id,expires) "
            f"VALUES (CAST(X'{hex_key}' AS TEXT),1,'2999-12-31 23:59:59')"
        )
    try:
        for _ in range(2):
            if "header" in case:
                headers = [(b"GROCY-API-KEY", key)]
                if hasattr(api, "portal"):
                    # TestClient encodes non-ASCII header values again. ASGITransport
                    # passes request.headers.raw to the same production application.
                    async def send(current_headers):
                        async with httpx.AsyncClient(
                            transport=httpx.ASGITransport(app=api.app),
                            base_url=str(api.base_url),
                        ) as client:
                            return await client.get("/api/system/info", headers=current_headers)

                    response = api.portal.call(send, headers)
                else:
                    response = api.get("/api/system/info", headers=headers)
            else:
                query = (
                    "GROCY-API-KEY[][]=invalid"
                    if case == "nested-query"
                    else "GROCY-API-KEY=" + quote_from_bytes(key, safe="")
                )
                response = api.get(
                    "/api/system/info?" + query, headers={"GROCY-API-KEY": "invalid"}
                )
            assert response.status_code == status, response.text
            if status == 401:
                assert response.content == b""
            else:
                assert response.json()["grocy_version"]["Version"] == "4.5.0"
            if used:
                last_used = execute_sql(
                    f"SELECT last_used FROM api_keys WHERE CAST(api_key AS BLOB)=X'{hex_key}'"
                )[0][0]
                assert isinstance(last_used, str) and len(last_used) == 19
            if prefix_key is not None:
                assert execute_sql(
                    f"SELECT last_used FROM api_keys WHERE CAST(api_key AS BLOB)=X'{prefix_key}'"
                ) == [(None,)]
    finally:
        if used:
            execute_sql(f"DELETE FROM api_keys WHERE CAST(api_key AS BLOB)=X'{hex_key}'")
        if prefix_key is not None:
            execute_sql(f"DELETE FROM api_keys WHERE CAST(api_key AS BLOB)=X'{prefix_key}'")
        if collision_key is not None:
            execute_sql(f"DELETE FROM api_keys WHERE CAST(api_key AS BLOB)=X'{collision_key}'")


@pytest.fixture
def native_data_directory(api):
    from grocy.core.config import get_settings

    reference = api.base_url == httpx.URL(os.getenv("GROCY_REFERENCE_URL", "http://unused"))
    if reference:
        database = os.getenv("GROCY_REFERENCE_DATABASE")
        if not database:
            pytest.skip("Configuration checks need the disposable reference directory")
        return Path(database).parent
    elif hasattr(api, "portal"):
        return get_settings().datapath
    else:
        pytest.skip("Configuration checks need access to the backend data directory")


@pytest.fixture
def runtime_configuration(api, native_data_directory):
    path = native_data_directory / "config.php"
    previous = path.read_bytes() if path.exists() else None
    path.parent.mkdir(parents=True, exist_ok=True)

    def configure(code):
        path.write_bytes(
            b"<?php\n" + code.encode() + b"\n" + (previous or b"").removeprefix(b"<?php")
        )

    try:
        yield configure
    finally:
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(previous)
        api.options("/api/system/info", follow_redirects=False)


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
@pytest.mark.parametrize("mode", ["production", "dev"])
def test_native_cache_change_redirects_before_authentication(
    api, runtime_configuration, method, mode
):
    runtime_configuration(f"Setting('BASE_URL', '/startup-gap');Setting('MODE', '{mode}');")
    headers = dict(api.headers)
    try:
        api.headers.pop("GROCY-API-KEY", None)
        response = api.request(method, "/api/system/info", follow_redirects=False)
        assert response.status_code == 302
        assert response.headers["location"] == "/startup-gap/"
        assert response.content == b""
        assert "access-control-allow-origin" not in response.headers
        assert api.get("/api/system/info", follow_redirects=False).status_code == (
            401 if mode == "production" else 200
        )
    finally:
        api.headers.update(headers)


@pytest.mark.parametrize(
    ("method", "path", "authenticated", "status"),
    [
        ("GET", "/system/info", True, 200),
        ("HEAD", "/system/info", True, 200),
        ("OPTIONS", "/system/info", False, 200),
        ("GET", "/system/info", False, 302),
        ("PATCH", "/system/info", True, 500),
        ("GET", "/missing-route", True, 500),
    ],
)
def test_native_base_path_uses_original_routes_and_error_pages(
    api, runtime_configuration, method, path, authenticated, status
):
    runtime_configuration("Setting('BASE_PATH', '/parity');")
    assert api.options("/api/system/info", follow_redirects=False).status_code == 302
    headers = dict(api.headers)
    try:
        if not authenticated:
            api.headers.pop("GROCY-API-KEY", None)
        response = api.request(method, "/parity/api" + path, follow_redirects=False)
        assert response.status_code == status, response.text
        if status == 302:
            assert response.headers["location"].endswith("/login")
            assert response.content == b""
        elif status in {404, 500}:
            assert response.headers["content-type"].startswith("text/html")
            assert b"<!DOCTYPE html>" in response.content
        elif method in {"HEAD", "OPTIONS"}:
            assert response.content == b""
        else:
            assert response.json()["grocy_version"]["Version"] == "4.5.0"
    finally:
        api.headers.update(headers)


@pytest.mark.parametrize("mode", ["demo", "prerelease"])
def test_native_mode_uses_uninitialized_separate_database(
    api, runtime_configuration, native_data_directory, mode
):
    path = native_data_directory / ("grocy_missing_" + uuid4().hex + ".db")
    runtime_configuration(
        f"Setting('MODE', '{mode}');Setting('DEMO_DB_SUFFIX', '{path.stem[6:]}');"
    )
    try:
        response = api.get("/api/user", follow_redirects=False)
        assert response.status_code == 500, response.text
        assert path.exists()
        with sqlite3.connect(path) as database:
            assert database.execute("SELECT name FROM sqlite_master").fetchall() == []
    finally:
        path.unlink(missing_ok=True)


def test_native_base_path_dispatches_encoded_file_routes(api, runtime_configuration):
    from urllib.parse import quote

    runtime_configuration("Setting('BASE_PATH', '/parity');")
    assert api.options("/api/system/info", follow_redirects=False).status_code == 302
    name = "Prefixed Ä " + uuid4().hex + ".bin"
    encoded = quote(base64.b64encode(name.encode()).decode(), safe="")
    path = "/parity/api/files/productpictures/" + encoded
    content = b"\x00\xffnative bytes"

    def download(method):
        if not hasattr(api, "portal"):
            return api.request(method, path)

        # TestClient converts response headers to ASCII strings. Keep their bytes.
        async def request():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=api.app),
                base_url=str(api.base_url),
                headers=api.headers,
            ) as direct:
                return await direct.request(method, path)

        return api.portal.call(request)

    try:
        response = api.put(path, content=content)
        assert response.status_code == 204, response.text
        response = download("GET")
        assert response.status_code == 200, response.text
        assert response.content == content
        assert response.headers["content-disposition"] == f'inline; filename="{name}"'
        assert download("HEAD").content == b""
    finally:
        assert api.delete(path).status_code == 204


@pytest.mark.parametrize(("mode", "suffix"), [("demo", None), ("prerelease", "custom_mode")])
def test_native_mode_reads_and_writes_its_own_database(
    api, runtime_configuration, native_data_directory, mode, suffix
):
    from grocy.db.native_schema import SCHEMA

    path = native_data_directory / f"grocy_{suffix or 'de'}.db"
    assert not path.exists()
    username = "Mode owner " + uuid4().hex
    task_name = "Mode task " + uuid4().hex
    with sqlite3.connect(path) as database:
        for kind in ("ddl", "views", "triggers"):
            for statement in SCHEMA[kind].values():
                database.execute(statement)
        database.execute("INSERT INTO users(id,username,password) VALUES (1,?,'')", (username,))
        database.executemany(
            "INSERT INTO permission_hierarchy(id,name,parent) VALUES (?,?,?)", SCHEMA["permissions"]
        )
        database.execute("INSERT INTO user_permissions(user_id,permission_id) VALUES (1,1)")
    code = f"Setting('MODE', '{mode}');Setting('DEFAULT_LOCALE', 'de');"
    if suffix:
        code += f"Setting('DEMO_DB_SUFFIX', '{suffix}');"
    runtime_configuration(code)
    try:
        response = api.get("/api/user")
        assert response.status_code == 200, response.text
        assert response.json()[0]["username"] == username
        task = create(api, "tasks", name=task_name)
        response = api.post(f"/api/tasks/{task}/complete", json={})
        assert response.status_code == 204, response.text
        with sqlite3.connect(path) as database:
            assert database.execute("SELECT done FROM tasks WHERE id=?", (task,)).fetchone() == (1,)
        runtime_configuration("")
        assert all(row["name"] != task_name for row in rows(api, "tasks"))
    finally:
        path.unlink(missing_ok=True)


def test_native_configuration_defaults_and_saved_setting_precedence(api, runtime_configuration):
    runtime_configuration(
        "DefaultUserSetting('stock_due_soon_days', 37);"
        "DefaultUserSetting('stock_decimal_places_amounts', 2);"
        "DefaultUserSetting('native_nested_default', ['key' => [1, true, null]]);"
        "Setting('CURRENCY', 'EUR');"
    )
    settings = api.get("/api/user/settings")
    assert settings.status_code == 200, settings.text
    assert settings.json()["stock_due_soon_days"] == 37
    assert settings.json()["stock_decimal_places_amounts"] == 2
    assert settings.json()["native_nested_default"] == {"key": [1, True, None]}
    assert api.get("/api/system/config").json()["CURRENCY"] == "EUR"
    path = "/api/user/settings/stock_decimal_places_amounts"
    try:
        assert api.put(path, json={"value": 3}).status_code == 204
        assert api.get(path).json() == {"value": "3"}
    finally:
        assert api.delete(path).status_code == 204
    assert api.get(path).json() == {"value": 2}
    runtime_configuration("DefaultUserSetting('stock_due_soon_days', 4);")
    assert api.get("/api/user/settings/stock_due_soon_days").json() == {"value": 4}


def test_native_configured_due_days_reach_recipe_sql(api, catalog, runtime_configuration):
    from datetime import date

    product, unit, *_ = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=1, qu_id=unit)
    due = (date.today() + timedelta(days=20)).isoformat()
    assert (
        api.post(
            f"/api/stock/products/{product}/add", json={"amount": 1, "best_before_date": due}
        ).status_code
        == 200
    )
    runtime_configuration("DefaultUserSetting('stock_due_soon_days', 37);")
    assert rows(api, "recipes_pos_resolved", recipe_id=recipe)[0]["due_score"] == 1
    runtime_configuration("DefaultUserSetting('stock_due_soon_days', 4);")
    assert rows(api, "recipes_pos_resolved", recipe_id=recipe)[0]["due_score"] == 0


@pytest.mark.parametrize(
    ("code", "message"),
    [
        (
            "Setting('MODE', 'wrong');",
            'Invalid mode "wrong" set, only production, dev, demo, prerelease allowed',
        ),
        (
            "Setting('DEFAULT_LOCALE', 'wrong');",
            'Invalid locale "wrong" set, locale needs to exist in folder localization',
        ),
        ("Setting('CURRENCY', 'EURO');", "CURRENCY is not in ISO 4217 format (three letter code)"),
        (
            "Setting('CALENDAR_FIRST_DAY_OF_WEEK', 7);",
            "Invalid value for CALENDAR_FIRST_DAY_OF_WEEK",
        ),
        (
            "Setting('MEAL_PLAN_FIRST_DAY_OF_WEEK', -2);",
            "Invalid value for MEAL_PLAN_FIRST_DAY_OF_WEEK",
        ),
        (
            "DefaultUserSetting('auto_night_mode_time_range_from', '25:00');",
            "auto_night_mode_time_range_from is not in HH:mm format (25:00)",
        ),
    ],
)
def test_native_configuration_errors_precede_http_and_authentication(
    api, runtime_configuration, code, message
):
    runtime_configuration(code)
    for method in ("GET", "OPTIONS"):
        response = api.request(method, "/api/user", headers={"GROCY-API-KEY": "invalid"})
        assert response.status_code == 200, response.text
        assert response.text == "Invalid setting in config.php: " + message
        assert response.headers["content-type"] == "text/html; charset=UTF-8"
        assert "access-control-allow-origin" not in response.headers


def test_native_bootstrap_output_retains_http_header_state(
    api, runtime_configuration, php_http_settings
):
    runtime_configuration(
        r"class BootstrapAuth extends \Grocy\Middleware\DefaultAuthMiddleware {"
        r"public function __construct($container, $factory) {"
        r"parent::__construct($container, $factory); echo 'BOOTSTRAP:'; }}"
        r"Setting('AUTH_CLASS', 'BootstrapAuth');Setting('DISABLE_AUTH', true);"
    )
    response = api.get("/api/user")
    assert response.status_code == 200, response.text
    prefix = php_http_settings["bootstrap_output"]
    assert response.content.startswith(prefix)
    assert json.loads(response.content.removeprefix(prefix))[0]["id"] == 1
    if prefix:
        assert response.headers["content-type"] == php_http_settings["bootstrap_content_type"]
        assert "access-control-allow-origin" not in response.headers
    else:
        assert response.headers["content-type"] == "application/json"
        assert response.headers["access-control-allow-origin"] == "*"


@pytest.mark.parametrize(
    "case", ["output", "development", "header", "handler", "buffer", "shutdown", "exit"]
)
def test_native_configuration_http_side_effects(
    api, runtime_configuration, php_http_settings, case
):
    code = {
        "output": "echo 'CONFIG:';",
        "development": "Setting('MODE', 'dev');echo 'CONFIG:';",
        "header": "header('X-Configuration: retained');",
        "handler": "Setting('MODE', 'dev');set_error_handler(function(){echo 'HANDLED:';});",
        "buffer": "ob_start(function($output){return 'WRAP:' . $output;});",
        "shutdown": "register_shutdown_function(function(){echo ':SHUTDOWN';});",
        "exit": "http_response_code(418);header('X-Configuration: terminal');exit('STOP');",
    }[case]
    runtime_configuration(code)
    response = api.get("/api/user", follow_redirects=False)
    if case == "exit":
        assert response.status_code == 418
        assert response.headers["x-configuration"] == "terminal"
        assert response.content == b"STOP"
        return
    assert response.status_code == 200, response.text
    if case == "header":
        assert response.headers["x-configuration"] == "retained"
    if case == "shutdown":
        assert response.content.endswith(b":SHUTDOWN")
    if case == "buffer":
        assert response.content.startswith(b"WRAP:")
    if case in {"output", "development"} and php_http_settings["bootstrap_output"]:
        assert response.content.startswith(b"CONFIG:")
    if case == "handler":
        assert b"ob_clean()" not in response.content
        if php_http_settings["bootstrap_output"]:
            assert response.content.startswith(b"HANDLED:")
    start = response.content.find(b'[{"id":')
    assert start >= 0, response.text
    payload = response.content[start:].removesuffix(b":SHUTDOWN")
    assert json.loads(payload)[0]["id"] == 1


def test_native_configuration_output_precedes_cache_redirect(
    api, runtime_configuration, php_http_settings
):
    runtime_configuration("echo 'CONFIG:';Setting('BASE_URL', '/configuration-cache');")
    response = api.get("/api/user", follow_redirects=False)
    if php_http_settings["bootstrap_output"]:
        assert response.status_code == 200
        assert "location" not in response.headers
    else:
        assert response.status_code == 302
        assert response.headers["location"] == "/configuration-cache/"
    assert response.content == b"CONFIG:"
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("mode", ["disabled", *DEVELOPMENT_PROFILES])
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/user"),
        ("HEAD", "/api/user"),
        ("OPTIONS", "/api/user"),
        ("PATCH", "/api/system/info"),
    ],
)
def test_native_development_output_and_authentication_bypass(
    api,
    runtime_configuration,
    native_data_directory,
    php_http_settings,
    request,
    mode,
    method,
    path,
):
    log = native_data_directory / "development-errors.log"
    if mode == "logging":
        assert not log.exists()
        request.addfinalizer(lambda: log.unlink(missing_ok=True))
    runtime_configuration(
        "Setting('DISABLE_AUTH', true);"
        if mode == "disabled"
        else "Setting('MODE', 'dev');" + DEVELOPMENT_PROFILES[mode]
    )
    expected = php_http_settings["development"].get(mode, {"output": b""})
    notice = expected["output"]
    body_notice = expected.get("service_output", notice) if method == "GET" else notice
    content_type = expected.get("content_type")
    headers = {"GROCY-API-KEY": "invalid"}
    if mode == "registration":
        headers["Cookie"] = ("ignored=1; " * (php_http_settings["max_input_vars"] + 1)).rstrip()
        warning = php_http_settings["startup_output"]
        notice = warning + notice
        body_notice = warning + body_notice
        if warning:
            content_type = php_http_settings["startup_content_type"]
    response = api.request(method, path, headers=headers)
    if mode == "logging":
        contents = log.read_bytes() if log.exists() else b""
        assert (
            contents.count(b"ob_clean(): Failed to delete buffer. No buffer to delete")
            == expected["logged"]
        )
    assert response.status_code == (405 if method == "PATCH" and not notice else 200), response.text
    if notice:
        assert response.headers["content-type"] == content_type
        assert "access-control-allow-origin" not in response.headers
    else:
        assert response.headers["access-control-allow-origin"] == "*"
        if method != "OPTIONS":
            assert response.headers["content-type"] == "application/json"
    if method == "HEAD":
        assert response.content == b""
        return
    prefix = response.content
    if method != "OPTIONS":
        start = prefix.find(b'{"error_message":' if method == "PATCH" else b'[{"id":')
        assert start >= 0, response.text
        payload = json.loads(prefix[start:])
        prefix = prefix[:start]
        if method == "GET":
            assert payload[0]["id"] == 1
        else:
            assert payload["error_message"].startswith("Method not allowed.")

    def normalize_location(output):
        output = re.sub(
            rb" in <b>[^<]+</b> on line <b>\d+</b>", b" in <b>FILE</b> on line <b>LINE</b>", output
        )
        return re.sub(rb" in [^\r\n]+ on line \d+", b" in FILE on line LINE", output)

    assert normalize_location(prefix) == normalize_location(body_notice)


@pytest.mark.parametrize(
    ("case", "suffix", "cookie", "valid"),
    [
        ("valid", b"", "grocy_session={key}", True),
        ("expired", b"", "grocy_session={key}", False),
        ("null", b"", "grocy_session={key}", False),
        ("orphan-key", b"", "grocy_session={key}", True),
        ("duplicate", b"", "grocy_session={key}; grocy_session=invalid", True),
        ("percent", b" a+b", "grocy_session={key}%20a%2Bb", True),
        ("plus", b" a+b", "grocy_session={key} a+b", True),
        ("array", b"", "grocy_session[]={key}", False),
        ("ampersand", b"&tail", "grocy_session={key}&tail", True),
        ("encoded-ampersand", b"&tail", "grocy_session={key}%26tail", True),
        ("ampersand-fields", b"", "grocy_session=invalid&grocy_session={key}", False),
        ("equals", b"=tail", "grocy_session={key}=tail", True),
        ("percent-name", b"", "grocy%5Fsession={key}", False),
        ("dot-name", b"", "grocy.session={key}", True),
        ("space-name", b"", "grocy session={key}", True),
        ("plus-name", b"", "grocy+session={key}", False),
        ("encoded-array-name", b"", "grocy_session%5B%5D={key}", False),
        ("array-first", b"", "grocy_session[]=invalid; grocy_session={key}", False),
        ("scalar-first", b"", "grocy_session={key}; grocy_session[]=invalid", False),
        ("invalid-first", b"", "grocy_session=invalid; grocy_session={key}", False),
        ("empty-first", b"", "grocy_session=; grocy_session={key}", False),
        ("bare-first", b"", "grocy_session; grocy_session={key}", False),
        ("quoted", b"", 'grocy_session="{key}"', False),
        ("semicolon", b";tail", "grocy_session={key}%3Btail", True),
        ("nul", b"\0tail", "grocy_session={key}%00tail", False),
        ("binary", b"\xff", "grocy_session={key}%FF", True),
        ("double-encoding", b"%26tail", "grocy_session={key}%2526tail", True),
        ("tab-name", b"", "other=value;\tgrocy_session={key}", True),
        ("trailing-name-space", b"", "grocy_session ={key}", False),
        ("input-limit", b"", "ignored=1; " * 1000 + "grocy_session={key}", False),
        ("input-limit-valid-first", b"", "grocy_session={key}; " + "ignored=1; " * 1000, True),
        ("below-limit", b"", "ignored=1; " * 999 + "grocy_session={key}", True),
        (
            "nested-removal",
            b"",
            "grocy_session=invalid; grocy_session" + "[0]" * 65 + "=invalid; grocy_session={key}",
            True,
        ),
        (
            "nested-limit",
            b"",
            "grocy_session=invalid; grocy_session" + "[0]" * 64 + "=invalid; grocy_session={key}",
            False,
        ),
        (
            "named-array",
            b"",
            "grocy_session[:1]={key}; grocy_session[:2]=0000-01-01%2000:00:00",
            True,
        ),
        (
            "array-overwrite",
            b"",
            "grocy_session[:1]=invalid; grocy_session[:1]={key}; "
            "grocy_session[:2]=0000-01-01%2000:00:00",
            True,
        ),
        (
            "array-reject",
            b"",
            "grocy_session[:1]={key}; grocy_session[:1]=invalid; "
            "grocy_session[:2]=0000-01-01%2000:00:00",
            False,
        ),
        (
            "expired-array",
            b"",
            "grocy_session[:1]={key}; grocy_session[:2]=0000-01-01%2000:00:00",
            True,
        ),
    ],
    ids=lambda value: value if isinstance(value, str) and "{key}" not in value else "",
)
def test_native_session_cookie_authentication_and_use_time(
    api, execute_sql, php_http_settings, case, suffix, cookie, valid
):
    token = uuid4().hex
    hex_key = (token.encode() + suffix).hex()
    expiry = (
        "NULL"
        if case == "null"
        else "'2000-01-01 00:00:00'"
        if case in {"expired", "expired-array"}
        else "'2999-12-31 23:59:59'"
    )
    execute_sql(
        "INSERT INTO sessions(session_key,user_id,expires) "
        f"VALUES (CAST(X'{hex_key}' AS TEXT),1,{expiry})"
    )
    headers = {"GROCY-API-KEY": "", "Cookie": cookie.format(key=token).rstrip(" \t")}
    orphan = uuid4().hex
    if case == "orphan-key":
        execute_sql(
            "INSERT INTO api_keys(api_key,user_id,expires) "
            f"VALUES ('{orphan}',2147483647,'2999-12-31 23:59:59')"
        )
        headers["GROCY-API-KEY"] = orphan
    try:
        response = api.get("/api/user", headers=headers)
        warning = php_http_settings["startup_output"]
        if case in {"input-limit", "input-limit-valid-first"} and warning:
            assert response.status_code == 200, response.text
            assert response.content.startswith(warning), response.text
            remainder = response.content.removeprefix(warning)
            if valid:
                assert json.loads(remainder)[0]["id"] == 1
            else:
                assert remainder == b""
            assert response.headers.get("content-type") == php_http_settings["startup_content_type"]
            assert "access-control-allow-origin" not in response.headers
        else:
            assert response.status_code == (200 if valid else 401), response.text
        if case in {"input-limit", "input-limit-valid-first"}:
            for method in ("HEAD", "OPTIONS"):
                other = api.request(method, "/api/user", headers=headers)
                expected = 200 if warning or valid or method == "OPTIONS" else 401
                assert other.status_code == expected, other.text
                assert other.content == (warning if method == "OPTIONS" else b"")
                if warning:
                    assert (
                        other.headers.get("content-type")
                        == php_http_settings["startup_content_type"]
                    )
                    assert "access-control-allow-origin" not in other.headers
                else:
                    assert other.headers["access-control-allow-origin"] == "*"
        if valid and (case != "input-limit-valid-first" or not warning):
            assert response.json()[0]["id"] == 1
        used = execute_sql(
            f"SELECT last_used FROM sessions WHERE CAST(session_key AS BLOB)=X'{hex_key}'"
        )[0][0]
        assert bool(used) == (valid or case == "nul")
    finally:
        execute_sql(f"DELETE FROM sessions WHERE CAST(session_key AS BLOB)=X'{hex_key}'")
        execute_sql(f"DELETE FROM api_keys WHERE api_key='{orphan}'")


@pytest.mark.parametrize("case", ["new", "missing", "duplicate", "env"])
def test_native_reverse_proxy_identity_and_default_permissions(
    api, execute_sql, runtime_configuration, case
):
    runtime_configuration(
        "Setting('AUTH_CLASS', 'Grocy\\\\Middleware\\\\ReverseProxyAuthMiddleware');"
        "Setting('DEFAULT_PERMISSIONS', ['TASKS_MARK_COMPLETED']);"
        + (
            "Setting('REVERSE_PROXY_AUTH_USE_ENV', true);"
            "Setting('REVERSE_PROXY_AUTH_HEADER', 'HTTP_REMOTE_USER');"
            if case == "env"
            else "Setting('REVERSE_PROXY_AUTH_HEADER', 'Remote-User');"
        )
    )
    username = "proxy-" + uuid4().hex
    headers = [("GROCY-API-KEY", "")]
    if case != "missing":
        headers.append(("Remote-User", username))
    if case == "duplicate":
        headers.append(("Remote-User", "second"))
        username += ", second"
    response = api.get("/api/user", headers=headers)
    if case == "missing":
        assert response.status_code == 500, response.text
        assert response.json()["error_message"] == (
            "ReverseProxyAuthMiddleware: Remote-User header is missing or invalid"
        )
        return
    assert response.status_code == 200, response.text
    user = response.json()[0]
    assert user["username"] == username
    assert api.get("/api/user", headers=headers).json()[0]["id"] == user["id"]
    assert api.get("/api/objects/tasks", headers=headers).status_code == 200
    task = create(api, "tasks", name=uuid4().hex)
    assert api.post(f"/api/tasks/{task}/complete", headers=headers, json={}).status_code == 204
    assert (
        api.post("/api/objects/tasks", headers=headers, json={"name": uuid4().hex}).status_code
        == 403
    )
    assert execute_sql(
        "SELECT COUNT(*) FROM user_permissions p JOIN permission_hierarchy h "
        f"ON p.permission_id=h.id WHERE p.user_id={user['id']} AND h.name='TASKS_MARK_COMPLETED'"
    ) == [(1,)]


@pytest.mark.parametrize(
    "auth_class", ["ApiKeyAuthMiddleware", "SessionAuthMiddleware", "LdapAuthMiddleware"]
)
def test_native_configured_authentication_class_selects_credentials(
    api, execute_sql, runtime_configuration, auth_class
):
    runtime_configuration(f"Setting('AUTH_CLASS', 'Grocy\\\\Middleware\\\\{auth_class}');")
    key, cookie = uuid4().hex, uuid4().hex
    execute_sql(
        f"INSERT INTO api_keys(api_key,user_id,expires) VALUES ('{key}',1,'2999-12-31 23:59:59')"
    )
    execute_sql(
        "INSERT INTO sessions(session_key,user_id,expires) "
        f"VALUES ('{cookie}',1,'2999-12-31 23:59:59')"
    )
    try:
        by_key = api.get("/api/user", headers={"GROCY-API-KEY": key, "Cookie": ""})
        assert by_key.status_code == (401 if auth_class == "SessionAuthMiddleware" else 200), (
            by_key.text
        )
        by_cookie = api.get(
            "/api/user", headers={"GROCY-API-KEY": "", "Cookie": "grocy_session=" + cookie}
        )
        assert by_cookie.status_code == (401 if auth_class == "ApiKeyAuthMiddleware" else 200), (
            by_cookie.text
        )
    finally:
        execute_sql(f"DELETE FROM api_keys WHERE api_key='{key}'")
        execute_sql(f"DELETE FROM sessions WHERE session_key='{cookie}'")
