"""Calendar time zone components for the event range, as in Grocy's iCal library."""

from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo


def _offset(value: timedelta | None) -> str:
    seconds = int(value.total_seconds()) if value else 0
    hours, remainder = divmod(abs(seconds), 3600)
    minutes, seconds_part = divmod(remainder, 60)
    suffix = f"{seconds_part:02}" if seconds_part else ""
    return f"{'-' if seconds < 0 else '+'}{hours:02}{minutes:02}{suffix}"


@lru_cache(maxsize=32)
def timezone_component(zone: ZoneInfo, begin: datetime, end: datetime) -> tuple[str, ...]:
    start, stop = int(begin.timestamp()), int(end.timestamp())
    transitions = [start]
    cursor = start
    while cursor < stop:
        following = min(cursor + 86400, stop)
        offset = datetime.fromtimestamp(cursor, zone).utcoffset()
        if datetime.fromtimestamp(following, zone).utcoffset() != offset:
            before, after = cursor, following
            while after - before > 1:
                middle = (before + after) // 2
                if datetime.fromtimestamp(middle, zone).utcoffset() == offset:
                    before = middle
                else:
                    after = middle
            if after < stop:
                transitions.append(after)
            cursor = after
        else:
            cursor = following
    lines = ["BEGIN:VTIMEZONE", f"TZID:{zone.key}"]
    for timestamp in transitions:
        local = datetime.fromtimestamp(timestamp, zone)
        previous = datetime.fromtimestamp(timestamp - 1, zone)
        kind = "DAYLIGHT" if local.dst() else "STANDARD"
        lines.extend(
            [
                f"BEGIN:{kind}",
                f"DTSTART:{local.strftime('%Y%m%dT%H%M%S')}",
                f"TZNAME:{local.tzname()}",
                f"TZOFFSETTO:{_offset(local.utcoffset())}",
                f"TZOFFSETFROM:{_offset(previous.utcoffset())}",
                f"END:{kind}",
            ]
        )
    return (*lines, "END:VTIMEZONE")
