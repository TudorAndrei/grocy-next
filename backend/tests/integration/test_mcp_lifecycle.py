import pytest
from fastmcp import Client

from grocy.core.config import clear_settings_cache
from grocy.mcp.server import create_mcp_server


@pytest.mark.asyncio
async def test_native_mcp_initializes_and_validates_actor(tmp_path, monkeypatch):
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'mcp.db'}")
    monkeypatch.setenv("GROCY_MCP_API_KEY", "dev-key")
    clear_settings_cache()
    server = create_mcp_server()
    async with Client(server) as client:
        result = await client.call_tool("products_get", {"product_id": 1})
        assert result.data["name"] == "Greek Yogurt"
        purchased = await client.call_tool("inventory_purchase", {"product_id": 1, "amount": 2})
        assert purchased.data["amount"] == 2
        product = await client.call_tool("products_get", {"product_id": 1})
        assert product.data["stock_amount"] == 2
    monkeypatch.setenv("GROCY_MCP_API_KEY", "invalid-key")
    clear_settings_cache()
    async with Client(create_mcp_server()) as client:
        with pytest.raises(Exception, match="Invalid API key"):
            await client.call_tool("products_get", {"product_id": 1})
