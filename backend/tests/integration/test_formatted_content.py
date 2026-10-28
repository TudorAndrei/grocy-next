from html.parser import HTMLParser

import pytest


@pytest.mark.parametrize("entity,permission", [("recipes", 9), ("equipment", 13)])
def test_formatted_content_preserves_saved_values_and_enforces_domain_access(
    client, api_headers, monkeypatch, entity, permission
):
    from grocy.core.config import get_settings
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
            model = Recipe if entity == "recipes" else Equipment
            row = model(name="Imported description", description=description)
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
    response = client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    rendered_outputs = [response.json()["html"]]
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
