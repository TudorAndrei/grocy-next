"""The native login page has public URL and locale presentation, even with credentials."""

import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


@pytest.mark.parametrize(
    "prefix,base_url,rewriting,headers,canonical",
    [
        ("", "/", False, {}, "http://testserver"),
        # BASE_PATH selects the application; UrlManager does not add it to host URLs.
        ("/house.hold", "/", False, {}, "http://testserver"),
        ("/house.hold", "/house.hold", False, {}, "/house.hold"),
        (
            "/house.hold",
            "https://canonical.invalid/custom/",
            True,
            {},
            "https://canonical.invalid/custom/index.php",
        ),
        ("", "http://canonical.invalid/base/", False, {}, "http://canonical.invalid/base"),
        (
            "",
            "/",
            True,
            {"Host": "home.invalid", "X-Forwarded-Proto": "http, https"},
            "https://home.invalid/index.php",
        ),
    ],
)
def test_login_context_is_anonymous_with_canonical_targets_and_cookie_presence(
    client, api_headers, monkeypatch, prefix, base_url, rewriting, headers, canonical
):
    monkeypatch.setattr(get_settings(), "base_path", prefix)
    monkeypatch.setattr(get_settings(), "base_url", base_url)
    monkeypatch.setattr(get_settings(), "disable_url_rewriting", rewriting)
    path = prefix + "/api/v2/system/login-context?login_url=https://ignored.invalid/"
    expected = {
        "login_url": canonical + "/login",
        "logout_url": canonical + "/logout",
        "browser_session_supplied": False,
    }
    anonymous = client.get(path, headers=headers)
    assert anonymous.status_code == 200, anonymous.text
    assert anonymous.json() == expected
    authenticated = client.get(path, headers={**api_headers, **headers})
    assert authenticated.status_code == 200, authenticated.text
    assert authenticated.json() == expected


def test_public_login_catalog_ignores_credentials_and_imported_negative_user_preferences(
    client, api_headers, monkeypatch
):
    async def imported_user():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "INSERT INTO users(id,username,password) VALUES (-1,'Imported locale owner','')"
                )
            )
            await session.execute(
                text("INSERT INTO user_settings(user_id,key,value) VALUES (-1,'locale','he_IL')")
            )
            await session.commit()

    client.portal.call(imported_user)
    client.put(
        "/api/user/settings/locale", headers=api_headers, json={"value": "de"}
    ).raise_for_status()
    key_response = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": -1})
    key_response.raise_for_status()
    imported_headers = {"GROCY-API-KEY": key_response.json()["api_key"]}
    monkeypatch.setattr(get_settings(), "default_locale", "en")
    for credentials in [{}, api_headers, imported_headers]:
        catalog = client.get(
            "/api/v2/localization", headers={**credentials, "Accept-Language": "fr"}
        )
        assert catalog.status_code == 200, catalog.text
        assert catalog.json()["locale"] == "fr"
        assert catalog.json()["direction"] == "ltr"
        fallback = client.get("/api/v2/localization", headers=credentials)
        assert fallback.status_code == 200 and fallback.json()["locale"] == "en"
    # Real authenticated integer IDs, including -1, must keep their own preferences.
    assert client.get("/api/system/config", headers=api_headers).json()["LOCALE"] == "de"
    assert client.get("/api/system/config", headers=imported_headers).json()["LOCALE"] == "he_IL"
