from datetime import date, timedelta

from grocy.db.dates import parse_date


def test_year_zero_date_arithmetic_keeps_the_gregorian_leap_day_and_year_boundary():
    leap_day = parse_date("0000-02-28") + timedelta(days=1)
    assert leap_day.isoformat() == "0000-02-29"
    assert (leap_day + timedelta(days=1)).isoformat() == "0000-03-01"
    last_day = parse_date("0000-12-31")
    first_day = last_day + timedelta(days=1)
    assert first_day == date(1, 1, 1)
    assert hash(first_day) == hash(date(1, 1, 1))
    assert (first_day - timedelta(days=1)) == last_day
    assert last_day < date(1, 1, 1)
    assert date(1, 1, 1) - parse_date("0000-01-01") == timedelta(days=366)
