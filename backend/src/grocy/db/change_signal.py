"""Publish SQLite business commits through Grocy's existing database-file timestamp.

WAL commits do not normally touch that file. Credential-use updates are excluded,
and a file lock bridges COMMIT and timestamp publication across application workers.
No auxiliary database schema or persisted change counter is required.
"""

import asyncio
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from weakref import WeakKeyDictionary

from sqlalchemy import event
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, SessionTransaction

try:
    import fcntl
except ImportError:  # Windows has no flock; the release Linux runtime does.
    fcntl = None

AUTHENTICATION_WRITE = {"grocy_authentication_write": True}
_STATE = "grocy_change_signal"
_local_locks: dict[Path, threading.Lock] = {}
_engines: WeakKeyDictionary[Engine, tuple[Path, float]] = WeakKeyDictionary()


def _fingerprint(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
        return stat.st_mtime_ns, stat.st_size
    except FileNotFoundError:
        return None


def _count(connection: Connection) -> int:
    driver = connection.connection.driver_connection
    assert driver is not None
    return driver.total_changes


@dataclass
class _Changes:
    connection: Connection
    initial: int
    path: Path
    timeout: float
    connection_info: dict[str, Any]
    authentication: int = 0
    discarded: int = 0
    savepoints: dict[SessionTransaction, tuple[int, int, int]] = field(default_factory=dict)
    descriptor: int | None = None
    local_lock: threading.Lock | None = None
    previous: os.stat_result | None = None
    wal: tuple[int, int] | None = None

    @property
    def count(self) -> int:
        return _count(self.connection)

    @property
    def business(self) -> bool:
        return self.count > self.initial + self.authentication + self.discarded

    def release(self) -> None:
        if self.descriptor is not None:
            os.close(self.descriptor)  # Closing also releases flock, including error paths.
            self.descriptor = None
        if self.local_lock is not None:
            self.local_lock.release()
            self.local_lock = None


class ChangeTrackedSession(Session):
    """Application sessions share one SQLite transaction/change-publication boundary."""


async def _acquire(changes: _Changes) -> None:
    try:
        async with asyncio.timeout(changes.timeout):
            if fcntl is not None:
                changes.descriptor = os.open(changes.path, os.O_RDONLY)
                while True:
                    try:
                        fcntl.flock(changes.descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        await asyncio.sleep(0.005)
            else:
                lock = _local_locks.setdefault(changes.path, threading.Lock())
                while not lock.acquire(blocking=False):
                    await asyncio.sleep(0.005)
                changes.local_lock = lock
        # SQL already owns SQLite's writer lock. A previous writer's publication
        # has now finished, so auth cannot restore an earlier business timestamp.
        changes.previous = changes.path.stat()
        changes.wal = _fingerprint(Path(str(changes.path) + "-wal"))
    except BaseException:
        changes.release()
        raise


def _prepare(changes: _Changes) -> None:
    if changes.previous is not None or changes.count == changes.initial:
        return
    database: Any = changes.connection.connection.dbapi_connection
    database.run_async(lambda _driver: _acquire(changes))


def install_change_signal(engine: Engine, path: Path, timeout: float) -> None:
    _engines[engine] = path, timeout
    if fcntl is None:
        logging.getLogger(__name__).warning(
            "Cross-process database change locking is unavailable; use one application worker"
        )

    @event.listens_for(engine, "before_cursor_execute")
    def before_statement(connection, _cursor, statement, _parameters, context, _many):
        changes = connection.info.get(_STATE)
        if changes is None:
            return
        context.grocy_changes_before = changes.count
        # Native PDO executes COMMIT as SQL before Session.commit(). Protect its
        # physical boundary too; the later session callback publishes/releases.
        if statement.strip().rstrip(";").upper() in {"COMMIT", "END"}:
            _prepare(changes)

    @event.listens_for(engine, "after_cursor_execute")
    def after_statement(connection, _cursor, _statement, _parameters, context, _many):
        changes = connection.info.get(_STATE)
        if changes is not None and context.execution_options.get("grocy_authentication_write"):
            changes.authentication += changes.count - context.grocy_changes_before


@event.listens_for(ChangeTrackedSession, "after_begin")
def _begin(session: Session, transaction: SessionTransaction, connection: Connection) -> None:
    options = _engines.get(connection.engine)
    if options is None:
        return
    changes = session.info.get(_STATE)
    if transaction.parent is None:
        path, timeout = options
        changes = _Changes(
            connection,
            _count(connection),
            path,
            timeout,
            connection.info,
        )
        session.info[_STATE] = changes
        connection.info[_STATE] = changes
    elif transaction.nested and changes is not None:
        changes.savepoints[transaction] = (
            changes.count,
            changes.authentication,
            changes.discarded,
        )


@event.listens_for(ChangeTrackedSession, "before_commit")
def _before_commit(session: Session) -> None:
    if session.in_nested_transaction():
        return
    session.flush()
    changes = session.info.get(_STATE)
    if changes is not None:
        _prepare(changes)


@event.listens_for(ChangeTrackedSession, "after_commit")
def _committed(session: Session) -> None:
    if session.in_nested_transaction():
        return
    changes = session.info.get(_STATE)
    if changes is None or changes.previous is None:
        return
    path = changes.path
    try:
        physical_change = (
            path.stat().st_mtime_ns != changes.previous.st_mtime_ns
            or _fingerprint(Path(str(path) + "-wal")) != changes.wal
        )
        if changes.business and physical_change:
            os.utime(path, None)
        elif not changes.business:
            os.utime(path, ns=(changes.previous.st_atime_ns, changes.previous.st_mtime_ns))
    except OSError:
        # Data is already durable. Failure of this derived notification must not
        # report an unsuccessful booking and invite a duplicate retry.
        logging.getLogger(__name__).exception("Could not publish committed database change time")
    finally:
        changes.release()


@event.listens_for(ChangeTrackedSession, "after_soft_rollback")
def _savepoint_rolled_back(session: Session, transaction: SessionTransaction) -> None:
    changes = session.info.get(_STATE)
    if changes is not None and transaction in changes.savepoints:
        initial, authentication, discarded = changes.savepoints.pop(transaction)
        changes.discarded += (
            changes.count
            - initial
            - (changes.authentication - authentication)
            - (changes.discarded - discarded)
        )


@event.listens_for(ChangeTrackedSession, "after_transaction_end")
def _end(session: Session, transaction: SessionTransaction) -> None:
    if transaction.parent is not None:
        return
    changes = session.info.pop(_STATE, None)
    if changes is not None:
        changes.release()
        if changes.connection_info.get(_STATE) is changes:
            changes.connection_info.pop(_STATE)
