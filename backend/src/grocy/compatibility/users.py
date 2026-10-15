"""The user DTO used by Grocy user and household responses."""

from typing import Any

from grocy.db.models.users import User


def user_dto(user: User) -> dict[str, Any]:
    parts = [user.first_name or "", user.last_name or ""]
    return {
        "id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "display_name": " ".join(part for part in parts if part) or user.username,
        "picture_file_name": user.picture_file_name,
        "row_created_timestamp": user.row_created_timestamp.isoformat(sep=" ", timespec="seconds"),
    }
