"""Install the pinned Grocy read models without upstream write triggers."""

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.db.models.settings import UserSetting

DEFINITIONS = Path(__file__).with_name("compatibility") / "grocy_4_5_0_views.json"


def install_compatibility_views(connection: Connection) -> None:
    views = json.loads(DEFINITIONS.read_text())["views"]
    for name in views:
        connection.exec_driver_sql(f'DROP VIEW IF EXISTS "{name}"')
    for statement in views.values():
        connection.exec_driver_sql(statement)


async def configure_compatibility_queries(session: AsyncSession) -> None:
    user_id = session.info.get("actor_user_id", 1)
    rows = (
        await session.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    ).scalars()
    settings = {"stock_due_soon_days": "5", **{row.key: row.value for row in rows}}

    def register(connection: Any) -> None:
        connection.connection.dbapi_connection.create_function(
            "grocy_user_setting", 1, lambda key: settings.get(key)
        )

    connection = await session.connection()
    await connection.run_sync(register)
