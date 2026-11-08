"""Native users/access page data, separate from compatibility mutation contracts."""

import secrets
import string
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.input import database_error
from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import argument_error, filter_int, loose_equals, truthy
from grocy.core.actor import Actor
from grocy.core.config import get_settings
from grocy.core.errors import NotFoundError
from grocy.domains.catalog.custom_data import custom_data_fields
from grocy.domains.catalog.objects import GenericObjectsService


class UsersPresentation:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _rows(
        self, sql: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        result = await self.session.execute(text(sql), parameters or {})
        return [dict(row) for row in result.mappings()]

    async def _user(self, user_id: str) -> dict[str, Any]:
        users = await self._rows("SELECT * FROM users_dto WHERE id=:id", {"id": user_id})
        if not users:
            raise NotFoundError("User not found")
        return users[0]

    async def _values(self) -> list[dict[str, Any]]:
        return await self._rows(
            "SELECT object_id,name,value FROM userfield_values_resolved "
            "WHERE entity='users' ORDER BY name COLLATE NOCASE"
        )

    @staticmethod
    def _flags() -> dict[str, bool]:
        settings = get_settings()
        # The application has no embedded-install mode. DISABLE_AUTH retains its PHP truthiness.
        hidden = truthy(settings.disable_auth)
        external = (
            settings.auth_mode in {"ldap", "reverse-proxy"}
            and settings.mode not in {"dev", "demo", "prerelease"}
            and not hidden
        )
        return {
            "externally_managed_authentication": external,
            "password_controls": not hidden and not external,
            "hidden_password": hidden,
        }

    async def overview(self, actor: Actor) -> dict[str, Any]:
        actor.require("USERS_READ")
        flags = self._flags()
        return {
            "users": await self._rows("SELECT * FROM users_dto ORDER BY username"),
            "fields": await custom_data_fields(self.session, "users"),
            "values": await self._values(),
            "current_user_id": actor.user_id,
            "externally_managed_authentication": flags["externally_managed_authentication"],
            "show_permissions": not flags["hidden_password"],
        }

    async def form(self, actor: Actor, user_id: str | None) -> dict[str, Any]:
        actor.require(
            "USERS_CREATE"
            if user_id is None
            else "USERS_EDIT_SELF"
            if loose_equals(user_id, actor.user_id)
            else "USERS_EDIT"
        )
        user = None if user_id is None else await self._user(user_id)
        return {
            "user": user,
            "fields": await custom_data_fields(self.session, "users"),
            "values": {}
            if user is None
            else await GenericObjectsService(self.session).get_userfields("users", user["id"]),
            "current_user_id": actor.user_id,
            **self._flags(),
        }

    async def permissions(self, actor: Actor, user_id: str) -> dict[str, Any]:
        actor.require("USERS_READ")
        return {
            "user": await self._user(user_id),
            "permissions": await self._rows(
                "SELECT * FROM uihelper_user_permissions WHERE user_id=:id", {"id": user_id}
            ),
            "current_user_id": actor.user_id,
        }

    async def keys(self, actor: Actor, query: bytes) -> dict[str, Any]:
        raw = query_parameters(query).get("key")
        accepted = filter_int(raw) if isinstance(raw, str) else None
        return {
            "keys": await self._rows(
                "SELECT * FROM api_keys" + ("" if actor.is_admin else " WHERE user_id=:id"),
                {"id": actor.user_id},
            ),
            "users": await self._rows("SELECT * FROM users_dto"),
            "selected_key_id": raw if accepted else -1,
        }

    async def create_key(self, actor: Actor, query: bytes) -> dict[str, int]:
        description = query_parameters(query).get("description")
        if description is not None and not isinstance(description, str):
            raise argument_error(
                "Grocy\\Services\\ApiKeyService::CreateApiKey",
                2,
                "description",
                "?string",
                description,
            )
        characters = string.digits + string.ascii_lowercase + string.ascii_uppercase
        key = "".join(secrets.choice(characters) for _ in range(50))
        try:
            connection = await self.session.connection()
            result = await connection.execute(
                text(
                    "INSERT INTO api_keys(api_key,user_id,expires,key_type,description) "
                    "VALUES(:key,:user_id,'2999-12-31 23:59:59','default',:description)"
                ),
                {"key": key, "user_id": actor.user_id, "description": description},
            )
            identity = result.lastrowid
            await self.session.commit()
            self.session.expire_all()
        except DBAPIError as error:
            await self.session.rollback()
            raise database_error(error) from error
        return {"id": identity}
