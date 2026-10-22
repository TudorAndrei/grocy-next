from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient


def _off_response(payload: dict, status_code: int = 200) -> httpx.Response:
    request = httpx.Request("GET", "https://world.openfoodfacts.org/api/v2/product/3017620422003")
    return httpx.Response(status_code, json=payload, request=request)


def test_external_barcode_lookup_returns_product_fields(
    client: TestClient, api_headers: dict[str, str]
) -> None:
    payload = {
        "status": 1,
        "product": {
            "product_name": "Nutella",
            "product_name_en": "Nutella EN",
            "image_url": "https://images.example/nutella.jpg",
        },
    }
    with patch("grocy.domains.stock.barcode_lookup.httpx.AsyncClient") as client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get = AsyncMock(return_value=_off_response(payload))
        client_cls.return_value = mock_client
        response = client.get(
            "/api/stock/barcodes/external-lookup/3017620422003",
            headers=api_headers,
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Nutella EN"
    assert body["__barcode"] == "3017620422003"
    assert body["__image_url"] == "https://images.example/nutella.jpg"
    assert body["__qu_factor_purchase_to_stock"] == 1
    assert "location_id" in body
    assert "qu_id_purchase" in body
    assert "qu_id_stock" in body
    assert "id" not in body
    products = client.get(
        "/api/objects/products",
        headers=api_headers,
        params=[("query[]", "name=Nutella EN")],
    ).json()
    assert products == []


def test_external_barcode_lookup_add_creates_product_and_barcode(
    client: TestClient, api_headers: dict[str, str], monkeypatch, tmp_path
) -> None:
    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path / "files")
    name = "Lookup Cocoa Spread"
    barcode = "9990001112223"
    payload = {
        "status": 1,
        "product": {"product_name": name, "image_url": ""},
    }
    with patch("grocy.domains.stock.barcode_lookup.httpx.AsyncClient") as client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get = AsyncMock(return_value=_off_response(payload))
        client_cls.return_value = mock_client
        response = client.get(
            f"/api/stock/barcodes/external-lookup/{barcode}",
            headers=api_headers,
            params={"add": "true"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == name
    assert body["__barcode"] == barcode
    assert "id" in body
    product = client.get(f"/api/objects/products/{body['id']}", headers=api_headers)
    assert product.status_code == 200
    assert product.json()["name"] == name
    barcodes = client.get(
        "/api/objects/product_barcodes",
        headers=api_headers,
        params=[("query[]", f"product_id={body['id']}")],
    ).json()
    assert [row["barcode"] for row in barcodes] == [barcode]


def test_external_barcode_lookup_not_found_returns_null(
    client: TestClient, api_headers: dict[str, str]
) -> None:
    with patch("grocy.domains.stock.barcode_lookup.httpx.AsyncClient") as client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get = AsyncMock(
            return_value=_off_response({"status": 0, "status_verbose": "product not found"}, 404)
        )
        client_cls.return_value = mock_client
        response = client.get(
            "/api/stock/barcodes/external-lookup/0000000000000",
            headers=api_headers,
        )
    assert response.status_code == 200, response.text
    assert response.json() is None


def test_external_barcode_lookup_requires_plugin(
    client: TestClient, api_headers: dict[str, str], monkeypatch
) -> None:
    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "stock_barcode_lookup_plugin", "")
    response = client.get(
        "/api/stock/barcodes/external-lookup/123",
        headers=api_headers,
    )
    assert response.status_code == 400
    assert response.json()["error_message"] == "No barcode lookup plugin defined"


def test_external_barcode_lookup_unknown_plugin(
    client: TestClient, api_headers: dict[str, str], monkeypatch
) -> None:
    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "stock_barcode_lookup_plugin", "MissingPlugin")
    response = client.get(
        "/api/stock/barcodes/external-lookup/123",
        headers=api_headers,
    )
    assert response.status_code == 400
    assert response.json()["error_message"] == "Plugin MissingPlugin was not found"
