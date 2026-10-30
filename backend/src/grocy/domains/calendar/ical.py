"""iCalendar output with the pinned eluceo/ical presentation rules."""

import re
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from grocy.compatibility.php import argument_error, empty, php_error, php_string

_EPOCH = datetime(1970, 1, 1)
_UTC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_FIRST_WALL = datetime(1, 1, 2)
_LAST_WALL = datetime(9999, 12, 30)
_FIRST = int((datetime(1, 1, 2, tzinfo=UTC) - _UTC_EPOCH).total_seconds())
_LAST = int((datetime(9999, 12, 30, tzinfo=UTC) - _UTC_EPOCH).total_seconds())
_SCAN = 7 * 86400
_DAY = re.compile(r"([0-9]{1,4})-([0-9]{1,2})-([0-9]{1,2})")
_MOMENT = re.compile(r"([0-9]{1,4})-([0-9]{1,2})-([0-9]{1,2}) ([0-9]{1,2}):([0-9]{2}):([0-9]{2})")
_ESCAPES = (("\\", "\\\\"), (";", "\\;"), (",", "\\,"), ("\n", "\\n"), ("\\\\n", "\\n"))
_FORBIDDEN = dict.fromkeys([*range(0x0A), *range(0x0B, 0x20), 0x7F])


def _days(year: int, month: int, day: int) -> int:
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    shifted = year - (month <= 2)
    era = shifted // 400
    year_of_era = shifted - era * 400
    day_of_year = (153 * ((month + 9) % 12) + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    return era * 146097 + day_of_era - 719468


def _civil(days: int) -> tuple[int, int, int]:
    days += 719468
    era = days // 146097
    day_of_era = days - era * 146097
    year_of_era = (
        day_of_era - day_of_era // 1460 + day_of_era // 36524 - day_of_era // 146096
    ) // 365
    day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4 - year_of_era // 100)
    shifted_month = (5 * day_of_year + 2) // 153
    day = day_of_year - (153 * shifted_month + 2) // 5 + 1
    month = shifted_month + 3 if shifted_month < 10 else shifted_month - 9
    return year_of_era + era * 400 + (month <= 2), month, day


def _stamp(local: int, *, time: bool) -> str:
    days, seconds = divmod(local, 86400)
    year, month, day = _civil(days)
    text = f"{'-' if year < 0 else ''}{abs(year):04d}{month:02d}{day:02d}"
    if time:
        text += f"T{seconds // 3600:02d}{seconds // 60 % 60:02d}{seconds % 60:02d}"
    return text


def _state(zone: ZoneInfo, instant: int) -> tuple[int, bool, str]:
    moment = (_UTC_EPOCH + timedelta(seconds=min(max(instant, _FIRST), _LAST))).astimezone(zone)
    offset = moment.utcoffset()
    return (
        int(offset.total_seconds()) if offset is not None else 0,
        bool(moment.dst()),
        moment.tzname() or "",
    )


def _instant(zone: ZoneInfo, local: int) -> int:
    try:
        wall = _EPOCH + timedelta(seconds=local)
    except OverflowError:
        wall = _FIRST_WALL if local < 0 else _LAST_WALL
    offset = wall.replace(tzinfo=zone).utcoffset()
    return local - (int(offset.total_seconds()) if offset is not None else 0)


def _text(value: Any) -> str:
    text = php_string(value)
    for search, replacement in _ESCAPES:
        text = text.replace(search, replacement)
    return text.translate(_FORBIDDEN)


def _fold(line: str) -> str:
    data = line.encode()
    parts = []
    while len(data) > 75:
        cut = 75
        while cut > 0 and data[cut] & 0xC0 == 0x80:
            cut -= 1
        parts.append(data[:cut])
        data = b" " + data[cut:]
    parts.append(data)
    return b"\r\n".join(parts).decode() + "\r\n"


def _offset(seconds: int) -> str:
    hours = abs(seconds) // 3600
    minutes = abs(seconds) // 60 - hours * 60
    return f"{'+' if seconds >= 0 else '-'}{hours:02d}{minutes:02d}"


def _transitions(zone: ZoneInfo, begin: int, end: int) -> list[tuple[int, tuple[int, bool, str]]]:
    current = _state(zone, begin)
    found = [(begin, current)]
    cursor = max(begin, _FIRST)
    limit = min(end, _LAST)
    while cursor < limit:
        following = min(cursor + _SCAN, limit)
        if _state(zone, following) == current:
            cursor = following
            continue
        low, high = cursor, following
        while high - low > 1:
            middle = (low + high) // 2
            if _state(zone, middle) == current:
                low = middle
            else:
                high = middle
        current = _state(zone, high)
        if high < end:
            found.append((high, current))
        cursor = high
    return found


def _timezone(zone: ZoneInfo, begin: int, end: int) -> list[str]:
    lines = ["BEGIN:VTIMEZONE", f"TZID:{_text(zone.key)}"]
    for instant, (offset, daylight, name) in _transitions(zone, begin, end):
        # The pinned PHP ISO8601 parser cannot read signed or expanded UTC years.
        if not 0 <= _civil(instant // 86400)[0] <= 9999:
            raise php_error("Call to a member function setTimezone() on false")
        kind = "DAYLIGHT" if daylight else "STANDARD"
        lines += [
            f"BEGIN:{kind}",
            f"DTSTART:{_stamp(instant + offset, time=True)}",
            f"TZNAME:{_text(name)}",
            f"TZOFFSETTO:{_offset(offset)}",
            f"TZOFFSETFROM:{_offset(_state(zone, instant - 1)[0])}",
            f"END:{kind}",
        ]
    return [*lines, "END:VTIMEZONE"]


def _parts(pattern: re.Pattern[str], value: str) -> list[int] | None:
    match = pattern.fullmatch(value)
    return None if match is None else [int(part) for part in match.groups()]


def calendar(events: list[dict[str, Any]], zone: ZoneInfo, now: datetime) -> str:
    stamp = now.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    wall = now.astimezone(zone)
    clock = wall.hour * 3600 + wall.minute * 60 + wall.second
    parameter = "" if zone.key == "UTC" else f";TZID={_text(zone.key)}"
    suffix = "Z" if zone.key == "UTC" else ""
    lines = ["BEGIN:VCALENDAR", "PRODID:Grocy", "VERSION:2.0", "CALSCALE:GREGORIAN"]
    instants: list[int] = []
    for event in events:
        start = event.get("start")
        if start is None or empty(start):
            continue
        start = php_string(start)
        if event["date_format"] == "date" or event.get("allDay"):
            day = _parts(_DAY, start[:10])
            if day is None:
                raise argument_error(
                    "Eluceo\\iCal\\Domain\\ValueObject\\PointInTime::__construct",
                    1,
                    "dateTime",
                    "?DateTimeInterface",
                    False,
                )
            local = _days(*day) * 86400
            occurrence = [f"DTSTART;VALUE=DATE:{_stamp(local, time=False)}"]
            instant = _instant(zone, local + clock)
        else:
            moment = _parts(_MOMENT, start)
            if moment is None:
                raise argument_error(
                    "Eluceo\\iCal\\Domain\\ValueObject\\DateTime::__construct",
                    1,
                    "phpDateTime",
                    "DateTimeInterface",
                    False,
                )
            year, month, day, hour, minute, second = moment
            instant = _instant(
                zone, _days(year, month, day) * 86400 + hour * 3600 + minute * 60 + second
            )
            value = _stamp(instant + _state(zone, instant)[0], time=True) + suffix
            occurrence = [f"DTSTART{parameter}:{value}", f"DTEND{parameter}:{value}"]
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uuid4().hex}",
            f"DTSTAMP:{stamp}",
            f"SUMMARY:{_text(event['title'])}",
            f"DESCRIPTION:{_text(event.get('description', ''))}",
            *occurrence,
            "END:VEVENT",
        ]
        instants.append(instant)
    if instants:
        lines += _timezone(zone, min(instants), max(instants))
    lines.append("END:VCALENDAR")
    return "".join(_fold(line) for line in lines)
