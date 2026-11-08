"""Native HTML form login and cookie-only logout; the modern key API is separate."""

import time
from email.utils import formatdate

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.exc import DBAPIError

from grocy.compatibility.input import database_error
from grocy.compatibility.lessql import cookie_parameters
from grocy.compatibility.php import php_error
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError, grocy_error_handler
from grocy.core.urls import construct_url, request_base
from grocy.domains.users import native_login


async def native_page(request: Request) -> None:
    request.scope["grocy_legacy_base_path"] = True


router = APIRouter(tags=["authentication"], dependencies=[Depends(native_page)])


@router.post("/login", include_in_schema=False)
async def process_login(request: Request, session: DbSession) -> Response:
    try:
        result = await native_login.login(session, await native_login.native_form(request))
    except GrocyError as error:
        return await grocy_error_handler(
            request, error if error.details is not None else php_error(error.message)
        )
    except DBAPIError as error:
        await session.rollback()
        return await grocy_error_handler(request, php_error(database_error(error).message))
    if result.error is not None:
        response = await grocy_error_handler(request, result.error)
    else:
        response = Response(
            status_code=302,
            headers={
                "Location": construct_url(
                    request_base(request), "/" if result.key else "/login?invalid=true"
                ),
                "Content-Type": "text/html; charset=UTF-8",
            },
        )
    if result.key is not None:
        expiry = formatdate(native_login.SESSION_COOKIE_EXPIRY, usegmt=True)
        age = native_login.SESSION_COOKIE_EXPIRY - int(time.time())
        response.headers.append(
            "Set-Cookie",
            f"grocy_session={result.key}; expires={expiry}; Max-Age={age}",
        )
    return response


@router.api_route("/logout", methods=["GET", "HEAD"], include_in_schema=False)
async def process_logout(
    request: Request, _actor: AuthenticatedActor, session: DbSession
) -> Response:
    header = b"; ".join(
        value for name, value in request.scope["headers"] if name.lower() == b"cookie"
    )
    await native_login.logout(session, cookie_parameters(header).get("grocy_session"))
    return Response(
        status_code=302,
        headers={
            "Location": construct_url(request_base(request), "/"),
            "Content-Type": "text/html; charset=UTF-8",
        },
    )
