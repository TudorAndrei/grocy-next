import os
from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ["GROCY_DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["GROCY_SEED_DEMO_DATA"] = "true"
os.environ["GROCY_AUTO_CREATE_SCHEMA"] = "true"
os.environ["GROCY_DEV_OPEN_API_KEY"] = "dev-key"
os.environ["GROCY_DATABASE_WAL"] = "false"
os.environ["GROCY_LABEL_PRINTER_RUN_SERVER"] = "false"

from grocy.core.config import clear_settings_cache
from grocy.db.session import reset_engine
from grocy.main import create_app


@pytest.fixture(autouse=True)
def _reset_settings(monkeypatch, tmp_path) -> Iterator[None]:
    monkeypatch.setenv("GROCY_DATAPATH", str(tmp_path / "native-data"))
    clear_settings_cache()
    reset_engine()
    yield
    clear_settings_cache()
    reset_engine()


@pytest.fixture
def api_headers() -> dict[str, str]:
    return {"GROCY-API-KEY": "dev-key"}


@pytest.fixture
def client() -> Iterator[TestClient]:
    clear_settings_cache()
    reset_engine()
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    from sqlalchemy.pool import StaticPool

    from grocy.db.models import Base

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        yield db
    await engine.dispose()
