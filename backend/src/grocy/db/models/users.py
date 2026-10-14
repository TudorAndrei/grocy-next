from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from grocy.db.models.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(255))
    last_name: Mapped[str | None] = mapped_column(String(255))
    password: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    picture_file_name: Mapped[str | None] = mapped_column(String(255))

    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="user")


class ApiKey(Base, TimestampMixin):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    key_type: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    description: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="api_keys")
