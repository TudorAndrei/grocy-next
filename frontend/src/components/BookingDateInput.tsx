import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
import moment from "moment/min/moment-with-locales.js";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";

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
}: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => input.current!);
  const calendar = useRef<HTMLInputElement>(null);
  const cached = useRef(initialCalendarValue);
  const observed = useRef(value);
  const dirty = useRef(false);
  const selectedLocale = t("moment_locale");
  const locale = moment.locales().includes(selectedLocale) ? selectedLocale : "en";
  const parse = (source: string, strict = true) => moment(source, FORMAT, locale, strict);

  function validate(source: string) {
    if (parse(source).isValid()) input.current?.setCustomValidity("");
    else if (required) input.current?.setCustomValidity("error");
  }

  function change(next: string) {
    observed.current = next;

    if (input.current) input.current.value = next;
    onChange(next);
  }

  useLayoutEffect(() => {
    if (observed.current === value) return;
    observed.current = value;

    if (!value) cached.current = "";
    validate(value);
  });

  function keyUp(event: KeyboardEvent<HTMLInputElement>) {
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

  function blur() {
    if (!dirty.current) return;
    dirty.current = false;
    const source = input.current?.value.trim() ?? value;
    const date = parse(source, false);

    if (!source) cached.current = "";
    else if (date.isValid() && !date.isAfter(moment("2999-12-31 23:59:59")))
      cached.current = date.format(FORMAT);
    change(cached.current);
  }

  return (
    <div className="booking-date-input">
      <input
        ref={input}
        id={id}
        type="text"
        inputMode={numeric ? "numeric" : undefined}
        autoComplete="off"
        placeholder={FORMAT}
        required={required}
        readOnly={readOnly}
        value={value}
        onChange={(event) => {
          dirty.current = true;
          change(event.target.value);
        }}
        onKeyUp={keyUp}
        onBlur={blur}
      />
      <input
        ref={calendar}
        className="booking-date-calendar"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        max="2999-12-31"
        value={parse(value).isValid() ? parse(value).locale("en").format(FORMAT) : ""}
        onChange={(event) => {
          const next = event.target.value;
          cached.current = next;
          change(next);
          validate(next);
        }}
      />
      <button
        type="button"
        className="btn booking-date-button"
        tabIndex={-1}
        aria-label={`${label}: ${t("Calendar")}`}
        disabled={readOnly}
        onClick={() => {
          if (calendar.current?.showPicker) calendar.current.showPicker();
          else calendar.current?.focus();
        }}
      >
        <Icon name="calendar" />
      </button>
    </div>
  );
}
