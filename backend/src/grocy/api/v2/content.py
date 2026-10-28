"""Formatted descriptions for web views, separate from stored compatibility values."""

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from grocy.compatibility.sanitizer import render_html
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.core.errors import NotFoundError
from grocy.db.models.catalog import Product
from grocy.db.models.equipment import Equipment
from grocy.db.models.recipes import Recipe
from grocy.domains.content_editor import editor_document
from grocy.domains.system.service import SystemService

router = APIRouter(tags=["content"])

ContentEntity = Literal["products", "recipes", "equipment"]


class FormattedContent(BaseModel):
    id: int
    html: str


class EditorDraft(BaseModel):
    html: str
    paste: bool = False


@router.get("/content/{entity}")
async def formatted_descriptions(
    entity: ContentEntity, actor: AuthenticatedActor, session: DbSession
) -> list[FormattedContent]:
    actor.require({"products": "STOCK", "recipes": "RECIPES", "equipment": "EQUIPMENT"}[entity])
    model = Product if entity == "products" else Recipe if entity == "recipes" else Equipment
    rows = (await session.execute(select(model.id, model.description))).all()
    return await run_in_threadpool(
        lambda: [
            FormattedContent(id=identity, html=render_html(html or "")) for identity, html in rows
        ]
    )


@router.post("/content/{entity}/editor", response_class=HTMLResponse)
async def description_editor(
    entity: ContentEntity,
    body: EditorDraft,
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
) -> HTMLResponse:
    actor.require({"products": "STOCK", "recipes": "RECIPES", "equipment": "EQUIPMENT"}[entity])
    locale = await SystemService(session).locale(
        actor.user_id, request.headers.get("accept-language", "")
    )
    document = await run_in_threadpool(
        editor_document,
        body.html,
        locale,
        label="Description",
        channel="grocy-description",
        paste_initial=body.paste,
    )
    return HTMLResponse(document)


@router.get("/content/{entity}/{object_id}")
async def formatted_description(
    entity: ContentEntity,
    object_id: int,
    actor: AuthenticatedActor,
    session: DbSession,
) -> dict[str, str]:
    actor.require({"products": "STOCK", "recipes": "RECIPES", "equipment": "EQUIPMENT"}[entity])
    model = Product if entity == "products" else Recipe if entity == "recipes" else Equipment
    row = await session.get(model, object_id)
    if row is None:
        raise NotFoundError("Record not found")
    return {"html": render_html(row.description or "")}
