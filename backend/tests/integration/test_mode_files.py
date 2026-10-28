"""Native mode storage paths and file lifecycle boundaries."""

import base64
import json
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from grocy.core.config import clear_settings_cache
from grocy.db.session import reset_engine
from grocy.main import create_app

CASES = json.loads(
    (Path(__file__).parents[1] / "fixtures/native-mode-file-paths.json").read_text()
)["cases"]


def configure(monkeypatch, tmp_path, mode, suffix=None):
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'production.db'}")
    monkeypatch.setenv("GROCY_DATAPATH", str(tmp_path / "data"))
    monkeypatch.setenv("GROCY_FILES_ROOT", str(tmp_path / "files"))
    monkeypatch.setenv("GROCY_DEFAULT_LOCALE", "de")
    monkeypatch.setenv("GROCY_MODE", mode)
    if suffix is None:
        monkeypatch.delenv("GROCY_DEMO_DB_SUFFIX", raising=False)
    else:
        monkeypatch.setenv("GROCY_DEMO_DB_SUFFIX", suffix)
    clear_settings_cache()
    reset_engine()


def image(color):
    output = BytesIO()
    Image.new("RGB", (40, 20), color).save(output, "PNG")
    return output.getvalue()


@pytest.mark.parametrize("case", CASES, ids=[f"{case['mode']}-{case['suffix']}" for case in CASES])
def test_file_writes_use_captured_native_mode_paths(tmp_path, monkeypatch, case):
    configure(monkeypatch, tmp_path, case["mode"], case["suffix"])
    token = base64.b64encode(b"manual.txt").decode()
    with TestClient(create_app(), headers={"GROCY-API-KEY": "dev-key"}) as api:
        response = api.put(f"/api/files/userfiles/{token}", content=b"Mode manual")
        assert response.status_code == 204, response.text
        assert api.get(f"/api/files/userfiles/{token}").content == b"Mode manual"
    expected = Path(str(tmp_path / "files") + "/" + case["path"])
    assert expected.read_bytes() == b"Mode manual"


def test_mode_image_cache_and_deletion_keep_production_files(tmp_path, monkeypatch):
    token = base64.b64encode(b"photo.png").decode()
    path = f"/api/files/userfiles/{token}"
    query = {"force_serve_as": "picture", "best_fit_width": 20}
    configure(monkeypatch, tmp_path, "production")
    with TestClient(create_app(), headers={"GROCY-API-KEY": "dev-key"}) as api:
        assert api.put(path, content=image("red")).status_code == 204
        original_cache = api.get(path, params=query).content
    configure(monkeypatch, tmp_path, "demo")
    with TestClient(create_app()) as api:
        assert api.get(path).status_code == 404
        assert api.put(path, content=image("blue")).status_code == 204
        resized = api.get(path, params=query)
        assert resized.status_code == 200, resized.text
        assert Image.open(BytesIO(resized.content)).getpixel((0, 0)) == (0, 0, 255)
        assert (
            tmp_path / "files/de/userfiles/photo__downscaledtoautox20.png"
        ).read_bytes() == resized.content
        named = token + "_" + base64.b64encode(b"Preview.png").decode()
        assert api.get(f"/files/userfiles/{named}").content == image("blue")
        assert api.get(f"/api/v2/files/userfiles/{token}").content == image("blue")
        assert api.delete(path).status_code == 204
        assert api.get(path).status_code == 404
    configure(monkeypatch, tmp_path, "production")
    with TestClient(create_app(), headers={"GROCY-API-KEY": "dev-key"}) as api:
        assert api.get(path).content == image("red")
        assert api.get(path, params=query).content == original_cache


def test_barcode_image_download_uses_the_mode_file_store(tmp_path, monkeypatch):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread

    picture = image("blue")

    class ImageServer(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.end_headers()
            self.wfile.write(picture)

        def log_message(self, format, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), ImageServer)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    configure(monkeypatch, tmp_path, "prerelease", "lookup")
    plugins = tmp_path / "data/plugins"
    plugins.mkdir(parents=True)
    (plugins / "ModeLookup.py").write_text(f"""from grocy.plugins import BaseBarcodeLookupPlugin
class ModeLookup(BaseBarcodeLookupPlugin):
    def execute_lookup(self, barcode):
        return {{"name": "Mode lookup product", "__barcode": barcode,
                 "qu_id_stock": self.quantity_units[0]["id"],
                 "qu_id_purchase": self.quantity_units[0]["id"],
                 "location_id": self.locations[0]["id"],
                 "__qu_factor_purchase_to_stock": 1,
                 "__image_url": "http://127.0.0.1:{server.server_port}/photo.png"}}
""")
    monkeypatch.setenv("GROCY_STOCK_BARCODE_LOOKUP_PLUGIN", "ModeLookup")
    clear_settings_cache()
    try:
        with TestClient(create_app()) as api:
            response = api.get("/api/stock/barcodes/external-lookup/mode-file?add=true")
            assert response.status_code == 200, response.text
            product = api.get(f"/api/objects/products/{response.json()['id']}")
            assert product.status_code == 200, product.text
            assert product.json()["picture_file_name"] == "mode-file.png"
            assert (tmp_path / "files/lookup/productpictures/mode-file.png").read_bytes() == picture
            token = base64.b64encode(b"mode-file.png").decode()
            assert api.get(f"/api/files/productpictures/{token}").content == picture
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
