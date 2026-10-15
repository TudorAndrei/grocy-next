from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class Equipment(Base, TimestampMixin):
    __tablename__ = "equipment"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    instruction_manual_file_name: Mapped[str | None] = mapped_column(String(255))
