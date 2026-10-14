from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.models.base import Base, TimestampMixin


class Chore(Base, TimestampMixin):
    __tablename__ = "chores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    period_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manually")
    period_days: Mapped[int | None] = mapped_column(Integer)
    period_config: Mapped[str | None] = mapped_column(String(255))
    track_date_only: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rollover: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assignment_type: Mapped[str] = mapped_column(
        String(64), nullable=False, default="no-assignment"
    )
    assignment_config: Mapped[str | None] = mapped_column(Text)
    next_execution_assigned_to_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    start_date: Mapped[datetime | None] = mapped_column(DateTime)
    rescheduled_date: Mapped[datetime | None] = mapped_column(DateTime)
    rescheduled_next_execution_assigned_to_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id")
    )


class ChoreLog(Base):
    __tablename__ = "chores_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chore_id: Mapped[int] = mapped_column(ForeignKey("chores.id"), nullable=False)
    tracked_time: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    done_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    undone: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    undone_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    row_created_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )


class TaskCategory(Base, TimestampMixin):
    __tablename__ = "task_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    done_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("task_categories.id"))
    assigned_to_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class Battery(Base, TimestampMixin):
    __tablename__ = "batteries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    used_in: Mapped[str | None] = mapped_column(String(255))
    charge_interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class BatteryChargeCycle(Base):
    __tablename__ = "battery_charge_cycles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battery_id: Mapped[int] = mapped_column(ForeignKey("batteries.id"), nullable=False)
    tracked_time: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    undone: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    undone_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    row_created_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.datetime("now", "localtime"),
        nullable=False,
    )
