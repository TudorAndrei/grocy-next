from typing import Any

from fastapi import APIRouter
from sqlalchemy import select

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.db.models.settings import UserfieldValue

router = APIRouter(tags=["userfields"])


@router.get("/api/userfields/{entity}/{object_id}")
async def get_userfields(
    entity: str,
    object_id: int,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, str]:
    stmt = select(UserfieldValue).where(
        UserfieldValue.entity == entity,
        UserfieldValue.object_id == object_id,
    )
    rows = (await session.execute(stmt)).scalars().all()
    return {row.name: row.value for row in rows}


@router.put("/api/userfields/{entity}/{object_id}")
async def put_userfields(
    entity: str,
    object_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, str]:
    stmt = select(UserfieldValue).where(
        UserfieldValue.entity == entity,
        UserfieldValue.object_id == object_id,
    )
    existing = {
        row.name: row for row in (await session.execute(stmt)).scalars().all()
    }
    for name, value in body.items():
        text = "" if value is None else str(value)
        row = existing.get(name)
        if row is None:
            session.add(
                UserfieldValue(
                    entity=entity,
                    object_id=object_id,
                    name=name,
                    value=text,
                )
            )
        else:
            row.value = text
    await session.commit()
    stmt = select(UserfieldValue).where(
        UserfieldValue.entity == entity,
        UserfieldValue.object_id == object_id,
    )
    rows = (await session.execute(stmt)).scalars().all()
    return {row.name: row.value for row in rows}
