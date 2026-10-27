"""Install the pinned Grocy read models and query functions."""

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.config import get_settings
from grocy.db.models.settings import UserSetting

DEFINITIONS = Path(__file__).with_name("compatibility") / "grocy_4_5_0_views.json"


def register_compatibility_functions(
    connection: Connection, settings: dict[str, Any] | None = None
) -> None:
    values = get_settings().user_defaults() if settings is None else settings
    database: Any = connection.connection.dbapi_connection
    database.create_function("grocy_user_setting", 1, lambda key: values.get(key))


def install_compatibility_views(connection: Connection) -> None:
    register_compatibility_functions(connection)
    views = json.loads(DEFINITIONS.read_text())["views"]
    for name in views:
        connection.exec_driver_sql(f'DROP VIEW IF EXISTS "{name}"')
    for statement in views.values():
        connection.exec_driver_sql(statement)


async def configure_compatibility_queries(session: AsyncSession) -> None:
    user_id = session.info.get("actor_user_id", 1)
    rows = await session.execute(
        select(UserSetting.key, UserSetting.value).where(UserSetting.user_id == user_id)
    )
    settings = {
        **get_settings().user_defaults(),
        **session.info.get("native_user_defaults", {}),
        **{key: value for key, value in rows},
    }

    connection = await session.connection()
    await connection.run_sync(register_compatibility_functions, settings)
