import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from grocy.core.config import clear_settings_cache, get_settings
from grocy.db.session import get_session_factory, reset_engine
from grocy.main import create_app


@pytest.fixture
def reader(client, api_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    response = client.post(
        "/api/users",
        headers=api_headers,
        json={"username": "Zulu", "first_name": "Context", "last_name": "Reader", "password": ""},
    )
    assert response.status_code == 204
    assert response.content == b""
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Zulu"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()
    return identity, {"GROCY-API-KEY": key["api_key"]}


def test_user_contexts_keep_safe_profiles_ordered_fields_values_and_permission_tree(
    client, api_headers, reader
):
    identity, _headers = reader
    for name, sort in [("zeta", 2), ("alpha", 1)]:
        response = client.post(
            "/api/objects/userfields",
            headers=api_headers,
            json={
                "entity": "users",
                "name": name,
                "caption": name,
                "type": "text-single-line",
                "sort_number": sort,
            },
        )
        response.raise_for_status()
    client.put(
        f"/api/userfields/users/{identity}", headers=api_headers, json={"alpha": "Saved profile"}
    ).raise_for_status()
    client.put(
        f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": [7]}
    ).raise_for_status()
    overview = client.get("/api/v2/users/overview", headers=api_headers)
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert [row["username"] for row in body["users"]] == ["Zulu", "admin"]
    profile = body["users"][0]
    assert profile["display_name"] == "Context Reader"
    assert profile["picture_file_name"] is None
    assert "password" not in profile
    assert [field["name"] for field in body["fields"]] == ["alpha", "zeta"]
    assert body["values"] == [
        {"object_id": str(identity), "name": "alpha", "value": "Saved profile"}
    ]
    assert body["current_user_id"] == 1
    assert body["show_permissions"] is True
    selected = client.get(f"/api/v2/users/{identity}/form-context", headers=api_headers).json()
    assert selected["user"] == profile
    assert selected["values"] == {"alpha": "Saved profile", "zeta": None}
    assert selected["fields"] == body["fields"]
    assert selected["password_controls"] is True
    assert selected["hidden_password"] is False
    assert selected["externally_managed_authentication"] is False
    new = client.get("/api/v2/users/new/form-context", headers=api_headers).json()
    assert new["user"] is None
    assert new["values"] == {}
    assert new["fields"] == body["fields"]
    tree = client.get(f"/api/v2/users/{identity}/permissions-context", headers=api_headers).json()
    assert tree["user"] == profile
    permissions = {row["permission_name"]: row for row in tree["permissions"]}
    assert len(permissions) == 30
    assert permissions["STOCK_PURCHASE"]["parent"] == 7
    assert permissions["STOCK_PURCHASE"]["has_permission"] == 1
    assert permissions["ADMIN"]["has_permission"] == 0
    assert permissions["ADMIN"]["parent"] is None
    for suffix in ["form-context", "permissions-context"]:
        assert (
            client.get(f"/api/v2/users/2147483647/{suffix}", headers=api_headers).status_code == 404
        )
        assert (
            client.get(f"/api/v2/users/not-a-user/{suffix}", headers=api_headers).status_code == 404
        )


def test_user_context_grants_follow_native_self_create_and_read_boundaries(
    client, api_headers, reader
):
    identity, headers = reader
    overview = "/api/v2/users/overview"
    own = f"/api/v2/users/{identity}/form-context"
    other = "/api/v2/users/1/form-context"
    create = "/api/v2/users/new/form-context"
    permissions = f"/api/v2/users/{identity}/permissions-context"
    paths = [overview, own, other, create, permissions]
    for path in paths:
        assert client.get(path).status_code == 401
        assert client.get(path, headers=headers).status_code == 403
    for grant, expected in [
        (5, [200, 403, 403, 403, 200]),
        (6, [403, 200, 403, 403, 403]),
        (4, [200, 403, 200, 403, 200]),
        (3, [200, 403, 200, 200, 200]),
    ]:
        client.put(
            f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": [grant]}
        ).raise_for_status()
        assert [client.get(path, headers=headers).status_code for path in paths] == expected
        for raw_id in [f"{identity}e0", f"0{identity}"]:
            selected = client.get(f"/api/v2/users/{raw_id}/form-context", headers=headers)
            assert selected.status_code == expected[1]
            if selected.status_code == 200:
                assert selected.json()["user"]["id"] == identity
            selected_permissions = client.get(
                f"/api/v2/users/{raw_id}/permissions-context", headers=headers
            )
            assert selected_permissions.status_code == expected[4]
            if selected_permissions.status_code == 200:
                assert selected_permissions.json()["user"]["id"] == identity
        assert (
            client.get("/api/v2/users/1e0/form-context", headers=headers).status_code == expected[2]
        )
    assert (
        client.put(
            f"/api/users/{identity}/permissions", headers=headers, json={"permissions": [1]}
        ).status_code
        == 403
    )


def test_selected_user_fields_use_canonical_text_identity_while_overview_retains_loose_aliases(
    client, api_headers, reader
):
    identity, _headers = reader
    definitions = [
        ("department", "text-single-line", "Configured default"),
        ("missing", "text-single-line", "Do not apply on edit"),
        ("started", "date", "now"),
        ("legacy_empty", "text-single-line", None),
        ("1", "text-single-line", None),
        ("01", "text-single-line", None),
    ]
    field_ids = {}
    for name, kind, default in definitions:
        response = client.post(
            "/api/objects/userfields",
            headers=api_headers,
            json={
                "entity": "users",
                "name": name,
                "caption": name,
                "type": kind,
                "default_value": default,
            },
        )
        response.raise_for_status()
        field_ids[name] = int(response.json()["created_object_id"])

    async def import_values():
        async with get_session_factory()() as session:
            for raw, value in [
                (f"0{identity}", "Overview alias before canonical"),
                (f"{identity}e0", "Scientific alias"),
                (f"{identity}.0", "Decimal alias"),
                (str(identity), "Canonical department"),
            ]:
                await session.execute(
                    text(
                        "INSERT INTO userfield_values(field_id,object_id,value) "
                        "VALUES(:field,:object,:value)"
                    ),
                    {"field": field_ids["department"], "object": raw, "value": value},
                )
            for name, value in [("1", "Later numeric field"), ("01", "First numeric field")]:
                await session.execute(
                    text(
                        "INSERT INTO userfield_values(field_id,object_id,value) "
                        "VALUES(:field,:object,:value)"
                    ),
                    {"field": field_ids[name], "object": str(identity), "value": value},
                )
            # Imported empty TEXT predating native cleanup is exposed by PDO as null.
            # The actual value column is NOT NULL; restore the trigger before any API read.
            trigger = await session.scalar(
                text(
                    "SELECT sql FROM sqlite_master WHERE type='trigger' "
                    "AND name='prevent_empty_userfields_INS'"
                )
            )
            assert trigger is not None
            await session.execute(text("DROP TRIGGER prevent_empty_userfields_INS"))
            await session.execute(
                text(
                    "INSERT INTO userfield_values(field_id,object_id,value) "
                    "VALUES(:field,:object,'')"
                ),
                {"field": field_ids["legacy_empty"], "object": str(identity)},
            )
            await session.execute(text(trigger))
            await session.commit()

    assert client.portal is not None
    client.portal.call(import_values)
    overview = client.get("/api/v2/users/overview", headers=api_headers)
    overview.raise_for_status()
    aliases = [row for row in overview.json()["values"] if row["name"] == "department"]
    assert aliases[0] == {
        "object_id": f"0{identity}",
        "name": "department",
        "value": "Overview alias before canonical",
    }
    assert len(aliases) == 4
    expected = {
        "department": "Canonical department",
        "missing": None,
        "started": None,
        "legacy_empty": None,
        "1": "First numeric field",
        "01": "First numeric field",
    }
    native = client.get(f"/api/userfields/users/{identity}", headers=api_headers)
    assert native.json() == expected
    for raw in [str(identity), f"0{identity}", f"{identity}e0"]:
        response = client.get(f"/api/v2/users/{raw}/form-context", headers=api_headers)
        response.raise_for_status()
        assert response.json()["user"]["id"] == identity
        assert response.json()["values"] == expected
    assert client.get("/api/v2/users/new/form-context", headers=api_headers).json()["values"] == {}


@pytest.mark.parametrize(
    ("app_mode", "managed"),
    [("production", True), ("dev", False), ("demo", False), ("prerelease", False)],
)
def test_user_context_authentication_flags_match_native_password_branches(
    api_headers, monkeypatch, app_mode, managed
):
    monkeypatch.setenv("GROCY_MODE", app_mode)
    clear_settings_cache()
    reset_engine()

    with TestClient(create_app()) as client:
        for auth_mode, disabled, external, hidden in [
            ("default", False, False, False),
            ("ldap", False, managed, False),
            ("reverse-proxy", False, managed, False),
            ("default", True, False, True),
            ("default", "false", False, True),
            ("ldap", True, False, True),
            ("reverse-proxy", "false", False, True),
        ]:
            monkeypatch.setattr(get_settings(), "auth_mode", auth_mode)
            monkeypatch.setattr(get_settings(), "disable_auth", disabled)
            response = client.get("/api/v2/users/1/form-context", headers=api_headers)
            assert response.status_code == 200, response.text
            context = response.json()
            assert context["current_user_id"] == context["user"]["id"] == 1
            assert context["externally_managed_authentication"] is external
            assert context["hidden_password"] is hidden
            assert context["password_controls"] is (not external and not hidden)
            overview = client.get("/api/v2/users/overview", headers=api_headers).json()
            assert overview["externally_managed_authentication"] is external
            assert overview["show_permissions"] is (not hidden)

        assert client.get("/api/v2/user/permissions", headers=api_headers).json()["ADMIN"] is True


def test_native_key_context_owns_creation_raw_queries_and_preserves_admin_api_grant(
    client, api_headers, reader
):
    identity, headers = reader
    listing = "/api/v2/access/api-keys-context"
    creation = "/api/v2/access/api-keys/new"
    assert client.get(listing).status_code == 401
    assert client.get(creation).status_code == 401
    response = client.get(
        creation + "?description=discarded&description=Mobile%20app", headers=headers
    )
    assert response.status_code == 200, response.text
    created_id = response.json()["id"]
    own = client.get(listing + f"?key=discarded&key=%2B{created_id}", headers=headers).json()
    assert own["selected_key_id"] == f"+{created_id}"
    assert all(row["user_id"] == identity for row in own["keys"])
    created = next(row for row in own["keys"] if row["id"] == created_id)
    assert re.fullmatch(r"[0-9a-zA-Z]{50}", created["api_key"])
    assert created["key_type"] == "default"
    assert created["expires"] == "2999-12-31 23:59:59"
    assert created["description"] == "Mobile app"
    assert created["last_used"] is None
    assert all("password" not in row for row in own["users"])
    assert {row["id"] for row in own["users"]} == {1, identity}
    # The new native key is a usable credential, not just a displayed random string.
    assert (
        client.get("/api/user", headers={"GROCY-API-KEY": created["api_key"]}).json()[0]["id"]
        == identity
    )
    for raw in ["0", "01", "1e1", "1.0", "[]", "1&key[]=2"]:
        assert client.get(listing + "?key=" + raw, headers=headers).json()["selected_key_id"] == -1
    failed = client.get(creation + "?description[]=invalid", headers=headers)
    assert failed.status_code == 500
    assert "ApiKeyService::CreateApiKey()" in failed.text
    assert len(client.get(listing, headers=headers).json()["keys"]) == len(own["keys"])
    admin = client.get(listing, headers=api_headers).json()
    assert {row["user_id"] for row in admin["keys"]} == {1, identity}
    assert client.get("/api/v2/api-keys", headers=headers).status_code == 403
    assert client.post("/api/v2/api-keys", headers=headers, json={"user_id": 1}).status_code == 403
    assert client.post("/api/objects/api_keys", headers=headers, json={}).status_code == 403


def test_native_key_deletion_has_no_owner_or_live_key_guard_and_other_writes_keep_native_guards(
    client, api_headers, reader
):
    identity, headers = reader
    key_path = "/api/v2/api-keys"
    own_key = client.post(key_path, headers=api_headers, json={"user_id": identity}).json()
    other_key = client.post(key_path, headers=api_headers, json={"user_id": 1}).json()
    for key in [own_key, other_key]:
        path = f"/api/objects/api_keys/{key['id']}"
        assert client.delete(path).status_code == 401
        deleted = client.delete(path, headers=headers)
        assert deleted.status_code == 204, deleted.text
        assert key["id"] not in {
            row["id"] for row in client.get(key_path, headers=api_headers).json()
        }
    missing = client.delete("/api/objects/api_keys/2147483647", headers=headers)
    assert missing.status_code == 400
    assert missing.json() == {"error_message": "Object not found"}

    for grant, status in [([], 403), ([30], 400), ([1], 400)]:
        client.put(
            f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": grant}
        ).raise_for_status()
        for method, path in [
            ("POST", "/api/objects/api_keys"),
            ("PUT", "/api/objects/api_keys/2147483647"),
        ]:
            response = client.request(method, path, headers=headers, json={"description": "Denied"})
            assert response.status_code == status, response.text
            if status == 400:
                assert response.json() == {
                    "error_message": "Entity does not exist or is not exposed"
                }
            else:
                assert "Permission missing: MASTER_DATA_EDIT" in response.text
        # NoListing remains independent of both the master-data and administrator grants.
        for path in ["/api/objects/api_keys", "/api/objects/api_keys/2147483647"]:
            response = client.get(path, headers=headers)
            assert response.status_code == 400
            assert response.json() == {"error_message": "Entity does not exist or is not exposed"}

    live_admin = client.post(key_path, headers=api_headers, json={"user_id": 1}).json()
    live_admin_headers = {"GROCY-API-KEY": live_admin["api_key"]}
    modern = client.delete(f"{key_path}/{live_admin['id']}", headers=live_admin_headers)
    assert modern.status_code == 400
    assert "Cannot delete the API key used for this request" in modern.text
    assert (
        client.delete(
            f"/api/objects/api_keys/{live_admin['id']}", headers=live_admin_headers
        ).status_code
        == 204
    )
    assert client.get("/api/user", headers=live_admin_headers).status_code == 401

    client.put(
        f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": []}
    ).raise_for_status()
    live_key = next(
        row
        for row in client.get("/api/v2/access/api-keys-context", headers=headers).json()["keys"]
        if row["api_key"] == headers["GROCY-API-KEY"]
    )
    assert client.delete(f"{key_path}/{live_key['id']}", headers=headers).status_code == 403
    assert (
        client.delete(f"/api/objects/api_keys/{live_key['id']}", headers=headers).status_code == 204
    )
    assert client.get("/api/user", headers=headers).status_code == 401

    async def save_session():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "INSERT INTO sessions(session_key,user_id,expires) "
                    "VALUES('native-key-browser-session',:user,'2999-12-31 23:59:59')"
                ),
                {"user": identity},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(save_session)
    client.cookies.set("grocy_session", "native-key-browser-session")
    assert client.get("/api/user", headers=headers).json()[0]["id"] == identity
