from grocy.core.config import get_settings


def test_ldap_login_requires_a_trusted_directory_certificate(
    client, monkeypatch, ldap_encrypted_directory
):
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_mode", "ldap")
    for name, value in ldap_encrypted_directory.items():
        monkeypatch.setattr(settings, name.lower(), value)
    credentials = {"username": "alice", "password": "correct horse"}
    trusted = client.post("/api/v2/login", json=credentials)
    assert trusted.status_code == 200, trusted.text
    assert "grocy_session" in trusted.cookies
    assert client.get("/api/user").json()[0]["username"] == "alice"

    monkeypatch.setattr(settings, "ldap_ca_certs_file", None)
    untrusted = client.post("/api/v2/login", json=credentials)
    assert untrusted.status_code == 401, untrusted.text
    assert "grocy_session" not in untrusted.cookies
