"""Bulk setting operations for Grocy Next clients."""

import json
import math
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Response
from sqlalchemy import select

from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError
from grocy.db.models.settings import UserSetting

router = APIRouter(tags=["settings"])


def _setting_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        if not math.isfinite(value):
            raise GrocyError("A setting number must be finite")
        return format(value, ".14g")
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


@router.put("/user/settings")
async def put_user_settings(
    body: dict[str, Any], actor: CurrentActor, session: DbSession
) -> dict[str, Any]:
    stmt = select(UserSetting).where(UserSetting.user_id == actor.user_id)
    existing = {row.key: row for row in (await session.execute(stmt)).scalars().all()}
    for key, value in body.items():
        text = _setting_text(value)
        row = existing.get(key)
        if row is None:
            row = UserSetting(user_id=actor.user_id, key=key, value=text)
            existing[key] = row
            session.add(row)
        else:
            row.value = text
            row.row_updated_timestamp = datetime.now()
    await session.commit()
    return {
        **get_settings().user_defaults(),
        **{row.key: row.value for row in existing.values()},
    }


@router.delete("/user/settings", status_code=204)
async def delete_user_settings(actor: CurrentActor, session: DbSession) -> Response:
    stmt = select(UserSetting).where(UserSetting.user_id == actor.user_id)
    for row in (await session.execute(stmt)).scalars().all():
        await session.delete(row)
    await session.commit()
    return Response(status_code=204)
