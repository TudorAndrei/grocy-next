"""Native form authentication and session staging, separate from JSON API-key login."""

import secrets
import string
import time
from dataclasses import dataclass
from datetime import datetime
from email import policy
from email.parser import BytesParser
from typing import Any
from urllib.parse import quote_from_bytes, unquote_to_bytes

import bcrypt
from fastapi import Request
from passlib.context import CryptContext
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility.input import database_error
from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import argument_error, loose_equals, php_error, php_string
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone
from grocy.domains.users.ldap import authenticate_user as authenticate_directory_user

SESSION_COOKIE_EXPIRY = 2147483647
_LEGACY_HASHES = CryptContext(
    schemes=["argon2", "md5_crypt", "sha256_crypt", "sha512_crypt", "des_crypt", "bsdi_crypt"]
)


def _form_parameters(pairs: list[bytes], maximum: int) -> dict[Any, Any]:
    registered: list[tuple[Any, bytes]] = []
    for pair in pairs[:maximum]:
        name, _, value = pair.partition(b"=")
        # PHP truncates variable names at NUL, while field values retain it.
        name = unquote_to_bytes(name.replace(b"+", b" ")).split(b"\x00", 1)[0]
        encoded = quote_from_bytes(name, safe="").encode() + b"=" + value
        parsed = query_parameters(encoded)
        if not parsed:
            continue
        key, nested = next(iter(parsed.items()))
        depth = 0
        while isinstance(nested, dict) and nested:
            depth += 1
            nested = next(iter(nested.values()))
        if depth > 64:
            # An over-deep registration removes an earlier value of this variable.
            registered = [item for item in registered if item[0] != key]
        else:
            registered.append((key, encoded))
    return query_parameters(b"&".join(pair for _key, pair in registered))


async def native_form(request: Request) -> dict[Any, Any] | None:
    """Slim only receives PHP's $_POST for these two exact media types."""
    headers = request.headers.getlist("content-type")
    content_type = headers[-1].strip(" \t") if headers else ""
    media = content_type.split(";", 1)[0]
    if media == "application/x-www-form-urlencoded":
        # PHP SAPI, unlike parse_str, registers the 1001st URL-encoded pair.
        return _form_parameters((await request.body()).split(b"&"), 1001)
    if media != "multipart/form-data":
        return None
    message = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + await request.body()
    )
    fields = []
    if message.is_multipart():
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            name = part.get_param("name", header="content-disposition")
            filename = part.get_param("filename", header="content-disposition")
            if not isinstance(name, str) or filename is not None:
                continue
            # PHP does not decode a multipart field's Content-Transfer-Encoding.
            if "Content-Transfer-Encoding" in part:
                del part["Content-Transfer-Encoding"]
            value = part.get_payload(decode=True)
            if not isinstance(value, bytes):
                continue
            fields.append(
                quote_from_bytes(name.encode("utf-8", "surrogateescape"), safe="")
                + "="
                + quote_from_bytes(value, safe="")
            )
    return _form_parameters([field.encode() for field in fields], 1000)


def _condition(column: str, value: Any) -> tuple[str, dict[str, Any]]:
    # LessQL Database::is uses numeric key 0 for a single-element array,
    # but all values for larger arrays. PDO::quote truncates a string at NUL.
    values = [value]
    if isinstance(value, dict):
        values = [value.get(0)] if len(value) == 1 else list(value.values())
    clauses, bindings = [], {}
    for index, item in enumerate(values):
        if item is None:
            clauses.append(column + " IS NULL")
        elif isinstance(item, (dict, list)):
            raise php_error(
                "PDO::quote(): Argument #1 ($string) must be of type string, array given"
            )
        else:
            name = "value" + str(index)
            bindings[name] = php_string(item).split("\x00", 1)[0].encode("utf-8", "surrogateescape")
            clauses.append(column + "=CAST(:" + name + " AS TEXT)")
    return " OR ".join(clauses) if clauses else "0=1", bindings


def _verify(password: str, stored: str) -> bool:
    raw = password.encode("utf-8", "surrogateescape")
    if stored.startswith(("$2a$", "$2b$", "$2x$", "$2y$")):
        try:
            return bcrypt.checkpw(raw.split(b"\x00", 1)[0][:72], stored.encode())
        except ValueError:
            return False
    kind = _LEGACY_HASHES.identify(stored)
    if kind is not None:
        try:
            return _LEGACY_HASHES.verify(
                raw if kind == "argon2" else raw.split(b"\x00", 1)[0], stored
            )
        except (ValueError, TypeError):
            return False
    return False


def _rehash(password: str) -> str:
    if "\x00" in password:
        raise php_error("password_hash(): Argument #1 ($password) must not contain any null bytes")
    hashed = bcrypt.hashpw(
        password.encode("utf-8", "surrogateescape")[:72], bcrypt.gensalt(rounds=12)
    )
    return hashed.decode().replace("$2b$", "$2y$", 1)


@dataclass(frozen=True)
class NativeLoginResult:
    key: str | None = None
    error: GrocyError | None = None


async def login(session: AsyncSession, parameters: dict[Any, Any] | None) -> NativeLoginResult:
    settings = get_settings()
    if parameters is None:
        raise argument_error(
            settings.auth_class_name() + "::ProcessLogin", 1, "postParams", "array", None
        )
    if settings.auth_mode not in {"default", "ldap"}:
        raise php_error("Not implemented")
    username, password = parameters.get("username"), parameters.get("password")
    user_id = None
    stored = None
    if settings.auth_mode == "ldap":
        user = await authenticate_directory_user(session, username, password, native=True)
        user_id = user.id if user is not None else None
    elif username is not None and password is not None:
        where, values = _condition("username", username)
        user = (
            (
                await session.execute(
                    text("SELECT id,password FROM users WHERE " + where + " LIMIT 1"), values
                )
            )
            .mappings()
            .first()
        )
        if user is not None:
            if isinstance(password, dict):
                raise php_error(
                    "password_verify(): Argument #1 ($password) must be of type string, array given"
                )
            stored = user["password"]
            if isinstance(stored, str) and await run_in_threadpool(
                _verify, php_string(password), stored
            ):
                user_id = user["id"]
    if user_id is None:
        return NativeLoginResult()
    key = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(50))
    expiry = (
        SESSION_COOKIE_EXPIRY
        if loose_equals(parameters.get("stay_logged_in"), "on")
        else time.time() + 2592000
    )
    await session.execute(
        text("INSERT INTO sessions(session_key,user_id,expires) VALUES (:key,:user,:expires)"),
        {
            "key": key,
            "user": user_id,
            "expires": datetime.fromtimestamp(expiry, server_timezone()).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
        },
    )
    # Source creates the session and sends its cookie before a possible rehash error.
    await session.commit()
    if stored is not None and not stored.startswith("$2y$12$"):
        try:
            hashed = await run_in_threadpool(_rehash, php_string(password))
            await session.execute(
                text("UPDATE users SET password=:hash WHERE id=:id"),
                {"hash": hashed, "id": user_id},
            )
            await session.commit()
        except GrocyError as error:
            return NativeLoginResult(key, error)
        except DBAPIError as error:
            await session.rollback()
            return NativeLoginResult(key, php_error(database_error(error).message))
    return NativeLoginResult(key)


async def logout(session: AsyncSession, cookie: Any) -> None:
    where, values = _condition("session_key", cookie)
    try:
        await session.execute(text("DELETE FROM sessions WHERE " + where), values)
        await session.commit()
    except DBAPIError as error:
        await session.rollback()
        raise php_error(database_error(error).message) from error
