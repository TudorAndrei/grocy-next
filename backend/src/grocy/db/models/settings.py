from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class UserSetting(Base, TimestampMixin):
    __tablename__ = "user_settings"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_setting"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")


class UserfieldValue(Base, TimestampMixin):
    __tablename__ = "userfield_values"
    __table_args__ = (UniqueConstraint("entity", "object_id", "name", name="uq_userfield_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity: Mapped[str] = mapped_column(String(128), nullable=False)
    object_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")


class UserfieldDefinition(Base, TimestampMixin):
    __tablename__ = "userfields"
    __table_args__ = (UniqueConstraint("entity", "name"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    caption: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False, default="text")
    input_required: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    default_value: Mapped[str | None] = mapped_column(Text)
    show_as_column_in_tables: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    config: Mapped[str | None] = mapped_column(Text)
    sort_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class UserEntity(Base, TimestampMixin):
    __tablename__ = "userentities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    caption: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    show_in_sidebar_menu: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    icon_css_class: Mapped[str | None] = mapped_column(String(255))


class UserObject(Base, TimestampMixin):
    __tablename__ = "userobjects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    userentity_id: Mapped[int] = mapped_column(ForeignKey("userentities.id"), nullable=False)
