"""Generate schedule expectations from the pinned Grocy SQLite views."""

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def generate(source: Path, output: Path) -> None:
    if json.loads((source / "version.json").read_text())["Version"] != "4.5.0":
        raise ValueError("Expected Grocy v4.5.0 source")
    sql = (source / "migrations/0167.sql").read_text()
    cases = [
        ("first execution", {"period_type": "daily", "period_interval": 3}, []),
        (
            "hourly interval",
            {"period_type": "hourly", "period_interval": 3},
            ["2027-01-04 10:30:00"],
        ),
        (
            "daily interval",
            {"period_type": "daily", "period_interval": 2},
            ["2027-01-04 10:30:00"],
        ),
        (
            "weekly weekdays",
            {"period_type": "weekly", "period_config": "monday,thursday"},
            ["2027-01-04 10:30:00"],
        ),
        (
            "alternate weeks",
            {"period_type": "weekly", "period_interval": 2, "period_config": "tuesday"},
            ["2027-01-04 10:30:00"],
        ),
        (
            "monthly day",
            {"period_type": "monthly", "period_days": 15},
            ["2027-01-28 10:30:00"],
        ),
        (
            "monthly overflow",
            {"period_type": "monthly", "period_days": 31},
            ["2027-01-28 10:30:00"],
        ),
        (
            "yearly anniversary",
            {"period_type": "yearly", "start_date": "2026-07-04 10:00:00"},
            ["2027-01-04 10:30:00"],
        ),
        (
            "date only",
            {"period_type": "daily", "track_date_only": 1},
            ["2027-01-04 00:00:00"],
        ),
        ("manual after tracking", {"period_type": "manually"}, ["2027-01-04 10:30:00"]),
        (
            "overdue daily rollover",
            {"period_type": "daily", "rollover": 1},
            ["2020-01-01 10:30:00"],
        ),
        (
            "date-only rollover",
            {"period_type": "daily", "rollover": 1, "track_date_only": 1},
            ["2020-01-01 00:00:00"],
        ),
        (
            "adaptive duplicate executions",
            {"period_type": "adaptive"},
            [
                "2027-01-01 10:00:00",
                "2027-01-03 10:00:00",
                "2027-01-03 10:00:00",
                "2027-01-07 10:00:00",
            ],
        ),
        (
            "adaptive frequency",
            {"period_type": "adaptive"},
            ["2027-01-01 10:00:00", "2027-01-03 10:00:00", "2027-01-07 10:00:00"],
        ),
    ]
    with sqlite3.connect(":memory:") as conn:
        conn.executescript("""
            CREATE TABLE chores (id INTEGER PRIMARY KEY, name TEXT, period_type TEXT,
                period_interval INTEGER, period_days INTEGER, period_config TEXT,
                start_date TEXT, track_date_only INTEGER, rollover INTEGER, active INTEGER,
                next_execution_assigned_to_user_id INTEGER);
            CREATE TABLE chores_log (id INTEGER PRIMARY KEY, chore_id INTEGER, tracked_time TEXT,
                undone INTEGER DEFAULT 0);
            CREATE VIEW chores_current AS SELECT id FROM chores;
        """)
        conn.executescript(sql)
        results = []
        for index, (name, fields, times) in enumerate(cases, start=1):
            body = {
                "name": name,
                "period_type": "daily",
                "period_interval": 1,
                "period_days": 1,
                "period_config": None,
                "start_date": "2027-01-01 10:00:00",
                "track_date_only": 0,
                "rollover": 0,
                "active": 1,
                **fields,
            }
            keys = ["id", *body]
            conn.execute(
                "INSERT INTO chores ("
                + ",".join(keys)
                + ") VALUES ("
                + ",".join("?" for _ in keys)
                + ")",
                [index, *body.values()],
            )
            for tracked in times:
                conn.execute(
                    "INSERT INTO chores_log (chore_id, tracked_time) VALUES (?, ?)",
                    (index, tracked),
                )
            next_time = conn.execute(
                "SELECT next_estimated_execution_time FROM chores_current WHERE chore_id=?",
                (index,),
            ).fetchone()[0]
            results.append(
                {
                    "name": name,
                    "chore": body,
                    "tracked_times": times,
                    "next_execution": "TODAY" + next_time[10:]
                    if body["rollover"]
                    else next_time,
                }
            )
    output.write_text(
        json.dumps(
            {
                "baseline": "v4.5.0",
                "source": "migrations/0167.sql",
                "source_sha256": hashlib.sha256(sql.encode()).hexdigest(),
                "cases": results,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    generate(args.source, args.output)
