"""Visible front-controller URLs retain native wire semantics and encoded resource identity."""

import base64
from urllib.parse import quote

import httpx
import pytest

from grocy.core.config import get_settings


@pytest.mark.parametrize(
    "configured,web",
    [("", ""), ("/house.hold", "/house.hold"), ("/house.hold/index.php", "/house.hold")],
)
def test_front_controller_routes_native_auth_and_api_without_changing_v2_boundaries(
    client, api_headers, monkeypatch, configured, web
):
    client.post(
        "/api/users",
        headers=api_headers,
        json={"username": "Controller reader", "password": "fixture password"},
    ).raise_for_status()
    monkeypatch.setattr(get_settings(), "base_path", configured)
    monkeypatch.setattr(get_settings(), "base_url", "http://testserver" + web)
    monkeypatch.setattr(get_settings(), "disable_url_rewriting", True)
    wire = web + "/index.php"
    context = client.get(wire + "/api/v2/system/login-context")
    assert context.status_code == 200, context.text
    assert context.json() == {
        "login_url": "http://testserver" + wire + "/login",
        "logout_url": "http://testserver" + wire + "/logout",
        "browser_session_supplied": False,
    }
    login = client.post(
        context.json()["login_url"],
        data={"username": "Controller reader", "password": "fixture password"},
        follow_redirects=False,
    )
    assert login.status_code == 302, login.text
    assert login.headers["location"] == "http://testserver" + wire + "/"
    assert login.headers["access-control-allow-origin"] == "*"
    current = client.get(wire + "/api/user")
    assert current.status_code == 200 and current.json()[0]["username"] == "Controller reader"
    head = client.head(wire + "/api/user")
    assert head.status_code == 200 and head.content == b""
    assert head.headers["content-length"] == current.headers["content-length"]
    logout = client.get(context.json()["logout_url"], follow_redirects=False)
    assert logout.status_code == 302 and logout.headers["location"] == login.headers["location"]
    client.cookies.clear()
    denied = client.get(wire + "/api/user", follow_redirects=False)
    assert denied.status_code == 302 and denied.headers["location"] == context.json()["login_url"]
    modern_denied = client.get(wire + "/api/v2/api-keys")
    assert modern_denied.status_code == 401 and modern_denied.json()["error_code"] == "unauthorized"
    assert modern_denied.headers["cache-control"] == "no-store"
    modern_head = client.head(wire + "/api/v2/system/login-context")
    assert modern_head.status_code == 405
    modern = client.post(
        wire + "/api/v2/login",
        json={"username": "Controller reader", "password": "fixture password"},
    )
    assert modern.status_code == 200 and modern.json()["api_key"]
    preflight = client.options(wire + "/api/objects/products")
    assert preflight.status_code == 200 and preflight.content == b""
    assert preflight.headers["access-control-allow-origin"] == "*"
    bad_method = client.patch(wire + "/api/user", headers=api_headers)
    assert bad_method.status_code == 500 and bad_method.headers["content-type"].startswith(
        "text/html"
    )


@pytest.mark.parametrize(
    "configured,rewriting_disabled,addresses,rejected",
    [
        ("", False, [("", 405)], "/index.php"),
        ("", True, [("", 405), ("/index.php", 500)], None),
        ("/house.hold", False, [("/house.hold", 500)], "/house.hold/index.php"),
        (
            "/house.hold",
            True,
            [("/house.hold", 500), ("/house.hold/index.php", 500)],
            None,
        ),
        (
            "/house.hold/index.php",
            True,
            [("/house.hold/index.php", 500)],
            "/house.hold/index.php/index.php",
        ),
    ],
)
def test_native_trailing_slashes_are_method_errors_without_redirecting_out_of_the_mount(
    client, api_headers, monkeypatch, configured, rewriting_disabled, addresses, rejected
):
    settings = get_settings()
    monkeypatch.setattr(settings, "base_path", configured)
    monkeypatch.setattr(settings, "disable_url_rewriting", rewriting_disabled)
    message = "Method not allowed. Must be one of: OPTIONS"
    for address, status in addresses:
        for entity in ("chores", "batteries"):
            valid = client.get(address + f"/api/{entity}/1", headers=api_headers)
            assert valid.status_code == 200, valid.text
            assert valid.json()["chore" if entity == "chores" else "battery"]["id"] == 1
            for resource in (entity, entity + "/1"):
                path = address + f"/api/{resource}/"
                for method in ("GET", "POST"):
                    response = client.request(
                        method, path, headers=api_headers, follow_redirects=False
                    )
                    assert response.status_code == status, (method, path, response.text)
                    assert "location" not in response.headers
                    assert response.history == []
                    assert response.headers["access-control-allow-origin"] == "*"
                    if status == 405:
                        assert response.headers["content-type"].startswith("application/json")
                        assert response.json()["error_message"] == message
                        assert "error_code" not in response.json()
                    else:
                        # Source ExceptionController tests the full URI's /api/ prefix.
                        assert response.headers["content-type"].startswith("text/html")
                        assert message in response.text
                head = client.head(path, headers=api_headers, follow_redirects=False)
                assert head.status_code == status and head.content == b"", path
                assert "location" not in head.headers
                options = client.options(path, follow_redirects=False)
                assert options.status_code == 200 and options.content == b"", path
                assert "location" not in options.headers
                assert options.headers["access-control-allow-origin"] == "*"

        # The source OPTIONS catchall accepts slashes without a matching GET route.
        wildcard = client.options(address + "/api/no/such/route/", follow_redirects=False)
        assert wildcard.status_code == 200 and wildcard.content == b""
        assert "location" not in wildcard.headers
        # File names are native default segments; an extra slash never reaches storage.
        for method in ("GET", "HEAD", "PUT", "DELETE"):
            file_path = client.request(
                method,
                address + "/api/files/userfiles/not-a-file/",
                headers=api_headers,
                follow_redirects=False,
            )
            assert file_path.status_code == status, (method, address, file_path.text)
            assert "location" not in file_path.headers
            if method == "HEAD":
                assert file_path.content == b""
            elif status == 405:
                assert file_path.headers["content-type"].startswith("application/json")
                assert file_path.json()["error_message"] == message
            else:
                assert file_path.headers["content-type"].startswith("text/html")
                assert message in file_path.text
        file_options = client.options(
            address + "/api/files/userfiles/not-a-file/", follow_redirects=False
        )
        assert file_options.status_code == 200 and file_options.content == b""
        assert "location" not in file_options.headers
        modern = client.get(address + "/api/v2/system/login-context/", follow_redirects=False)
        assert modern.status_code == 307
        assert modern.headers["location"].endswith("/api/v2/system/login-context")
        health = client.get(address + "/api/health/", follow_redirects=False)
        assert health.status_code == 307
        assert health.headers["location"].endswith("/api/health")
    if rejected:
        unavailable = client.get(
            rejected + "/api/chores/", headers=api_headers, follow_redirects=False
        )
        assert unavailable.status_code == 404
        assert "location" not in unavailable.headers


def test_front_controller_keeps_encoded_file_bytes_and_public_document_mount(
    client, api_headers, monkeypatch, tmp_path
):
    settings = get_settings()
    monkeypatch.setattr(settings, "base_path", "/house.hold")
    monkeypatch.setattr(settings, "base_url", "http://testserver/house.hold")
    monkeypatch.setattr(settings, "disable_url_rewriting", True)
    monkeypatch.setattr(settings, "files_root", tmp_path)
    wire = "/house.hold/index.php"
    source = base64.b64encode(b"file.txt").decode()
    assert "=" in source
    encoded = quote(source, safe="")
    content = b"front-controller bytes\x00\xff"
    uploaded = client.put(
        wire + "/api/files/userfiles/" + encoded, headers=api_headers, content=content
    )
    assert uploaded.status_code == 204, uploaded.text
    for name in [encoded, encoded.replace("%3D", "%253D")]:
        response = client.get(wire + "/api/files/userfiles/" + name, headers=api_headers)
        assert response.status_code == 200 and response.content == content
    extra_encoded = client.get(
        wire + "/api/files/userfiles/" + encoded.replace("%3D", "%25253D"), headers=api_headers
    )
    assert extra_encoded.content != content

    def resource_request(method, address, body=None):
        # TestClient re-encodes decoded response headers as ASCII; retain their bytes.
        async def request():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=client.app),
                base_url=str(client.base_url),
                headers=api_headers,
            ) as direct:
                return await direct.request(method, address, content=body, follow_redirects=False)

        return client.portal.call(request)

    # A slash-bearing base64 token needs one decode for routing and one for arguments.
    resource = wire + "/api/files/userfiles/YcO%252FLnR4dA=="
    payload = b"double-encoded resource\x00\xff"
    upload = resource_request("PUT", resource, payload)
    assert upload.status_code == 204, upload.text
    physical = tmp_path / "userfiles" / "aÿ.txt"
    assert physical.read_bytes() == payload
    download = resource_request("GET", resource)
    assert download.status_code == 200 and download.content == payload
    resource_head = resource_request("HEAD", resource)
    assert resource_head.status_code == 200 and resource_head.content == b""
    for header in ("content-type", "content-disposition", "cache-control"):
        assert resource_head.headers[header] == download.headers[header]
    assert download.headers["content-disposition"] == 'inline; filename="aÿ.txt"'
    for invalid in ("YcO%2FLnR4dA==", "YcO/LnR4dA=="):
        for method in ("GET", "HEAD", "PUT", "DELETE"):
            response = resource_request(
                method,
                wire + "/api/files/userfiles/" + invalid,
                b"rejected bytes" if method == "PUT" else None,
            )
            assert response.status_code == 500, (method, invalid, response.text)
            assert "location" not in response.headers
            if method == "HEAD":
                assert response.content == b""
            else:
                assert response.headers["content-type"].startswith("text/html")
                assert "Method not allowed. Must be one of: OPTIONS" in response.text
            assert physical.read_bytes() == payload
        options = client.options(wire + "/api/files/userfiles/" + invalid, follow_redirects=False)
        assert options.status_code == 200 and options.content == b""
    missing = client.get(
        wire + "/api/files/userfiles/bWlzc2luZy50eHQ=",
        headers=api_headers,
        follow_redirects=False,
    )
    assert missing.status_code == 404 and "File not found" in missing.text
    assert missing.headers["content-type"].startswith("text/html")
    assert "location" not in missing.headers
    with monkeypatch.context() as root_mount:
        root_mount.setattr(settings, "base_path", "")
        root_missing = client.get(
            "/api/files/userfiles/bWlzc2luZy50eHQ=", headers=api_headers, follow_redirects=False
        )
    assert root_missing.status_code == 404
    assert root_missing.headers["content-type"].startswith("application/json")
    assert root_missing.json()["error_message"] == "File not found"
    assert "location" not in root_missing.headers
    for address in (
        wire + "/api/%66iles/userfiles/YcO%252FLnR4dA==",
        wire + "/%61pi/files/userfiles/YcO%252FLnR4dA==",
    ):
        static_read = resource_request("GET", address)
        assert static_read.status_code == 200 and static_read.content == payload, address
        static_head = resource_request("HEAD", address)
        assert static_head.status_code == 200 and static_head.content == b"", address
        assert static_head.headers["content-disposition"] == download.headers["content-disposition"]
    # Use a normal generated-file identifier for the native named-file link.
    source = base64.b64encode(b"saved.txt").decode()
    client.put(
        wire + "/api/files/userfiles/" + source, headers=api_headers, content=content
    ).raise_for_status()
    field = client.post(
        wire + "/api/objects/userfields",
        headers=api_headers,
        json={
            "entity": "shopping_list",
            "name": "attachment",
            "caption": "Attachment",
            "type": "file",
            "show_as_column_in_tables": 1,
        },
    )
    field.raise_for_status()
    item = client.post(
        wire + "/api/objects/shopping_list",
        headers=api_headers,
        json={"shopping_list_id": 1, "note": "Mount proof", "amount": 1},
    )
    item.raise_for_status()
    identity = int(item.json()["created_object_id"])
    value = source + "_" + base64.b64encode(b"Download.txt").decode()
    client.put(
        wire + f"/api/userfields/shopping_list/{identity}",
        headers=api_headers,
        json={"attachment": value},
    ).raise_for_status()
    document = client.get(wire + "/api/v2/shopping-lists/1/print", headers=api_headers)
    assert document.status_code == 200, document.text
    assert (
        f'href="http://testserver{wire}/files/userfiles/{quote(value, safe="")}"' in document.text
    )
    link = wire + "/files/userfiles/" + quote(value, safe="")
    downloaded = client.get(link, headers=api_headers)
    assert downloaded.content == content
    head = client.head(link, headers=api_headers)
    assert head.status_code == 200 and head.content == b""
    assert head.headers["content-type"] == downloaded.headers["content-type"]
    assert head.headers["content-disposition"] == downloaded.headers["content-disposition"]


def test_front_controller_normalization_is_single_leading_segment_and_literal_prefix(
    client, api_headers, monkeypatch
):
    created = client.post(
        "/api/objects/userentities",
        headers=api_headers,
        json={"name": "index.php", "caption": "Literal namespace"},
    )
    created.raise_for_status()
    monkeypatch.setattr(get_settings(), "base_path", "/house.hold")
    monkeypatch.setattr(get_settings(), "disable_url_rewriting", True)
    wire = "/house.hold/index.php"
    literal = client.get(wire + "/api/v2/custom-data/userobjects/index.php", headers=api_headers)
    assert literal.status_code == 200 and literal.json()["userentity"]["name"] == "index.php"
    for path, status in [
        ("/houseXhold/index.php/api/user", 404),
        ("/index.php/api/user", 404),
        (wire + "/index.php/api/user", 404),
        # Preserve the existing prefixed legacy-API error page/status.
        ("/house.hold/api/index.php/user", 500),
    ]:
        assert client.get(path, headers=api_headers).status_code == status, path
    monkeypatch.setattr(get_settings(), "disable_url_rewriting", False)
    assert client.get(wire + "/api/user", headers=api_headers).status_code == 404
    assert client.get("/house.hold/api/user", headers=api_headers).status_code == 200


@pytest.mark.parametrize("prefix", ["/house.v1+demo", "/höme.v1+demo"])
def test_front_controller_prefixes_preserve_unicode_and_percent_encoded_literal_identity(
    client, api_headers, monkeypatch, prefix
):
    monkeypatch.setattr(get_settings(), "base_path", prefix)
    monkeypatch.setattr(get_settings(), "disable_url_rewriting", True)
    for address in [prefix, quote(prefix, safe="/")]:
        response = client.get(address + "/index.php/api/user", headers=api_headers)
        assert response.status_code == 200, response.text
        assert response.json()[0]["id"] == 1
    assert (
        client.get(
            quote(prefix, safe="/") + "/index.php/index.php/api/user", headers=api_headers
        ).status_code
        == 404
    )
