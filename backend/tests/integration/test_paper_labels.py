import base64
import hashlib
import json
import re
from ctypes.util import find_library
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from PIL import Image
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory

NATIVE = json.loads(
    (Path(__file__).parents[1] / "fixtures/grocycodes/native-paper-labels.json").read_text()
)


class PaperLabel(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = ""
        self.title = ""
        self.spans = []
        self.image = ""
        self.css = ""

    def handle_starttag(self, tag, attrs):
        if tag in {"title", "span", "style"}:
            self.active = tag
        if tag == "span":
            self.spans.append("")
        if tag == "img":
            self.image = dict(attrs)["src"]

    def handle_endtag(self, tag):
        if tag in {"title", "span", "style"}:
            self.active = ""

    def handle_data(self, data):
        if self.active == "title":
            self.title += data
        elif self.active == "span":
            self.spans[-1] += data
        elif self.active == "style":
            self.css += data


@pytest.mark.parametrize(
    "case",
    NATIVE["cases"],
    ids=["matrix", "linear", "dates-off", "german", "empty-date", "missing-entry", "failed-image"],
)
def test_paper_label_matches_native_content_and_embedded_image(
    client, api_headers, monkeypatch, case
):
    settings = get_settings()
    monkeypatch.setattr(settings, "grocycode_type", case["kind"])
    monkeypatch.setattr(settings, "feature_flag_stock_best_before_date_tracking", case["tracking"])
    assert (
        client.put(
            "/api/user/settings/locale", headers=api_headers, json={"value": case["locale"]}
        ).status_code
        == 204
    )

    async def save_entry():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "INSERT INTO products (id,name,qu_id_stock,qu_id_purchase,location_id) "
                    "VALUES (991,:name,1,1,1)"
                ),
                {"name": NATIVE["source"]["name"]},
            )
            await session.execute(
                text(
                    "INSERT INTO stock (id,product_id,amount,best_before_date,purchased_date,"
                    "stock_id,location_id) VALUES (991,991,2,:due,'2026-10-28',:stock,1)"
                ),
                {"due": case["due"], "stock": case.get("stock_id", NATIVE["source"]["stock_id"])},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(save_entry)
    for path in [
        f"/stockentry/{case['entry']}/label",
        f"/api/v2/stock/entries/{case['entry']}/label",
    ]:
        response = client.get(path, headers=api_headers)
        assert response.status_code == 200, response.text
        assert response.headers["Content-Type"] == "text/html; charset=utf-8"
        label = PaperLabel()
        label.feed(response.text)
        assert label.title == case["title"]
        assert label.spans == case["spans"]
        styles = {
            selector: dict(
                tuple(value.strip() for value in part.split(":", 1))
                for part in body.split(";")
                if ":" in part
            )
            for selector, body in re.findall(r"(body|img|\.productname)\s*\{([^}]*)\}", label.css)
        }
        assert styles == NATIVE["source"]["styles"]
        assert "data:font/woff2;base64," in label.css
        if "png" in case:
            data = base64.b64decode(label.image.removeprefix("data:image/png;base64,"))
            image = Image.open(BytesIO(data))
            assert list(image.size) == case["size"]
            assert hashlib.sha256(image.convert("RGB").tobytes()).hexdigest() == case["pixels"]
            if find_library("gd") is not None:
                assert hashlib.sha256(data).hexdigest() == case["png"]
        else:
            assert urlsplit(label.image).path == case["image_path"]
            assert urlsplit(label.image).query == "size=100"
            if "image_error" in case:
                assert (
                    client.get(case["image_path"] + "?size=100", headers=api_headers).status_code
                    == case["image_error"]
                )


def test_paper_label_gui_login_and_head(client, api_headers):
    path = "/stockentry/99999/label"
    denied = client.get(path, follow_redirects=False)
    assert denied.status_code == 302
    assert urlsplit(denied.headers["Location"]).path == "/login"
    response = client.get(path, headers=api_headers)
    head = client.head(path, headers=api_headers)
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["Content-Length"] == response.headers["Content-Length"]
