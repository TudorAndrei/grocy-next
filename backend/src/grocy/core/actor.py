from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Actor:
    user_id: int
    username: str
    api_key: str | None = None
    is_admin: bool = True
