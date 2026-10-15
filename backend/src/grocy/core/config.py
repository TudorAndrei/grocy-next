from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GROCY_", env_file=".env", extra="ignore")

    app_name: str = "grocy-next"
    currency: str = "USD"
    debug: bool = False
    database_url: str = f"sqlite+aiosqlite:///{Path('data') / 'grocy.db'}"
    database_busy_timeout_ms: int = 5000
    database_wal: bool = True
    api_key_header: str = "GROCY-API-KEY"
    host: str = "127.0.0.1"
    port: int = 8000
    auto_create_schema: bool = True
    seed_demo_data: bool = True
    dev_open_api_key: str = "dev-key"
    grocy_baseline: str = "v4.5.0"
    mcp_enabled: bool = True
    mcp_api_key: str = ""
    files_root: Path = Path("data/files")
    max_upload_bytes: int = 20 * 1024 * 1024
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    barcode_provider_url: str = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
    label_printer_webhook: str = ""
    thermal_printer_device: str = ""
    thermal_printer_host: str = ""
    thermal_printer_port: int = 9100


@lru_cache
def get_settings() -> Settings:
    return Settings()


def clear_settings_cache() -> None:
    get_settings.cache_clear()
