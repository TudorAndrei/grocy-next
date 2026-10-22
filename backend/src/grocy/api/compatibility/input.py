"""Apply the upstream request filter before FastAPI converts body fields."""

import json
from collections.abc import Callable, Coroutine
from contextlib import aclosing
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, get_args, get_origin

from fastapi import Request, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, model_validator

from grocy.compatibility.purifier import InputPurifier
from grocy.core.auth import authenticate_request, get_db_session, require_request_permission
from grocy.core.errors import GrocyError

_FILTER_MARKER = "grocy_filtered_body"


class CompatibilityBody(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def optional_empty_values(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        values = dict(values)
        for name, field in cls.model_fields.items():
            if values.get(name) != "" or field.is_required():
                continue
            kinds = get_args(field.annotation) or (field.annotation,)
            if any(
                kind in {bool, int, Decimal, date, datetime} or get_origin(kind) is list
                for kind in kinds
            ):
                values[name] = field.get_default(call_default_factory=True)
        return values


@dataclass(frozen=True)
class BodyFilter:
    null_status: int | None
    permission_before_filter: bool


def filtered_body[T: Callable[..., Any]](
    *, null_status: int | None = 400, permission_before_filter: bool = True
) -> Callable[[T], T]:
    def decorate(endpoint: T) -> T:
        setattr(endpoint, _FILTER_MARKER, BodyFilter(null_status, permission_before_filter))
        return endpoint

    return decorate


class FilteredRequest(Request):
    def __init__(self, original: Request, body: bytes) -> None:
        super().__init__(original.scope, original.receive)
        self._filtered_body = body

    async def body(self) -> bytes:
        return self._filtered_body


class CompatibilityRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()
        rule: BodyFilter | None = getattr(self.endpoint, _FILTER_MARKER, None)
        if rule is None:
            return original

        async def handle(request: Request) -> Response:
            async with aclosing(get_db_session(request)) as sessions:
                session = await anext(sessions)
                actor = await authenticate_request(
                    request, session, request.headers.get("GROCY-API-KEY")
                )
                if rule.permission_before_filter:
                    require_request_permission(request, actor)
                request.state.grocy_session = session
                request.state.grocy_actor = actor
                try:
                    if request.headers.get("content-type") != "application/json":
                        raise GrocyError("Bad Content-Type")
                    purifier = getattr(
                        request.state, "native_runtime", request.app.state.input_purifier
                    )
                    raw = await request.body()
                    if getattr(request.app.state, "use_native_php", False):
                        body = await purifier.purify(raw)
                    else:
                        body = json.loads(raw) if raw else {}
                    if not rule.permission_before_filter:
                        require_request_permission(request, actor)
                    if body is None:
                        if rule.null_status is not None:
                            raise GrocyError(
                                "Request body could not be parsed", status_code=rule.null_status
                            )
                        body = {}
                    elif isinstance(body, list):
                        body = {str(index): value for index, value in enumerate(body)}
                    raw = json.dumps(body, ensure_ascii=False).encode()
                    return await original(FilteredRequest(request, raw))
                finally:
                    del request.state.grocy_actor
                    del request.state.grocy_session

        return handle
