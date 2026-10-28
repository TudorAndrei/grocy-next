from html import unescape
from html.parser import HTMLParser

import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


class ShoppingDocument(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cells = []
        self.headings = []
        self.amounts = []
        self.active = None
        self.in_amount = False

    def handle_starttag(self, tag, attrs):
        if tag in {"td", "th"}:
            self.active = self.cells if tag == "td" else self.headings
            self.active.append("")
        if tag == "br" and self.active is not None:
            self.active[-1] += "\n"
        if tag == "span" and dict(attrs).get("data-number") == "quantity":
            self.amounts.append("")
            self.in_amount = True

    def handle_endtag(self, tag):
        if tag in {"td", "th"}:
            self.active = None
        if tag == "span":
            self.in_amount = False

    def handle_data(self, data):
        if self.active is not None:
            self.active[-1] += data
        if self.in_amount:
            self.amounts[-1] += data


@pytest.mark.parametrize(
    "round_up,expected", [("0", ["1.25", "2.5", "1", "0.5"]), ("off", ["2", "3", "1", "1"])]
)
def test_shopping_paper_contains_all_items_notes_and_custom_fields(
    client, api_headers, round_up, expected
):
    async def seed():
        async with get_session_factory()() as session:
            statements = [
                "INSERT INTO quantity_units(id,name,name_plural) VALUES(991,'Packet','Packets')",
                "INSERT INTO product_groups(id,name) VALUES(991,'Fresh & green')",
                "INSERT INTO "
                "products(id,name,qu_id_stock,qu_id_purchase,location_id,product_group_id) "
                "VALUES(991,'Apple <red>',991,991,1,991)",
                "INSERT INTO products(id,name,qu_id_stock,qu_id_purchase,location_id) "
                "VALUES(992,'Zucchini',991,991,1)",
                "INSERT INTO shopping_lists(id,name,description) VALUES(991,'Weekend & "
                "friends','<p>Bring <strong>bags</strong> &amp; ice.</p>')",
                "INSERT INTO "
                "shopping_list(id,product_id,amount,note,qu_id,shopping_list_id) "
                "VALUES(991,991,2.5,'Ripe'||char(10)||'<strong>Keep cool</strong>',991,991)",
                "INSERT INTO shopping_list(id,product_id,amount,note,shopping_list_id) "
                "VALUES(992,NULL,1.25,'Bags & labels',991)",
                "INSERT INTO "
                "shopping_list(id,product_id,amount,note,qu_id,shopping_list_id,done) "
                "VALUES(993,991,1,'Done item',991,991,1)",
                "INSERT INTO "
                "shopping_list(id,product_id,amount,note,qu_id,shopping_list_id) "
                "VALUES(994,992,.5,'Small',991,991)",
            ]
            for sql in statements:
                await session.execute(text(sql))
            for identity, entity, name, caption, kind, value in [
                (991, "shopping_list", "priority", "Priority", "text", "Urgent <soon>"),
                (992, "products", "decimal", "Decimal", "number-decimal", "12.75"),
                (993, "products", "cost", "Cost", "number-currency", "9.25"),
                (994, "products", "organic", "Organic", "checkbox", "1"),
                (995, "product_groups", "aisle", "Aisle", "text", "First aisle"),
            ]:
                await session.execute(
                    text(
                        "INSERT INTO "
                        "userfields(id,entity,name,caption,type,show_as_column_in_tables,sort_number"
                        ") VALUES(:id,:entity,:name,:caption,:type,1,:id)"
                    ),
                    dict(id=identity, entity=entity, name=name, caption=caption, type=kind),
                )
                await session.execute(
                    text(
                        "INSERT INTO userfield_values(field_id,object_id,value) "
                        "VALUES(:field,'991',:value)"
                    ),
                    dict(field=identity, value=value),
                )
            await session.commit()

    assert client.portal is not None
    client.portal.call(seed)
    assert (
        client.put(
            "/api/user/settings/shopping_list_round_up",
            headers=api_headers,
            json={"value": round_up},
        ).status_code
        == 204
    )
    response = client.get(
        "/api/v2/shopping-lists/991/print?header=true&grouped=true&layout=table",
        headers=api_headers,
    )
    assert response.status_code == 200, response.text
    doc = ShoppingDocument()
    doc.feed(response.text)
    assert doc.headings == [
        "Product / Note",
        "Amount",
        "Product group",
        "Priority",
        "Decimal",
        "Cost",
        "Organic",
        "Aisle",
    ]
    assert doc.amounts == expected
    assert doc.cells[0] == "Bags & labels"
    assert doc.cells[3:8] == ["", "", "", "", ""]
    assert doc.cells[8] == "Apple <red>\nRipe\nKeep cool"
    assert doc.cells[11:16] == ["Urgent <soon>", "12.75", "9.25", "", "First aisle"]
    assert doc.cells[16] == "Apple <red>\nDone item"
    assert "<strong>Keep cool</strong>" in response.text
    assert '<i class="fa-check"></i>' in response.text
    assert '<h3 class="text-center">Weekend &amp; friends</h3>' in response.text
    assert "<strong>bags</strong>" in response.text
    assert "data:font/woff2;base64," in response.text
    assert "data:image/svg+xml;base64," in response.text
    plain = client.get(
        "/api/v2/shopping-lists/991/print?header=false&layout=list", headers=api_headers
    )
    assert plain.status_code == 200
    listing = ShoppingDocument()
    listing.feed(plain.text)
    assert listing.amounts == expected
    assert unescape(plain.text).count("Apple <red>") == 2


def test_shopping_paper_requires_shopping_permission(client, api_headers, monkeypatch):
    path = "/api/v2/shopping-lists/1/print"
    editor = "/api/v2/shopping-lists/1/notes/editor"
    assert client.get(path).status_code == 401
    assert client.get(editor).status_code == 401
    for read_path in (
        "/api/v2/shopping-lists",
        "/api/v2/shopping-lists/editor",
        "/api/v2/shopping-lists/items/editor",
    ):
        assert client.get(read_path).status_code == 401
    assert client.post(path, json={"html": "Notes", "visible": True}).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    assert (
        client.post(
            "/api/users",
            headers=api_headers,
            json={"username": "Paper reader", "password": "secret"},
        ).status_code
        == 204
    )
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Paper reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    assert client.get(path, headers=headers).status_code == 403
    assert client.get(editor, headers=headers).status_code == 403
    for read_path in (
        "/api/v2/shopping-lists",
        "/api/v2/shopping-lists/editor",
        "/api/v2/shopping-lists/items/editor",
    ):
        assert client.get(read_path, headers=headers).status_code == 403
    assert (
        client.post(path, headers=headers, json={"html": "Notes", "visible": True}).status_code
        == 403
    )
    assert (
        client.put(
            f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": [8]}
        ).status_code
        == 204
    )
    assert client.get(path, headers=headers).status_code == 200
    assert client.get(editor, headers=headers).status_code == 200
    for read_path in (
        "/api/v2/shopping-lists",
        "/api/v2/shopping-lists/editor",
        "/api/v2/shopping-lists/items/editor",
    ):
        assert client.get(read_path, headers=headers).status_code == 200
    assert (
        client.post(path, headers=headers, json={"html": "Notes", "visible": True}).status_code
        == 200
    )
    assert client.get("/api/v2/shopping-lists/999999/print", headers=headers).status_code == 404


@pytest.mark.parametrize(
    "initial,visible", [("<p>Saved notes</p>", True), ("", False), ("0", True)]
)
def test_shopping_paper_prints_current_notes_without_saving_them(
    client, api_headers, initial, visible
):
    path = "/api/objects/shopping_lists/1"
    assert client.put(path, headers=api_headers, json={"description": initial}).status_code == 204
    saved = client.get(path, headers=api_headers).json()["description"]
    assert (
        client.get("/api/v2/shopping-lists/1", headers=api_headers).json()["description"] == saved
    )
    response = client.post(
        "/api/v2/shopping-lists/1/print?header=false&layout=list",
        headers=api_headers,
        json={"html": "<p>Draft <strong>bags</strong></p>", "visible": visible},
    )
    assert response.status_code == 200, response.text
    assert ("<strong>bags</strong>" in response.text) == visible
    assert client.get(path, headers=api_headers).json()["description"] == saved
    default = client.get(
        "/api/v2/shopping-lists/1/print?header=false&layout=list", headers=api_headers
    )
    assert default.status_code == 200
    assert ("<h5>Notes</h5>" in default.text) == visible


def test_shopping_editor_keeps_imported_markup_in_data_and_authorizes_its_scripts(
    client, api_headers
):
    import json
    import re

    imported = '</textarea></script><script id="imported">parent.document.body.remove()</script>'

    async def seed():
        async with get_session_factory()() as session:
            await session.execute(
                text("UPDATE shopping_lists SET description=:html WHERE id=1"), {"html": imported}
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(seed)
    assert (
        client.put(
            "/api/user/settings/locale", headers=api_headers, json={"value": "de"}
        ).status_code
        == 204
    )
    response = client.get("/api/v2/shopping-lists/1/notes/editor", headers=api_headers)
    assert response.status_code == 200
    html = response.text
    setup = re.search(r"window.initializeShoppingNotes\((\{[^\n]+\})\);", html)
    assert setup is not None
    options = json.loads(setup[1])
    assert options == {
        "initial": imported,
        "locale": "de-DE",
        "notesLabel": "Notizen",
        "sourceLabel": "Code view",
    }
    policy = re.search(r"script-src &#39;nonce-([^&]+)&#39;", html)
    assert policy is not None
    nonce = policy[1]
    scripts = re.findall(r"<script([^>]*)>", html)
    assert len(scripts) == 5
    assert all(f'nonce="{nonce}"' in attributes for attributes in scripts)
    assert '<script id="imported">' not in html
    assert (
        client.get("/api/v2/shopping-lists/1", headers=api_headers).json()["description"]
        == imported
    )


def test_shopping_paper_rounds_stock_amount_before_display_conversion(client, api_headers):
    client.headers.update(api_headers)
    case = client.post("/api/objects/quantity_units", json={"name": "Case"}).json()[
        "created_object_id"
    ]
    assert (
        client.post(
            "/api/objects/quantity_unit_conversions",
            json={"product_id": 1, "from_qu_id": case, "to_qu_id": 1, "factor": 6},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/objects/shopping_list", json={"product_id": 1, "amount": 6.1, "qu_id": case}
        ).status_code
        == 200
    )
    for rounding, expected in [("0", 6.1 / 6), ("1", 7 / 6)]:
        assert (
            client.put(
                "/api/user/settings/shopping_list_round_up", json={"value": rounding}
            ).status_code
            == 204
        )
        response = client.get("/api/v2/shopping-lists/1/print")
        assert response.status_code == 200, response.text
        document = ShoppingDocument()
        document.feed(response.text)
        assert len(document.amounts) == 1
        assert float(document.amounts[0]) == pytest.approx(expected)
