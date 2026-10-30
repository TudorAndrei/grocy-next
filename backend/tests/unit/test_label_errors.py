import httpx
import pytest

from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.domains.printing import send_label


async def test_label_http_error_keeps_response_detail_and_redacts_the_printer_password(monkeypatch):
    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda _request: httpx.Response(500, text="Printer failed"))

    def client(**options):
        return original_client(transport=transport, **options)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    settings = get_settings()
    url = httpx.URL("http://printer.invalid/print").copy_with(
        username="operator", password="test-password"
    )
    monkeypatch.setattr(settings, "label_printer_webhook", str(url))
    monkeypatch.setattr(settings, "label_printer_run_server", True)
    with pytest.raises(GrocyError) as failure:
        await send_label({"product": "Milk"})
    message = failure.value.message
    assert "500 Internal Server Error" in message and "Printer failed" in message
    assert "test-password" not in message
    assert "operator:***@printer.invalid" in message
