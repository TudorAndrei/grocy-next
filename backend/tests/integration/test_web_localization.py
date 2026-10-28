import pytest


def test_web_localization_is_available_before_login_and_uses_request_language(client):
    response = client.get("/api/v2/localization", headers={"Accept-Language": "de-DE,de;q=0.8"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["locale"] == "de"
    assert data["catalog"]["messages"][""]["Products"] == ["Produkte"]
    assert {"en", "de", "he_IL"}.issubset(data["languages"])
    assert "Accept-Language" in response.headers["vary"].split(", ")


@pytest.mark.parametrize("locale,direction", [("he_IL", "rtl"), ("tr", "ltr")])
def test_web_localization_uses_explicit_locale_and_legacy_direction(client, locale, direction):
    response = client.get(
        "/api/v2/localization", params={"locale": locale}, headers={"Accept-Language": "en"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["locale"] == locale
    assert response.json()["direction"] == direction


@pytest.mark.parametrize("locale", ["../en", "not-a-language"])
def test_web_localization_rejects_unknown_catalogs(client, locale):
    response = client.get("/api/v2/localization", params={"locale": locale})
    assert response.status_code == 404
