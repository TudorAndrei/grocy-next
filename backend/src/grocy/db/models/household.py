from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from grocy.db.grocy_checks import native_checks
from grocy.db.models.base import Base, TimestampMixin
from grocy.db.types import DateOrDateTime


class Chore(Base, TimestampMixin):
    __tablename__ = "chores"
    __table_args__ = (
        Index("ix_chores_performance1", "id", "active"),
        *native_checks("chores"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    period_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manually")
    period_days: Mapped[int | None] = mapped_column(Integer)
    period_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    period_config: Mapped[str | None] = mapped_column(String(255))
    track_date_only: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rollover: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assignment_type: Mapped[str] = mapped_column(
        String(64), nullable=False, default="no-assignment"
    )
    assignment_config: Mapped[str | None] = mapped_column(Text)
    next_execution_assigned_to_user_id: Mapped[int | None] = mapped_column(Integer)
    start_date: Mapped[datetime | None] = mapped_column(DateTime)
    rescheduled_date: Mapped[datetime | None] = mapped_column(DateTime)
    rescheduled_next_execution_assigned_to_user_id: Mapped[int | None] = mapped_column(Integer)
    consume_product_on_execution: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    product_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))


class ChoreLog(Base):
    __tablename__ = "chores_log"
    __table_args__ = (
        *native_checks("chores_log"),
        Index("ix_chores_log_performance1", "chore_id", "undone", "tracked_time"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chore_id: Mapped[int] = mapped_column(ForeignKey("chores.id"), nullable=False)
    tracked_time: Mapped[date | datetime] = mapped_column(DateOrDateTime(), nullable=False)
    scheduled_execution_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    done_by_user_id: Mapped[int | None] = mapped_column(Integer)
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
    __table_args__ = (
        *native_checks("task_categories"),
        {"sqlite_autoincrement": True},
    )

    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        *native_checks("tasks"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    done_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("task_categories.id"))
    assigned_to_user_id: Mapped[int | None] = mapped_column(Integer)


class Battery(Base, TimestampMixin):
    __tablename__ = "batteries"
    __table_args__ = (
        Index("ix_batteries_performance1", "id", "active"),
        *native_checks("batteries"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    used_in: Mapped[str | None] = mapped_column(String(255))
    charge_interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BatteryChargeCycle(Base):
    __tablename__ = "battery_charge_cycles"
    __table_args__ = (
        *native_checks("battery_charge_cycles"),
        {"sqlite_autoincrement": True},
    )

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
