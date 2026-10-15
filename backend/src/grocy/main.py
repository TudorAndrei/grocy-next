from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from grocy import __version__
from grocy.api.compatibility import router as compatibility_router
from grocy.api.v2 import router as v2_router
from grocy.compatibility.purifier import InputPurifier
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, grocy_error_handler
from grocy.db.models.catalog import Location
from grocy.db.models.mealplan import MealPlanEntry
from grocy.db.seed import seed_if_empty
from grocy.db.session import configure_sqlite, get_engine, get_session_factory, upgrade_schema
from grocy.domains.recipes.mealplan import sync_meal_plan_recipes


@asynccontextmanager
async def lifespan(_app: FastAPI | None) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.database_url.startswith("sqlite"):
        db_path = settings.database_url.split("///")[-1]
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    engine = get_engine(settings)
    await configure_sqlite(engine, settings)
    if settings.auto_create_schema:
        await upgrade_schema(engine)
    if settings.seed_demo_data:
        factory = get_session_factory(settings)
        async with factory() as session:
            await seed_if_empty(session, api_key=settings.dev_open_api_key)
    if not settings.feature_enabled("STOCK_LOCATION_TRACKING"):
        async with get_session_factory(settings)() as session:
            if await session.get(Location, 1) is None:
                session.add(Location(id=1, name="Default"))
                await session.commit()
    if settings.auto_create_schema:
        async with get_session_factory(settings)() as session:
            days = (await session.scalars(select(MealPlanEntry.day).distinct())).all()
            if days:
                await sync_meal_plan_recipes(session, *days, preserve_matching=True)
                await session.commit()
    purifier = InputPurifier(settings.php_executable)
    try:
        await purifier.start()
        if _app is not None:
            _app.state.input_purifier = purifier
        yield
    finally:
        await purifier.close()
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
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(GrocyError, grocy_error_handler)

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
