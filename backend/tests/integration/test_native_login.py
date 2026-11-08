"""Native form/session wire behavior, independent of the modern JSON key-login API."""

import re
from datetime import datetime, timedelta
from http.cookies import SimpleCookie

import bcrypt
import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.core.time import server_timezone
from grocy.db.session import get_session_factory

PASSWORD = "fixture password"
# Disposable hashes accepted by the pinned PHP password_verify, generated in /tmp.
IMPORTED_HASHES = [
    "$1$fixtures$8LNDZN2VcQaaIqIzR7sYa0",
    "$5$fixtures$NGoQVu6suDL69SQep.VgeYaNYnWmB57pbhApS3ItAs.",
    "$6$fixtures$UmWQbGKE9LmXmuu/RZ3yR7kD3yxGSDJxYempTOoJCL/q5sFlvKIgg7p52XwDCgCyAb.c5aU1SSL/Ekgb8oKq20",
    "abCazIHWzjHiA",
    "_J9..CCCCSC34B1gJiJg",
    "$argon2i$v=19$m=1024,t=2,p=1$Y3ZYRmo1Z2JhblE4MVduMg$vwnZegy8OZufsE65Ki2VrNu3NPlP3mf5whIPc0LGNIg",
    "$argon2id$v=19$m=1024,t=2,p=1$RFQzV2NESTczYzdGRlZBTg$jDdz+H+Oqr15y1xGzzaBidUclp0qwFS2hGgISkBKUtA",
]


def rows(client, statement, **parameters):
    async def read():
        async with get_session_factory()() as session:
            result = await session.execute(text(statement), parameters)
            return [dict(row) for row in result.mappings()]

    return client.portal.call(read)


def account(client, username, password=PASSWORD, stored=None, cost=4):
    hashed = stored or bcrypt.hashpw(
        password.encode()[:72], bcrypt.gensalt(rounds=cost)
    ).decode().replace("$2b$", "$2y$")

    async def insert():
        async with get_session_factory()() as session:
            identity = await session.scalar(
                text("INSERT INTO users(username,password) VALUES (:name,:hash) RETURNING id"),
                {"name": username, "hash": hashed},
            )
            await session.commit()
            return identity

    return client.portal.call(insert)


def post_form(client, body, path="/login"):
    return client.post(
        path,
        content=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        follow_redirects=False,
    )


@pytest.fixture
def identities(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_mode", "default")
    return {
        "owner": account(client, "native-owner"),
        "spaced": account(client, " native-owner "),
        "empty": account(client, "native-empty", password=""),
    }


def test_native_login_creates_only_session_rehashes_and_authenticates_cookie(client, identities):
    for headers, supplied in [
        ([], False),
        ([("Cookie", "unrelated=value")], False),
        ([("Cookie", "grocy_session=ordinary")], True),
        ([("Cookie", "grocy_session=")], True),
        ([("Cookie", "grocy_session[]=array")], True),
        ([("Cookie", "unrelated=value"), ("Cookie", "grocy_session=stale")], True),
    ]:
        public = client.get("/api/v2/system/login-context", headers=headers)
        assert public.status_code == 200, public.text
        assert public.json() == {
            "login_url": "http://testserver/login",
            "logout_url": "http://testserver/logout",
            "browser_session_supplied": supplied,
        }

    before = rows(client, "SELECT id,key_type,user_id FROM api_keys")
    started = datetime.now(server_timezone()).replace(microsecond=0)
    response = post_form(
        client,
        b"username=native-owner&password=fixture+password",
        "/login?returnto=https://outside.invalid/",
    )
    assert response.status_code == 302, response.text
    assert response.headers["location"] == "http://testserver/"
    assert response.content == b""
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["access-control-allow-methods"] == "GET, POST, PUT, DELETE, OPTIONS"
    cookie = SimpleCookie(response.headers["set-cookie"])["grocy_session"]
    assert re.fullmatch(r"[a-zA-Z0-9]{50}", cookie.value)
    assert cookie["expires"] == "Tue, 19 Jan 2038 03:14:07 GMT"
    assert all(not cookie[key] for key in ["path", "domain", "secure", "httponly", "samesite"])
    assert int(cookie["max-age"]) > 30 * 86400
    saved = rows(client, "SELECT user_id,session_key,expires FROM sessions")
    assert len(saved) == 1
    assert saved[0]["user_id"] == identities["owner"]
    assert saved[0]["session_key"] == cookie.value
    expires = datetime.fromisoformat(saved[0]["expires"]).replace(tzinfo=server_timezone())
    assert (
        started + timedelta(days=30)
        <= expires
        <= datetime.now(server_timezone()) + timedelta(days=30)
    )
    assert client.get("/api/user").json()[0]["id"] == identities["owner"]
    assert rows(client, "SELECT id,key_type,user_id FROM api_keys") == before
    hashed = rows(client, "SELECT password FROM users WHERE id=:id", id=identities["owner"])[0][
        "password"
    ]
    assert hashed.startswith("$2y$12$")
    assert bcrypt.checkpw(PASSWORD.encode(), hashed.encode())
    assert client.get("/api/v2/system/login-context").json()["browser_session_supplied"] is True
    logout = client.get("/logout", follow_redirects=False)
    assert logout.status_code == 302 and logout.headers["location"] == "http://testserver/"
    assert "set-cookie" not in logout.headers
    assert client.cookies.get("grocy_session") == cookie.value
    assert rows(client, "SELECT id FROM sessions") == []
    assert client.get("/api/user").status_code == 401
    public = client.get("/api/v2/system/login-context")
    assert public.status_code == 200
    assert public.json()["browser_session_supplied"] is True
    explicit = client.get("/api/user", headers={"GROCY-API-KEY": "dev-key"})
    assert explicit.status_code == 200 and explicit.json()[0]["id"] == 1
    assert rows(client, "SELECT id,key_type,user_id FROM api_keys") == before


@pytest.mark.parametrize("stay,permanent", [("on", True), ("true", False), ("ON", False)])
def test_native_remember_me_changes_database_expiry_not_cookie_expiry(
    client, identities, stay, permanent
):
    response = post_form(
        client, f"username=native-owner&password=fixture+password&stay_logged_in={stay}".encode()
    )
    assert response.status_code == 302, response.text
    expiry = rows(client, "SELECT expires FROM sessions")[0]["expires"]
    if permanent:
        assert expiry == datetime.fromtimestamp(2147483647, server_timezone()).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
    else:
        assert (
            abs(
                (
                    datetime.fromisoformat(expiry).replace(tzinfo=server_timezone())
                    - datetime.now(server_timezone())
                    - timedelta(days=30)
                ).total_seconds()
            )
            < 3
        )
    assert (
        SimpleCookie(response.headers["set-cookie"])["grocy_session"]["expires"]
        == "Tue, 19 Jan 2038 03:14:07 GMT"
    )


@pytest.mark.parametrize(
    "body,target,status",
    [
        (b"username=native-owner", None, 302),
        (b"username=native-owner&password=wrong", None, 302),
        (b"username=native-empty&password=", "empty", 302),
        (b"username=+native-owner+&password=fixture+password", "spaced", 302),
        (b"username=absent&username=native-owner&password=fixture+password", "owner", 302),
        (b"username=native-owner&username=absent&password=fixture+password", None, 302),
        (b"username[]=native-owner&password=fixture+password", "owner", 302),
        (b"username=native-owner%00ignored&password=fixture+password", "owner", 302),
        (b"username%00suffix=native-owner&password=fixture+password", "owner", 302),
        (b"%00username=native-owner&password=fixture+password", None, 302),
        (b"username[key]=native-owner&password=fixture+password", None, 302),
        (b"username[]=absent&username[]=native-owner&password=fixture+password", "owner", 302),
        (b"username=native-owner&password[]=fixture+password", None, 500),
        (b"username=absent&password[]=fixture+password", None, 302),
    ],
)
def test_native_form_credentials_keep_php_duplicates_arrays_and_exact_names(
    client, identities, body, target, status
):
    response = post_form(client, body)
    assert response.status_code == status, response.text
    saved = rows(client, "SELECT user_id FROM sessions")
    assert saved == ([{"user_id": identities[target]}] if target else [])
    if status == 500:
        assert "password_verify()" in response.text
        assert response.headers["content-type"].startswith("text/html")
    else:
        assert response.headers["location"] == "http://testserver/" + (
            "" if target else "login?invalid=true"
        )
    assert bool(response.cookies.get("grocy_session")) is bool(target)


def test_native_multipart_registers_form_fields_and_ignores_uploaded_files(client, identities):
    response = client.post(
        "/login",
        files=[
            ("username", (None, "absent")),
            ("username", (None, "native-owner")),
            ("password", (None, PASSWORD)),
            ("stay_logged_in", (None, "on")),
            ("attachment", ("fixture.txt", b"ignored upload")),
        ],
        follow_redirects=False,
    )
    assert response.status_code == 302, response.text
    assert response.headers["location"] == "http://testserver/"
    assert rows(client, "SELECT user_id,expires FROM sessions") == [
        {
            "user_id": identities["owner"],
            "expires": datetime.fromtimestamp(2147483647, server_timezone()).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
        }
    ]


@pytest.mark.parametrize(
    "media,status",
    [("Application/X-Www-Form-Urlencoded", 500), ("application/x-www-form-urlencoded ", 302)],
)
def test_native_media_type_follows_slim_header_normalization(client, identities, media, status):
    response = client.post(
        "/login",
        content=b"username=native-owner&password=fixture+password",
        headers={"Content-Type": media},
        follow_redirects=False,
    )
    assert response.status_code == status, response.text
    assert bool(response.cookies.get("grocy_session")) is (status == 302)


@pytest.mark.parametrize("multipart", [False, True])
def test_native_form_sapi_variable_limits_and_nesting_preserve_failure_behavior(
    client, identities, multipart
):
    # Pinned PHP SAPI registers one extra URL-encoded pair; multipart stops at 1000.
    maximum = 1000 if multipart else 1001
    for count, valid in [(maximum, True), (maximum + 1, False)]:
        fields = [("filler", "1")] * (count - 2) + [
            ("username", "native-owner"),
            ("password", PASSWORD),
        ]
        response = (
            client.post(
                "/login",
                files=[(key, (None, value)) for key, value in fields],
                follow_redirects=False,
            )
            if multipart
            else post_form(
                client,
                "&".join(f"{key}={value.replace(' ', '+')}" for key, value in fields).encode(),
            )
        )
        assert response.status_code == 302, response.text
        assert bool(response.cookies.get("grocy_session")) is valid
    for depth, status in [(64, 500), (65, 302)]:
        key = "password" + "[nested]" * depth
        response = (
            client.post(
                "/login",
                files=[
                    ("username", (None, "native-owner")),
                    ("password", (None, PASSWORD)),
                    (key, (None, "wrong")),
                ],
                follow_redirects=False,
            )
            if multipart
            else post_form(
                client,
                b"username=native-owner&password=fixture+password&" + key.encode() + b"=wrong",
            )
        )
        assert response.status_code == status, response.text
        assert not response.cookies.get("grocy_session")


@pytest.mark.parametrize("mode", ["session", "api-key", "reverse-proxy"])
def test_native_non_password_auth_classes_keep_not_implemented_error(
    client, identities, monkeypatch, mode
):
    monkeypatch.setattr(get_settings(), "auth_mode", mode)
    response = post_form(client, b"username=native-owner&password=fixture+password")
    assert response.status_code == 500, response.text
    assert response.headers["content-type"].startswith("text/html")
    assert "Not implemented" in response.text
    assert rows(client, "SELECT id FROM sessions") == []


def test_native_login_json_is_not_a_form_and_failure_preserves_existing_cookie(client, identities):
    original = post_form(client, b"username=native-owner&password=fixture+password").cookies[
        "grocy_session"
    ]
    before = rows(client, "SELECT id FROM sessions")
    response = client.post(
        "/login", json={"username": "native-owner", "password": PASSWORD}, follow_redirects=False
    )
    assert response.status_code == 500
    assert "ProcessLogin()" in response.text and "null given" in response.text
    assert response.headers["content-type"].startswith("text/html")
    assert "set-cookie" not in response.headers
    assert client.cookies["grocy_session"] == original
    assert rows(client, "SELECT id FROM sessions") == before
    failed = post_form(client, b"username=native-owner&password=wrong")
    assert failed.headers["location"] == "http://testserver/login?invalid=true"
    assert "set-cookie" not in failed.headers
    assert client.get("/api/user").json()[0]["id"] == identities["owner"]


@pytest.mark.parametrize(
    "stored",
    IMPORTED_HASHES,
    ids=["md5", "sha256", "sha512", "des", "extended-des", "argon2i", "argon2id"],
)
def test_native_imported_hash_families_verify_then_rehash_only_success(client, monkeypatch, stored):
    monkeypatch.setattr(get_settings(), "auth_mode", "default")
    identity = account(client, "native-import", stored=stored)
    rejected = post_form(client, b"username=native-import&password=wrong")
    assert rejected.status_code == 302 and rejected.headers["location"].endswith(
        "/login?invalid=true"
    )
    assert (
        rows(client, "SELECT password FROM users WHERE id=:id", id=identity)[0]["password"]
        == stored
    )
    accepted = post_form(client, b"username=native-import&password=fixture+password")
    assert accepted.status_code == 302 and accepted.headers["location"] == "http://testserver/"
    hashed = rows(client, "SELECT password FROM users WHERE id=:id", id=identity)[0]["password"]
    assert hashed.startswith("$2y$12$") and bcrypt.checkpw(PASSWORD.encode(), hashed.encode())


def test_native_bcrypt_truncation_and_rehash_error_keep_committed_session_cookie(
    client, identities
):
    long_user = account(client, "native-long", password="a" * 72, cost=12)
    accepted = post_form(client, b"username=native-long&password=" + b"a" * 80)
    assert accepted.status_code == 302, accepted.text
    assert client.get("/api/user").json()[0]["id"] == long_user
    client.cookies.clear()
    before = rows(client, "SELECT password FROM users WHERE id=:id", id=identities["owner"])[0][
        "password"
    ]
    partial = post_form(client, b"username=native-owner&password=fixture+password%00ignored")
    assert partial.status_code == 500, partial.text
    assert "must not contain any null bytes" in partial.text
    assert partial.cookies.get("grocy_session")
    assert client.get("/api/user").json()[0]["id"] == identities["owner"]
    assert (
        rows(client, "SELECT password FROM users WHERE id=:id", id=identities["owner"])[0][
            "password"
        ]
        == before
    )


def test_native_login_and_logout_use_canonical_prefixed_redirects_without_revoking_keys(
    client, identities, api_headers, monkeypatch
):
    monkeypatch.setattr(get_settings(), "base_path", "/pantry")
    monkeypatch.setattr(get_settings(), "base_url", "https://home.invalid/pantry")
    monkeypatch.setattr(get_settings(), "disable_url_rewriting", True)
    response = post_form(
        client, b"username=native-owner&password=fixture+password", "/pantry/login"
    )
    assert (
        response.status_code == 302
        and response.headers["location"] == "https://home.invalid/pantry/index.php/"
    )
    denied = post_form(client, b"username=absent&password=wrong", "/pantry/login")
    assert denied.headers["location"] == "https://home.invalid/pantry/index.php/login?invalid=true"
    before = rows(client, "SELECT id,key_type,user_id FROM api_keys")
    logout = client.get(
        "/pantry/logout?returnto=/tasks", headers=api_headers, follow_redirects=False
    )
    assert (
        logout.status_code == 302
        and logout.headers["location"] == "https://home.invalid/pantry/index.php/"
    )
    assert "set-cookie" not in logout.headers
    assert rows(client, "SELECT id FROM sessions") == []
    assert rows(client, "SELECT id,key_type,user_id FROM api_keys") == before
    assert client.cookies.get("grocy_session")
    assert client.get("/pantry/api/user", headers=api_headers).status_code == 200
    expired = client.get("/pantry/logout", follow_redirects=False)
    assert (
        expired.status_code == 302
        and expired.headers["location"] == "https://home.invalid/pantry/index.php/login"
    )


def test_native_ldap_form_login_creates_cookie_without_key_and_reuses_identity(
    client, monkeypatch, ldap_directory
):
    monkeypatch.setattr(get_settings(), "auth_mode", "ldap")
    for name, value in ldap_directory.items():
        monkeypatch.setattr(get_settings(), name.lower(), value)
    keys = rows(client, "SELECT id FROM api_keys")
    for _attempt in range(2):
        response = post_form(client, b"username=Alice&password=correct+horse&stay_logged_in=on")
        assert response.status_code == 302 and response.headers["location"] == "http://testserver/"
        assert response.cookies.get("grocy_session")
        assert client.get("/api/user").json()[0]["username"] == "alice"
    assert len(rows(client, "SELECT id FROM users WHERE username='alice'")) == 1
    assert rows(client, "SELECT id FROM api_keys") == keys
    assert all(
        row["expires"]
        == datetime.fromtimestamp(2147483647, server_timezone()).strftime("%Y-%m-%d %H:%M:%S")
        for row in rows(client, "SELECT expires FROM sessions")
    )
    failed = post_form(client, b"username=alice&password=wrong")
    assert failed.status_code == 302 and failed.headers["location"].endswith("/login?invalid=true")
    missing = post_form(client, b"username=absent&password[]=wrong")
    assert missing.status_code == 302 and missing.headers["location"].endswith(
        "/login?invalid=true"
    )
    invalid_type = post_form(client, b"username=alice&password[]=wrong")
    assert invalid_type.status_code == 500 and "ldap_bind()" in invalid_type.text
    assert invalid_type.headers["content-type"].startswith("text/html")


def test_native_auth_options_and_head_logout_preserve_cookie_and_key_contract(
    client, identities, api_headers
):
    for path in ["/login", "/logout"]:
        response = client.options(path)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "*"
        assert response.headers["access-control-allow-headers"] == "*"
    login = post_form(client, b"username=native-owner&password=fixture+password")
    assert login.status_code == 302
    response = client.head("/logout", headers=api_headers, follow_redirects=False)
    assert response.status_code == 302 and response.content == b""
    assert response.headers["location"] == "http://testserver/"
    assert "set-cookie" not in response.headers
    assert rows(client, "SELECT id FROM sessions") == []
    assert client.cookies.get("grocy_session")
    assert client.get("/api/user", headers=api_headers).status_code == 200
