"""Authenticate directory users through the LDAP v3 protocol."""

import re
import ssl
from contextlib import suppress
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from ldap3 import NONE, SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.core.config import Settings, get_settings
from grocy.core.errors import GrocyError
from grocy.db.models.users import User
from grocy.domains.users.service import UsersService


@dataclass(frozen=True)
class DirectoryIdentity:
    username: str
    first_name: str
    last_name: str


@dataclass(frozen=True)
class DirectoryUser:
    id: int
    username: str


class _VerifiedTls(Tls):
    def __init__(self, ca_file: str | None) -> None:
        super().__init__(validate=ssl.CERT_REQUIRED)
        self.context = ssl.create_default_context(cafile=ca_file)

    def wrap_socket(self, connection: Connection, do_handshake: bool = False) -> None:
        # ldap3's Python 3.13 hostname fallback rejects valid IP certificates.
        # Let Python and OpenSSL verify both DNS names and IP addresses.
        assert connection.socket is not None and connection.server is not None
        connection.socket = self.context.wrap_socket(
            connection.socket,
            server_hostname=connection.server.host,
            do_handshake_on_connect=do_handshake,
        )


def _attribute(value: Any) -> str:
    if isinstance(value, list):
        value = value[0] if value else ""
    if isinstance(value, bytes):
        return value.decode()
    return str(value or "")


def lookup_identity(settings: Settings, username: str, password: str) -> DirectoryIdentity | None:
    if not password or not settings.ldap_address or not settings.ldap_base_dn:
        return None
    attribute = settings.ldap_uid_attr
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9;-]*|[0-9]+(?:\.[0-9]+)+", attribute) is None:
        raise GrocyError("LDAP error: Invalid user ID attribute", code=None)
    address = urlsplit(
        settings.ldap_address
        if "://" in settings.ldap_address
        else "ldap://" + settings.ldap_address
    )
    if address.scheme not in {"ldap", "ldaps"} or address.hostname is None:
        raise GrocyError("LDAP error: Invalid server address", code=None)
    secure = address.scheme == "ldaps"
    tls = _VerifiedTls(str(settings.ldap_ca_certs_file) if settings.ldap_ca_certs_file else None)
    server = Server(
        address.hostname,
        port=address.port or (636 if secure else 389),
        use_ssl=secure,
        tls=tls,
        get_info=NONE,
        connect_timeout=settings.ldap_connect_timeout,
    )
    connection = Connection(
        server,
        user=settings.ldap_bind_dn or None,
        password=settings.ldap_bind_pw or None,
        version=3,
        auto_referrals=False,
        check_names=False,
        read_only=True,
        receive_timeout=settings.ldap_receive_timeout,
    )
    try:
        if settings.ldap_start_tls and not secure:
            connection.open()
            if not connection.start_tls():
                return None
        if not connection.bind():
            return None
        query = f"(&({attribute}={escape_filter_chars(username)}){settings.ldap_user_filter})"
        if not connection.search(
            settings.ldap_base_dn,
            query,
            search_scope=SUBTREE,
            attributes=[attribute, "givenName", "sn"],
        ):
            result = connection.result or {}
            if result.get("result", 0) != 0:
                raise GrocyError(
                    "LDAP error: " + str(result.get("description", "Search failed")),
                    code=None,
                )
            return None
        entries = [row for row in connection.response or [] if row.get("type") == "searchResEntry"]
        if not entries:
            return None
        entry = entries[0]
        attributes = {name.lower(): value for name, value in entry["attributes"].items()}
        canonical = _attribute(attributes.get(attribute.lower()))
        if not canonical or not connection.rebind(user=entry["dn"], password=password):
            return None
        return DirectoryIdentity(
            canonical, _attribute(attributes.get("givenname")), _attribute(attributes.get("sn"))
        )
    except (LDAPException, OSError):
        return None
    finally:
        with suppress(LDAPException, OSError):
            connection.unbind()


async def authenticate_user(
    session: AsyncSession, username: str, password: str
) -> DirectoryUser | None:
    identity = await run_in_threadpool(lookup_identity, get_settings(), username, password)
    if identity is None:
        return None
    query = select(User.id, User.username).where(User.username == identity.username)
    user = (await session.execute(query)).first()
    if user is None:
        await UsersService(session).create_user(
            {
                "username": identity.username,
                "first_name": identity.first_name,
                "last_name": identity.last_name,
                "password": "",
            }
        )
        user = (await session.execute(query)).first()
    return DirectoryUser(user.id, user.username) if user is not None else None
