from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GROCY_", env_file=".env", extra="ignore")

    app_name: str = "grocy-next"
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


@lru_cache
def get_settings() -> Settings:
    return Settings()


def clear_settings_cache() -> None:
    get_settings.cache_clear()
