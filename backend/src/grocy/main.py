import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError
from starlette.exceptions import HTTPException

from grocy import __version__
from grocy.api.compatibility import router as compatibility_router
from grocy.api.v2 import router as v2_router
from grocy.api.v2.setup import setup_token
from grocy.compatibility.files import NativeFiles
from grocy.compatibility.http_request import NativeHttpRequests
from grocy.compatibility.input import database_error
from grocy.compatibility.php import php_error
from grocy.compatibility.protocol import NativeProtocol
from grocy.compatibility.purifier import InputPurifier
from grocy.compatibility.runtime import PythonRuntime
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, grocy_error_handler
from grocy.core.grocy_cors import GrocyCorsHeadersMiddleware
from grocy.core.legacy_http import LegacyHttpMiddleware, legacy_http_error
from grocy.db.models.catalog import Location
from grocy.db.seed import has_ever_had_users, seed_if_empty
from grocy.db.session import (
    close_engines,
    configure_sqlite,
    get_engine,
    get_session_factory,
    upgrade_schema,
)


@asynccontextmanager
async def lifespan(_app: FastAPI | None) -> AsyncGenerator[None]:
    settings = get_settings()
    if settings.active_database_url().startswith("sqlite"):
        db_path = settings.active_database_url().split("///")[-1]
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    engine = get_engine(settings)
    await configure_sqlite(engine, settings)
    if settings.auto_create_schema:
        await upgrade_schema(engine)
    if settings.seed_demo_data:
        factory = get_session_factory(settings)
        async with factory() as session:
            await seed_if_empty(session, api_key=settings.dev_open_api_key)
    async with get_session_factory(settings)() as session:
        if not await has_ever_had_users(session):
            logging.getLogger("grocy.setup").warning(
                "No users exist. Open the web UI and enter setup token: %s", setup_token()
            )
    if not settings.feature_enabled("STOCK_LOCATION_TRACKING"):
        async with get_session_factory(settings)() as session:
            if await session.get(Location, 1) is None:
                session.add(Location(id=1, name="Default"))
                await session.commit()
    runtime = PythonRuntime()
    purifier = None
    files = None
    http = None
    if settings.use_native_php:
        purifier = InputPurifier(settings.php_executable)
        files = NativeFiles(settings.php_executable)
        http = NativeHttpRequests(settings.php_executable, settings.datapath.resolve())
        await purifier.start()
    else:
        await runtime.start()
    try:
        if _app is not None:
            _app.state.input_purifier = purifier or runtime
            _app.state.native_files = files
            _app.state.native_http = http
            _app.state.use_native_php = settings.use_native_php
        yield
    finally:
        if http is not None:
            await http.close()
        if files is not None:
            await files.close()
        if purifier is not None:
            await purifier.close()
        else:
            await runtime.close()
        await close_engines(engine)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    if not settings.use_native_php:
        app.add_middleware(LegacyHttpMiddleware)
    app.add_middleware(GrocyCorsHeadersMiddleware)
    if settings.use_native_php:
        app.add_middleware(NativeProtocol)
    app.add_exception_handler(GrocyError, grocy_error_handler)

    app.add_exception_handler(HTTPException, legacy_http_error)

    @app.exception_handler(DBAPIError)
    async def database_failure(request, error):
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/v2/"):
            return await grocy_error_handler(request, php_error(database_error(error).message))
        raise error

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(_request, _exc):
        return JSONResponse(
            status_code=409,
            content={
                "error_message": "A required value, unique value, or reference is invalid",
                "error_code": "constraint_conflict",
            },
        )

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
