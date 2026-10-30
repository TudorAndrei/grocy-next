import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import moment from "moment/min/moment-with-locales.js";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";
import { contextualDateText } from "@/lib/header-clock";
import type { JsonValue } from "@/lib/json";
import { BookingCalendar, type CalendarView } from "./BookingCalendar";

const FORMAT = "YYYY-MM-DD";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  readOnly?: boolean;
  numeric?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  initialCalendarValue?: string;
  onShortcut?: () => void;
  onCommit?: () => void;
  parseOnBlur?: boolean;
  showInitialContext?: boolean;
  firstDayOfWeek?: JsonValue;
  weekNumbers?: boolean;
};

export function BookingDateInput({
  id,
  label,
  value,
  onChange,
  required = false,
  readOnly = false,
  numeric = false,
  inputRef,
  initialCalendarValue = "",
  onShortcut,
  onCommit,
  parseOnBlur = true,
  showInitialContext = true,
  firstDayOfWeek,
  weekNumbers = true,
}: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => input.current!);
  const calendarOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<CalendarView>("days");
  const [viewDate, setViewDate] = useState(Date.now);
  const [above, setAbove] = useState(false);
  const [contextReady, setContextReady] = useState(showInitialContext);
  const cached = useRef(initialCalendarValue);
  const observed = useRef(value);
  const dirty = useRef(false);
  const neverValidated = useRef(false);
  const selectedLocale = t("moment_locale");
  const locale = moment.locales().includes(selectedLocale) ? selectedLocale : "en";
  const parse = (source: string, strict = true) => moment(source, FORMAT, locale, strict);

  function validate(source: string) {
    if (parse(source).isValid()) input.current?.setCustomValidity("");
    else if (required) input.current?.setCustomValidity("error");

    if (source !== "2999-12-31") neverValidated.current = false;
    else if (!neverValidated.current) {
      neverValidated.current = true;
      onShortcut?.();
    }
  }

  function change(next: string) {
    setContextReady(true);
    observed.current = next;

    if (input.current) input.current.value = next;
    onChange(next);
  }

  useLayoutEffect(() => {
    if (observed.current === value) return;
    observed.current = value;

    if (!value) cached.current = "";

    if (calendarOpen.current) closeCalendar();
    validate(value);
  });

  useEffect(() => {
    if (!open) return;

    const reposition = () => {
      const bounds = input.current?.getBoundingClientRect();
      const height = document.getElementById(`${id}-calendar`)?.getBoundingClientRect().height;

      if (bounds && height)
        setAbove(bounds.bottom + height + 4 > window.innerHeight && bounds.top >= height + 4);
    };

    window.addEventListener("resize", reposition);

    return () => window.removeEventListener("resize", reposition);
  }, [id, open, input]);

  function keyUp(event: KeyboardEvent<HTMLInputElement>) {
    setContextReady(true);
    closeCalendar();
    const source = event.currentTarget.value;
    const arrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key);
    const now = moment().locale(locale);
    let next = source;
    let advance = false;
    const century = Math.trunc(new Date().getFullYear() / 100) * 100;
    const number = Number.parseInt(source, 10);

    if (!source && arrow) {
      next = now.format(FORMAT);
      advance = true;
    } else if (source.toLowerCase() === "x") {
      next = moment("2999-12-31").locale(locale).format(FORMAT);
      advance = true;
    } else if (source.length === 4 && !(number > century && number < century + 99)) {
      const date = moment(String(new Date().getFullYear()) + source).locale(locale);

      if (date.isBefore(now)) date.add(1, "year");
      next = date.format(FORMAT);
      advance = true;
    } else if (/^\d{8}$/.test(source)) {
      next = source.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
      advance = true;
    } else if (/^\d{6}[e+]$/i.test(source)) {
      next = moment(`${source.slice(0, 4)}-${source.slice(4, 6)}-01`)
        .locale(locale)
        .endOf("month")
        .format(FORMAT);
      advance = true;
    } else if (/^[+-].*[dmy]$/i.test(source)) {
      const amount = Number.parseInt(source.slice(1, -1), 10) * (source[0] === "-" ? -1 : 1);
      const suffix = source.slice(-1).toLowerCase();
      const unit = suffix === "d" ? "days" : suffix === "m" ? "months" : "years";
      next = now.add(amount, unit).format(FORMAT);
    } else if (arrow && parse(source).isValid()) {
      const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      const unit = event.shiftKey ? (vertical ? "months" : "years") : vertical ? "days" : "weeks";
      next = parse(source).add(direction, unit).format(FORMAT);
    }

    if (next !== source) change(next);

    if (advance) onShortcut?.();
    validate(input.current?.value ?? next);
  }

  function commit(force = false) {
    if (!dirty.current && !force) return;
    const changed = dirty.current;
    dirty.current = false;
    const source = input.current?.value.trim() ?? value;
    const date = parse(source, false);

    if (!source) cached.current = "";
    else if (date.isValid() && !date.isAfter(moment("2999-12-31 23:59:59")))
      cached.current = date.format(FORMAT);
    change(cached.current);

    if (changed) onCommit?.();
  }

  function closeCalendar() {
    if (!calendarOpen.current) return;
    calendarOpen.current = false;
    setOpen(false);
    commit(true);
    onCommit?.();
    validate(input.current?.value ?? value);

    input.current?.blur();
    const last = parse(cached.current);
    setViewDate(last.isValid() ? last.valueOf() : Date.now());
  }

  function openCalendar() {
    if (calendarOpen.current) {
      closeCalendar();

      return;
    }

    commit(true);
    const last = parse(cached.current);
    setViewDate(last.isValid() ? last.valueOf() : Date.now());
    const bounds = input.current?.getBoundingClientRect();
    const height = calendarView === "days" ? 340 : 232;
    setAbove(!!bounds && bounds.bottom + height > window.innerHeight && bounds.top >= height);
    calendarOpen.current = true;
    setOpen(true);
    input.current?.focus();
  }

  function selectDate(next: string, keepOpen = false) {
    cached.current = next;
    dirty.current = false;
    change(next);
    setViewDate(parse(next).valueOf());

    if (!keepOpen) closeCalendar();
  }

  const calendarLabel = `${label}: ${t("Calendar")}`;
  const context = contextReady ? contextualDateText(value, new Date(), locale, t).relative : "";

  return (
    <div className="booking-date-control">
      <div className="booking-date-input">
        <input
          ref={input}
          id={id}
          type="text"
          inputMode={numeric ? "numeric" : undefined}
          autoComplete="off"
          placeholder={FORMAT}
          required={required}
          aria-describedby={context ? `${id}-context` : undefined}
          readOnly={readOnly}
          value={value}
          onChange={(event) => {
            dirty.current = true;
            change(event.target.value);
          }}
          onKeyUp={keyUp}
          onBlur={() => {
            if (calendarOpen.current) closeCalendar();
            else if (parseOnBlur) commit();
          }}
        />
        <button
          type="button"
          className="btn booking-date-button"
          tabIndex={-1}
          aria-label={calendarLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-calendar` : undefined}
          disabled={readOnly}
          onClick={openCalendar}
        >
          <Icon name="calendar" />
        </button>
        {open ? (
          <BookingCalendar
            id={`${id}-calendar`}
            label={calendarLabel}
            date={viewDate}
            view={calendarView}
            selected={cached.current}
            locale={locale}
            firstDayOfWeek={firstDayOfWeek}
            weekNumbers={weekNumbers}
            above={above}
            onDate={setViewDate}
            onView={setCalendarView}
            onSelect={selectDate}
            onToday={() => selectDate(moment().locale(locale).format(FORMAT), true)}
            onClose={closeCalendar}
          />
        ) : null}
      </div>
      <time
        id={`${id}-context`}
        dateTime={context ? value : undefined}
        className="booking-date-context"
      >
        {context}
      </time>
    </div>
  );
}
