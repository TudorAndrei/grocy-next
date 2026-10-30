import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import moment from "moment/min/moment-with-locales.js";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { loadDateRangePicker, type DateRangePicker } from "@/lib/date-range-picker";
import { ErrorBlock } from "./ErrorBlock";
import { Icon } from "./Icon";
import "@/styles/date-range-picker.css";

type Props = {
  start?: string;
  end?: string;
  onChange: (start: string, end: string) => void;
};

export function DateRangeInput({ start, end, onChange }: Props) {
  const { t, n, ready } = useI18n();
  const features = useFeatures();
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<DateRangePicker>(undefined);
  const id = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const requestedLocale = t("moment_locale");
  const locale = moment.locales().includes(requestedLocale) ? requestedLocale : "en";
  const firstDay = features.query.data?.CALENDAR_FIRST_DAY_OF_WEEK;
  const weekNumbers = features.query.data?.CALENDAR_SHOW_WEEK_OF_YEAR !== false;
  const changed = useEffectEvent(onChange);

  useEffect(() => {
    const target = input.current;

    if (!target || !ready) return;
    let active = true;
    let restore: (() => void) | undefined;
    setLoading(true);
    setError(undefined);
    void loadDateRangePicker()
      .then((Calendar) => {
        if (!active) return;
        const previousLocale = moment.locale();
        const week = moment.localeData(locale);
        const previousWeek = { dow: week.firstDayOfWeek(), doy: week.firstDayOfYear() };
        moment.locale(locale);

        // The legacy page inserts this setting into a quoted JavaScript string.
        const configuredDay =
          firstDay == null || firstDay === false ? "" : firstDay === true ? "1" : String(firstDay);

        if (configuredDay)
          moment.updateLocale(locale, { week: { dow: Number.parseInt(configuredDay, 10) } });
        restore = () => {
          moment.updateLocale(locale, { week: previousWeek });
          moment.locale(previousLocale);
        };

        const from = start ? moment(start) : moment().startOf("month").format("YYYY-MM-DD");
        const to = end ? moment(end) : moment().endOf("month").format("YYYY-MM-DD");
        const ranges: Record<string, [moment.Moment, moment.Moment]> = {};
        ranges[t("Today")] = [moment(), moment()];
        ranges[t("Yesterday")] = [moment().subtract(1, "day"), moment().subtract(1, "day")];

        for (const days of [7, 14, 30])
          ranges[n(days, "Last %1$s day", "Last %1$s days")] = [
            moment().subtract(days - 1, "days"),
            moment(),
          ];
        ranges[t("This month")] = [moment().startOf("month"), moment().endOf("month")];
        ranges[t("Last month")] = [
          moment().subtract(1, "month").startOf("month"),
          moment().subtract(1, "month").endOf("month"),
        ];
        ranges[t("This year")] = [moment().startOf("year"), moment().endOf("year")];
        ranges[t("Last year")] = [
          moment().subtract(1, "year").startOf("year"),
          moment().subtract(1, "year").endOf("year"),
        ];

        let keyEvent: KeyboardEvent | undefined;

        const calendar = new Calendar(
          target,
          {
            showDropdowns: true,
            alwaysShowCalendars: true,
            buttonClasses: "btn",
            applyButtonClasses: "btn-primary",
            cancelButtonClasses: "btn-secondary",
            startDate: from,
            endDate: to,
            showWeekNumbers: weekNumbers,
            locale: { format: "YYYY-MM-DD", firstDay },
            ranges,
          },
          (from, to) => {
            if (active) {
              // A legacy reload cancels Tab's default focus move after a changed range.
              if (keyEvent?.keyCode === 9 && keyEvent.eventPhase !== Event.NONE)
                keyEvent.preventDefault();
              changed(from.format("YYYY-MM-DD"), to.format("YYYY-MM-DD"));
            }
          },
        );

        picker.current = calendar;
        const popup = calendar.container[0];

        if (popup) {
          popup.classList.add("native-date-range");
          popup.setAttribute("role", "dialog");
          popup.setAttribute("aria-label", t("Date range"));
          popup.hidden = true;
          popup
            .querySelector('[data-range-key="Custom Range"]')
            ?.replaceChildren(t("Custom range"));

          const labelMonths = () => {
            for (const [side, label] of [
              ["left", "Start date"],
              ["right", "End date"],
            ] as const) {
              popup
                .querySelector(`.${side} .monthselect`)
                ?.setAttribute("aria-label", `${t(label)}: ${t("Month")}`);
              popup
                .querySelector(`.${side} .yearselect`)
                ?.setAttribute("aria-label", `${t(label)}: ${t("Year")}`);
            }
          };

          popup.addEventListener("click", labelMonths);
          popup.addEventListener("change", labelMonths);
          target.addEventListener("keyup", labelMonths);

          const rememberKey = (event: KeyboardEvent) => {
            keyEvent = event;
          };

          target.addEventListener("keydown", rememberKey, true);
          calendar.element.on("show.daterangepicker", () => {
            popup.hidden = false;
            labelMonths();
            setExpanded(true);
          });
          calendar.element.on("hide.daterangepicker", () => {
            popup.hidden = true;
            setExpanded(false);
          });
          calendar.element.on("cancel.daterangepicker", () => {
            target.value = from.valueOf() + " - " + to.valueOf();
          });
          const restoreLocale = restore;
          restore = () => {
            target.removeEventListener("keyup", labelMonths);
            target.removeEventListener("keydown", rememberKey, true);
            restoreLocale();
          };
        }

        setLoading(false);
      })
      .catch((error: Error) => {
        if (active) {
          restore?.();
          restore = undefined;
          setError(error);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      picker.current?.hide();
      picker.current?.remove();
      picker.current = undefined;
      restore?.();
    };
  }, [start, end, locale, firstDay, weekNumbers, ready, t, n, attempt]);

  return (
    <div className="field report-date-range">
      <label htmlFor={id}>{t("Date range")}</label>
      <div className="booking-date-input">
        <input
          ref={input}
          id={id}
          type="text"
          autoComplete="off"
          disabled={loading || !!error || !ready}
          aria-haspopup="dialog"
          aria-expanded={expanded}
        />
        <button
          type="button"
          tabIndex={-1}
          className="btn booking-date-button"
          aria-label={`${t("Date range")}: ${t("Calendar")}`}
          disabled={loading || !!error || !ready}
          onClick={() => {
            input.current?.focus();
            picker.current?.show();
          }}
        >
          <Icon name="calendar" />
        </button>
      </div>
      {error ? (
        <>
          <ErrorBlock message={t(error.message)} />
          <button type="button" className="btn" onClick={() => setAttempt(attempt + 1)}>
            {t("Retry calendar")}
          </button>
        </>
      ) : null}
    </div>
  );
}
