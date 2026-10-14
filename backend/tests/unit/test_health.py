from fastapi.testclient import TestClient


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "grocy-next"


def test_products_require_api_key(client: TestClient) -> None:
    response = client.get("/api/objects/products")
    assert response.status_code == 401


def test_products_with_api_key(client: TestClient, api_headers: dict[str, str]) -> None:
    response = client.get("/api/objects/products", headers=api_headers)
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) >= 1
    assert "name" in body[0]
