from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(255))
    last_name: Mapped[str | None] = mapped_column(String(255))
    password: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    picture_file_name: Mapped[str | None] = mapped_column(String(255))


class ApiKey(Base, TimestampMixin):
    __tablename__ = "api_keys"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    last_used: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    key_type: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    description: Mapped[str | None] = mapped_column(Text)


class UserPermission(Base):
    __tablename__ = "user_permissions"
    __table_args__ = (UniqueConstraint("user_id", "permission_id"), {"sqlite_autoincrement": True})

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    permission_id: Mapped[int] = mapped_column(Integer, nullable=False)


class ImportedApiKey(Base):
    """Keep imported credentials distinct from legacy application credentials."""

    __tablename__ = "grocy_imported_api_keys"

    api_key_id: Mapped[int] = mapped_column(
        ForeignKey("api_keys.id", ondelete="CASCADE"), primary_key=True
    )
