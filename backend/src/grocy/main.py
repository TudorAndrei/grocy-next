from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from grocy import __version__
from grocy.api.compatibility import router as compatibility_router
from grocy.api.v2 import router as v2_router
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, grocy_error_handler
from grocy.db.seed import seed_if_empty
from grocy.db.session import configure_sqlite, create_schema, get_engine, get_session_factory


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.database_url.startswith("sqlite"):
        db_path = settings.database_url.split("///")[-1]
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    engine = get_engine(settings)
    await configure_sqlite(engine, settings)
    if settings.auto_create_schema:
        await create_schema(engine)
    if settings.seed_demo_data:
        factory = get_session_factory(settings)
        async with factory() as session:
            await seed_if_empty(session, api_key=settings.dev_open_api_key)
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(GrocyError, grocy_error_handler)
    app.include_router(compatibility_router)
    app.include_router(v2_router)
    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "grocy.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


def main() -> None:
    run()
