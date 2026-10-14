from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Actor:
    user_id: int
    username: str
    api_key: str | None = None
    is_admin: bool = True
    permissions: frozenset[str] = frozenset()

    def require(self, permission: str) -> None:
        from grocy.core.errors import GrocyError

        if permission and not self.is_admin and permission not in self.permissions:
            raise GrocyError("Permission denied", status_code=403, code="forbidden")
