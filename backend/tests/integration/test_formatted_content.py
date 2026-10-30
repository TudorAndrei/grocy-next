from html.parser import HTMLParser

import pytest


@pytest.mark.parametrize("entity,permission", [("products", 7), ("recipes", 9), ("equipment", 13)])
def test_formatted_content_preserves_saved_values_and_enforces_domain_access(
    client, api_headers, monkeypatch, entity, permission
):
    from grocy.core.config import get_settings
    from grocy.db.models.catalog import Product
    from grocy.db.models.equipment import Equipment
    from grocy.db.models.recipes import Recipe
    from grocy.db.session import get_session_factory

    description = (
        "<h2>Preparation</h2><ol><li><strong>Mix</strong> gently</li></ol>"
        "<table><tr><td>20 minutes</td></tr></table>"
        "<p>&lt;script&gt;literal text&lt;/script&gt;</p>"
        '<script>alert("active")</script><img src="photo.jpg" onerror="alert(1)">'
        '<a href="javascript:alert(1)" target="_blank">Link</a>'
        '<iframe src="https://example.com/video" sandbox="allow-same-origin"></iframe>'
    )

    async def save_imported_description():
        async with get_session_factory()() as session:
            model = (
                Product if entity == "products" else Recipe if entity == "recipes" else Equipment
            )
            values = (
                {"location_id": 1, "qu_id_stock": 1, "qu_id_purchase": 1}
                if entity == "products"
                else {}
            )
            row = model(name="Imported description", description=description, **values)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row.id

    portal = client.portal
    assert portal is not None
    identity = portal.call(save_imported_description)
    path = f"/api/v2/content/{entity}/{identity}"
    read_paths = [path]
    if entity == "recipes":
        read_paths.append(f"/api/v2/recipes/{identity}/view")
        read_paths.append("/api/v2/recipes/overview")
        read_paths.append(f"/api/v2/recipes/{identity}/grocycode")
    if entity == "products":
        read_paths.append(f"/api/v2/products/form-options?product_id={identity}")
        read_paths.append("/api/v2/stock/journal")
        read_paths.append("/api/v2/stock/journal/summary")
        read_paths.append("/api/v2/stock/entries")
        client.post(
            f"/api/stock/products/{identity}/add", headers=api_headers, json={"amount": 1}
        ).raise_for_status()
        entries = client.get(f"/api/stock/products/{identity}/entries", headers=api_headers).json()
        read_paths.append(f"/api/v2/stock/entries/{entries[0]['id']}/editor")
    read_paths.append(f"/api/v2/content/{entity}")
    for read_path in read_paths:
        assert client.get(read_path).status_code == 401

    # Give the reader this domain only. The extension must not require STOCK.
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    assert (
        client.post(
            "/api/users",
            headers=api_headers,
            json={"username": "Content reader", "password": "secret"},
        ).status_code
        == 204
    )
    user_id = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Content reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user_id}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    for read_path in read_paths:
        assert client.get(read_path, headers=headers).status_code == 403
    assert (
        client.put(
            f"/api/users/{user_id}/permissions",
            headers=api_headers,
            json={"permissions": [permission]},
        ).status_code
        == 204
    )
    if entity == "products":
        assert client.get(read_paths[1], headers=headers).status_code == 200
        assert client.get("/api/v2/stock/journal", headers=headers).status_code == 200
        assert client.get("/api/v2/stock/journal/summary", headers=headers).status_code == 200
        assert client.get(read_paths[-2], headers=headers).status_code == 200
    response = client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    rendered_outputs = [response.json()["html"]]
    batch = client.get(f"/api/v2/content/{entity}", headers=headers)
    assert batch.status_code == 200, batch.text
    rendered_outputs.append(next(row["html"] for row in batch.json() if row["id"] == identity))
    if entity == "recipes":
        view = client.get(read_paths[1], headers=headers)
        assert view.status_code == 200, view.text
        assert view.json()["cards"][0]["id"] == identity
        rendered_outputs.append(view.json()["cards"][0]["preparation_html"])
        overview = client.get(read_paths[2], headers=headers)
        assert overview.status_code == 200, overview.text
        assert identity in {row["id"] for row in overview.json()}
        code = client.get(read_paths[3], headers=headers)
        assert code.status_code == 200
        assert code.headers["Content-Type"] == "image/png"

    class Tags(HTMLParser):
        def __init__(self):
            super().__init__()
            self.nodes = []
            self.text = []

        def handle_starttag(self, tag, attrs):
            self.nodes.append((tag, dict(attrs)))

        def handle_data(self, data):
            self.text.append(data)

    for rendered in rendered_outputs:
        parsed = Tags()
        parsed.feed(rendered)
        assert {"h2", "ol", "li", "strong", "table", "td"} <= {tag for tag, _ in parsed.nodes}
        assert "<script>literal text</script>" in "".join(parsed.text)
        assert all(tag != "script" for tag, _ in parsed.nodes)
        assert all("onerror" not in attrs for _, attrs in parsed.nodes)
        link = next(attrs for tag, attrs in parsed.nodes if tag == "a")
        assert "href" not in link
        assert set(link["rel"].split()) == {"noopener", "noreferrer"}
        frame = next(attrs for tag, attrs in parsed.nodes if tag == "iframe")
        assert frame["src"] == "https://example.com/video"
        assert set(frame["sandbox"].split()) == {"allow-scripts", "allow-presentation"}
    saved = client.get(f"/api/objects/{entity}/{identity}", headers=api_headers)
    assert saved.json()["description"] == description
    assert client.get(f"/api/v2/content/{entity}/2147483647", headers=headers).status_code == 404


@pytest.mark.parametrize("entity,permission", [("products", 7), ("recipes", 9), ("equipment", 13)])
def test_description_editor_authorizes_the_domain_and_keeps_drafts_out_of_storage(
    client, api_headers, monkeypatch, entity, permission
):
    from editor_document import EditorDocument
    from grocy.core.config import get_settings

    path = f"/api/v2/content/{entity}/editor"
    imported = '</textarea></script><script id="imported">parent.document.body.remove()</script>'
    before = client.get(f"/api/objects/{entity}", headers=api_headers).json()
    assert client.post(path, json={"html": imported}).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users",
        headers=api_headers,
        json={"username": "Description writer", "password": "secret"},
    ).raise_for_status()
    user_id = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Description writer"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user_id}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    assert client.post(path, headers=headers, json={"html": imported}).status_code == 403
    client.put(
        f"/api/users/{user_id}/permissions", headers=api_headers, json={"permissions": [permission]}
    ).raise_for_status()
    client.put(
        "/api/user/settings/locale", headers=headers, json={"value": "de"}
    ).raise_for_status()
    response = client.post(
        path, headers=headers, json={"html": imported, "paste": entity == "products"}
    )
    assert response.status_code == 200, response.text
    document = EditorDocument(response.text)
    assert document.options == {
        "initial": imported,
        "locale": "de-DE",
        "label": "Beschreibung",
        "channel": "grocy-description",
        "sourceLabel": "Code view",
        **({"pasteInitial": True} if entity == "products" else {}),
    }
    assert len(document.scripts) == 6
    nonce = document.scripts[0]["nonce"]
    assert nonce and f"script-src 'nonce-{nonce}'" in document.policy
    assert all(attributes.get("nonce") == nonce for attributes in document.scripts)
    assert '<script id="imported">' not in response.text
    assert client.get(f"/api/objects/{entity}", headers=api_headers).json() == before
