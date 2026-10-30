import moment from "moment/min/moment-with-locales.js";
import { useI18n } from "@/lib/i18n";
import type { JsonValue } from "@/lib/json";
import { Icon } from "./Icon";

export type CalendarView = "days" | "months" | "years" | "decades";

type Props = {
  id: string;
  label: string;
  date: number;
  view: CalendarView;
  selected: string;
  locale: string;
  firstDayOfWeek?: JsonValue;
  weekNumbers: boolean;
  above: boolean;
  onDate: (date: number) => void;
  onView: (view: CalendarView) => void;
  onSelect: (date: string) => void;
  onToday: () => void;
  onClose: () => void;
};

function weekNumber(date: moment.Moment, firstDay: number, firstWeekDay: number) {
  const offset = (year: number) => {
    const first = 7 + firstDay - firstWeekDay;
    const weekday = (7 + moment.utc([year, 0, first]).day() - firstDay) % 7;

    return first - weekday - 1;
  };

  const weeks = (year: number) =>
    ((moment([year]).isLeapYear() ? 366 : 365) - offset(year) + offset(year + 1)) / 7;

  const year = date.year();
  const number = Math.floor((date.dayOfYear() - offset(year) - 1) / 7) + 1;

  if (number < 1) return number + weeks(year - 1);

  return number > weeks(year) ? number - weeks(year) : number;
}

export function BookingCalendar(props: Props) {
  const { t } = useI18n();
  const date = moment(props.date).locale(props.locale);
  const selected = moment(props.selected, "YYYY-MM-DD", props.locale, true);
  const now = moment().locale(props.locale);
  const maximum = moment("2999-12-31 23:59:59");

  const configuredDay = props.firstDayOfWeek
    ? Number.parseInt(String(props.firstDayOfWeek), 10)
    : NaN;

  const firstDay =
    Number.isInteger(configuredDay) && configuredDay >= 0 && configuredDay <= 6
      ? configuredDay
      : date.localeData().firstDayOfWeek();

  const first = date.clone().startOf("month").startOf("day");
  first.subtract((first.day() - firstDay + 7) % 7, "days");
  const decade = Math.floor(date.year() / 10) * 10;
  const century = Math.floor(date.year() / 100) * 100;
  const views: CalendarView[] = ["days", "months", "years", "decades"];
  const index = views.indexOf(props.view);

  const header =
    props.view === "days"
      ? date.format("MMMM YYYY")
      : props.view === "months"
        ? String(date.year())
        : props.view === "years"
          ? `${decade}-${decade + 9}`
          : `${century}-${century + 90}`;

  const previous = ["Previous Month", "Previous Year", "Previous Decade", "Previous Century"][
    index
  ]!;

  const next = ["Next Month", "Next Year", "Next Decade", "Next Century"][index]!;
  const switchLabel = ["Select Month", "Select Year", "Select Decade", header][index]!;
  const previousDisabled = props.view === "decades" && century === 0;

  const nextDisabled =
    props.view === "days"
      ? date.clone().add(1, "month").isAfter(maximum, "month")
      : props.view === "months"
        ? date.clone().add(1, "year").isAfter(maximum, "year")
        : props.view === "years"
          ? decade + 9 > maximum.year()
          : century + 90 > maximum.year();

  function navigate(direction: number) {
    const amount =
      props.view === "days" || props.view === "months" ? 1 : props.view === "years" ? 10 : 100;

    props.onDate(
      date
        .clone()
        .add(direction * amount, props.view === "days" ? "months" : "years")
        .valueOf(),
    );
  }

  const choices: {
    text: string;
    year: number;
    month?: number;
    active: boolean;
    disabled: boolean;
    old?: boolean;
  }[] = [];

  if (props.view === "months") {
    for (let month = 0; month < 12; month++) {
      const candidate = date.clone().startOf("year").month(month);
      choices.push({
        text: candidate.format("MMM"),
        year: date.year(),
        month,
        active: selected.isSame(candidate, "month"),
        disabled: candidate.isAfter(maximum, "month"),
      });
    }
  } else if (props.view === "years") {
    for (let year = decade - 1; year <= decade + 10; year++) {
      choices.push({
        text: String(year),
        year,
        active: year >= decade && year <= decade + 9 && selected.year() === year,
        disabled: (year === decade - 1 ? decade : year) > maximum.year(),
        old: year < decade || year > decade + 9,
      });
    }
  } else if (props.view === "decades") {
    const start = date.clone().year(century);
    choices.push({
      text: century - 10 < 0 ? "" : String(century - 10),
      year: century + 6,
      active: false,
      disabled: century - 10 < 0,
      old: true,
    });

    for (let part = 0; part < 10; part++) {
      const year = start.year();
      choices.push({
        text: String(year),
        year: year + 6,
        active: selected.isAfter(start) && selected.year() <= year + 11,
        disabled:
          start.isAfter(maximum, "year") &&
          !(maximum.isAfter(start, "year") && maximum.year() <= year + 11),
      });
      start.add(10, "years");
    }

    choices.push({
      text: String(start.year()),
      year: start.year() + 6,
      active: false,
      disabled: false,
      old: true,
    });
  }

  return (
    <div
      id={props.id}
      role="dialog"
      aria-label={props.label}
      className={`booking-calendar${props.above ? " is-above" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="booking-calendar-nav">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t(previous)}
          title={t(previous)}
          disabled={previousDisabled}
          onClick={() => navigate(-1)}
        >
          <Icon name="back" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t(switchLabel)}
          title={t(switchLabel)}
          onClick={() => props.onView(views[Math.min(3, index + 1)]!)}
        >
          {header}
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t(next)}
          title={t(next)}
          disabled={nextDisabled}
          onClick={() => navigate(1)}
        >
          <Icon name="back" className="calendar-next" />
        </button>
      </div>
      {props.view === "days" ? (
        <table aria-label={header}>
          <thead>
            <tr>
              {props.weekNumbers ? <th scope="col">#</th> : null}
              {Array.from({ length: 7 }, (_, day) => (
                <th key={day} scope="col">
                  {first.clone().add(day, "days").format("dd")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => {
              const start = first.clone().add(week * 7, "days");

              return (
                <tr key={week}>
                  {props.weekNumbers ? (
                    <th scope="row" className="booking-calendar-week">
                      {weekNumber(start, firstDay, date.localeData().firstDayOfYear())}
                    </th>
                  ) : null}
                  {Array.from({ length: 7 }, (_, day) => {
                    const candidate = start.clone().add(day, "days");
                    const active = selected.isSame(candidate, "day");
                    const today = candidate.isSame(now, "day");
                    const other = !candidate.isSame(date, "month");

                    return (
                      <td key={day}>
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={candidate.format("LL")}
                          aria-pressed={active}
                          aria-current={today ? "date" : undefined}
                          disabled={candidate.isAfter(maximum, "day")}
                          className={`${other ? "is-other " : ""}${active ? "is-selected " : ""}${today ? "is-today" : ""}`}
                          onClick={() => props.onSelect(candidate.format("YYYY-MM-DD"))}
                        >
                          {candidate.date()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="booking-calendar-choices">
          {choices.map((choice, position) =>
            choice.text ? (
              <button
                key={position}
                type="button"
                tabIndex={-1}
                disabled={choice.disabled}
                aria-pressed={choice.active}
                className={`${choice.old ? "is-other " : ""}${choice.active ? "is-selected" : ""}`}
                onClick={() => {
                  props.onDate(
                    date
                      .clone()
                      .year(choice.year)
                      .month(choice.month ?? date.month())
                      .valueOf(),
                  );
                  props.onView(views[index - 1]!);
                }}
              >
                {choice.text}
              </button>
            ) : (
              <span key={position} aria-hidden="true" />
            ),
          )}
        </div>
      )}
      <div className="booking-calendar-actions">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("Go to today")}
          title={t("Go to today")}
          onClick={props.onToday}
        >
          <Icon name="today" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("Close the picker")}
          title={t("Close the picker")}
          onClick={props.onClose}
        >
          <Icon name="check" />
        </button>
      </div>
    </div>
  );
}
