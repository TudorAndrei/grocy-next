import { useImperativeHandle, useLayoutEffect, useRef, type Ref, type RefObject } from "react";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";
import { useNativeDateTimeInput, type NativeDateTimeHandle } from "@/lib/native-userfield-dates";

export type NativeDateInputProps = {
  id: string;
  name?: string;
  caption: string;
  value: string;
  required: boolean;
  datetime?: boolean;
  numeric?: boolean;
  initWithNow?: boolean;
  initialValue?: string;
  nextInputSelector?: string;
  showInitialContext?: boolean;
  limitEndToNow?: boolean;
  limitStartToNow?: boolean;
  earlierThanLimit?: string;
  disabled?: boolean;
  readOnly?: boolean;
  ariaDescribedBy?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  ref?: Ref<NativeDateTimeHandle>;
  family?: 1 | 2;
  syncValue?: "silent" | "set";
  initializeFromValue?: boolean;
  onCommit?: () => void;
  onChange: (value: string, dirty?: boolean, event?: string) => void;
};

export function NativeDateTimeInput({
  id,
  name,
  caption,
  value,
  required,
  datetime = false,
  numeric = false,
  initWithNow = false,
  initialValue = "",
  nextInputSelector = "false",
  showInitialContext = false,
  limitEndToNow = false,
  limitStartToNow = false,
  earlierThanLimit = "",
  disabled = false,
  readOnly = false,
  ariaDescribedBy,
  inputRef,
  ref,
  family = 2,
  syncValue = "silent",
  initializeFromValue = false,
  onCommit,
  onChange,
}: NativeDateInputProps) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const observed = useRef(value);
  const runtime = useRef<NativeDateTimeHandle>(null);
  useImperativeHandle(inputRef, () => input.current!);
  // Load and Clear assign text silently. They do not parse it or reset widget validity.
  useLayoutEffect(() => {
    if (observed.current === value) return;
    observed.current = value;

    if (syncValue === "set" && runtime.current) runtime.current.SetValue(value);
    else if (input.current) input.current.value = value;
  }, [value, syncValue]);
  useNativeDateTimeInput(
    input,
    (next, dirty, event) => {
      observed.current = next;
      onChange(next, dirty, event);

      if (event === "change") onCommit?.();
    },
    family,
    runtime,
  );
  useImperativeHandle(
    ref,
    () => ({
      GetValue: () => runtime.current?.GetValue() ?? input.current?.value ?? "",
      SetValue: (value) => runtime.current?.SetValue(value),
      ChangeFormat: (format) => runtime.current?.ChangeFormat(format),
      Clear: () => runtime.current?.Clear(),
    }),
    [],
  );
  const initial = useRef({ family, initWithNow, initialValue, value, initializeFromValue });
  useLayoutEffect(() => {
    const first = initial.current;

    if (
      first.family === 1 &&
      first.value &&
      (first.initializeFromValue || (!first.initWithNow && !first.initialValue))
    )
      runtime.current?.SetValue(first.value);
  }, []);
  useLayoutEffect(() => {
    if (showInitialContext) input.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [showInitialContext]);
  const pickerId = `native-date-${family}-${id.replaceAll(":", "")}`;
  const kind = family === 1 ? "datetimepicker" : "datetimepicker2";
  const calendarLabel = `${caption}: ${t("Calendar")}`;

  return (
    <div className={`field ${kind}-wrapper native-userfield-date`}>
      <div className="native-date-caption">
        <label htmlFor={id}>{caption}</label>
        <span>
          <time
            id={`${id}-date-context`}
            data-native-date-context={family}
            className="booking-date-context timeago timeago-contextual"
          />
        </span>
      </div>
      <div
        id={pickerId}
        className={`input-group date ${kind}${datetime ? "" : ` date-only-${kind}`}`}
        data-target-input="nearest"
        data-calendar-label={calendarLabel}
        style={{ position: "relative" }}
      >
        <input
          id={id}
          name={family === 1 ? name : undefined}
          ref={input}
          type="text"
          className={`${kind}-input`}
          autoComplete="off"
          aria-describedby={[`${id}-date-context`, ariaDescribedBy].filter(Boolean).join(" ")}
          inputMode={numeric ? "numeric" : undefined}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          data-native-userfield={family === 2 ? name : undefined}
          data-target={`#${pickerId}`}
          data-format={datetime ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD"}
          data-init-with-now={String(initWithNow)}
          data-init-value={initialValue}
          data-limit-end-to-now={String(limitEndToNow)}
          data-limit-start-to-now={String(limitStartToNow)}
          data-next-input-selector={nextInputSelector}
          data-earlier-than-limit={earlierThanLimit}
          defaultValue={family === 1 ? "" : value}
          onChange={(event) => {
            observed.current = event.target.value;
            onChange(event.target.value, false, "input");
          }}
        />
        <button
          type="button"
          tabIndex={family === 1 ? -1 : undefined}
          className="btn native-userfield-date-button"
          data-target={`#${pickerId}`}
          data-toggle="datetimepicker"
          aria-label={calendarLabel}
          aria-haspopup="dialog"
          aria-expanded="false"
          disabled={disabled || readOnly}
        >
          <Icon name="calendar" />
        </button>
      </div>
    </div>
  );
}
