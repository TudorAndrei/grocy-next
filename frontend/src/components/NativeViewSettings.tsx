import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useI18n } from "@/lib/i18n";
import { useNativePreferenceAutosave } from "@/lib/native-preferences";
import { useNativeNightModeCheck } from "@/lib/native-preference-runtime";
import { preferenceEnabled } from "@/lib/preferences";
import { isNightModeTime } from "@/lib/theme";
import type { UserSettings } from "@/lib/types";
import { Icon } from "./Icon";

export function NativeViewSettings() {
  const settings = useQuery({ ...userSettingsQuery(), enabled: false });

  return settings.data ? <ViewSettingsControls initial={settings.data} /> : null;
}

function ViewSettingsControls({ initial }: { initial: UserSettings }) {
  const { t } = useI18n();
  const save = useNativePreferenceAutosave(initial);
  const checkNightMode = useNativeNightModeCheck();
  const [values, setValues] = useState(initial);
  const [previousSettings, setPreviousSettings] = useState(initial);
  const [open, setOpen] = useState(false);

  // The source's wake controls start unchecked, independently of the saved runtime settings.
  const [wake, setWake] = useState({
    keep_screen_on: false,
    keep_screen_on_when_fullscreen_card: false,
  });

  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const keyboard = useRef<"first" | "last" | undefined>(undefined);
  const id = useId();

  // Additional modern Settings saves can update this shell without a new document.
  if (previousSettings !== initial) {
    setPreviousSettings(initial);
    setValues(initial);
  }

  useEffect(() => {
    if (!open) return;

    root.current?.scrollIntoView?.({ block: "nearest" });
    const inputs = panel.current?.querySelectorAll<HTMLInputElement>("input");

    if (keyboard.current === "first") inputs?.[0]?.focus();
    else if (keyboard.current === "last") inputs?.[inputs.length - 1]?.focus();
    keyboard.current = undefined;

    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };

    const tabAway = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab" && !root.current?.contains(document.activeElement)) setOpen(false);
    };

    document.addEventListener("pointerdown", outside);
    document.addEventListener("keyup", tabAway);

    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keyup", tabAway);
    };
  }, [open]);

  const change = (key: string, value: UserSettings[string]) => {
    if (key === "auto_night_mode_time_range_goes_over_midnight") checkNightMode();
    setValues((current) => ({ ...current, [key]: value }));
    save(key, value);
  };

  const checkbox = (key: string, label: string) => (
    <label className="native-view-setting">
      <input
        type="checkbox"
        checked={preferenceEnabled(values[key])}
        onChange={(event) => change(key, event.target.checked)}
      />
      <span>{t(label)}</span>
    </label>
  );

  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.target === trigger.current && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      keyboard.current = event.key === "ArrowUp" ? "last" : "first";

      if (open) {
        const inputs = panel.current?.querySelectorAll<HTMLInputElement>("input");
        (keyboard.current === "first" ? inputs?.[0] : inputs?.[inputs.length - 1])?.focus();
        keyboard.current = undefined;
      } else setOpen(true);
    }
  };

  return (
    <div ref={root} className="native-view-settings" onKeyDown={keydown}>
      <button
        ref={trigger}
        type="button"
        className="native-view-settings-trigger"
        aria-label={t("View settings")}
        title={t("View settings")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="settings" />
        <span>{t("View settings")}</span>
        <Icon name={open ? "up" : "down"} />
      </button>
      <div
        ref={panel}
        id={id}
        className="native-view-settings-controls"
        role="region"
        aria-label={t("View settings")}
        hidden={!open}
      >
        {checkbox("auto_reload_on_db_change", "Auto reload on external changes")}
        {checkbox("show_clock_in_header", "Show clock in header")}
        <fieldset className="native-view-settings-night">
          <legend>{t("Night mode")}</legend>
          <div className="native-view-settings-radios">
            {(
              [
                ["on", "On"],
                ["follow-system", "Use system setting"],
                ["off", "Off"],
              ] as const
            ).map(([value, label]) => (
              <label className="native-view-setting" key={value}>
                <input
                  type="radio"
                  name={`${id}-night-mode`}
                  value={value}
                  checked={values.night_mode === value}
                  onChange={() => {
                    setValues((current) => ({ ...current, night_mode: value }));
                    save("night_mode", value, true);
                    checkNightMode();
                  }}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
          {checkbox("auto_night_mode_enabled", "Auto enable in time range")}
          <div className="native-view-settings-times">
            <ViewTime
              label="From"
              initial={String(initial.auto_night_mode_time_range_from ?? "")}
              readOnly={!preferenceEnabled(values.auto_night_mode_enabled)}
              onChange={(value) => change("auto_night_mode_time_range_from", value)}
              onCheck={checkNightMode}
            />
            <ViewTime
              label="To"
              initial={String(initial.auto_night_mode_time_range_to ?? "")}
              readOnly={!preferenceEnabled(values.auto_night_mode_enabled)}
              onChange={(value) => change("auto_night_mode_time_range_to", value)}
              onCheck={checkNightMode}
            />
          </div>
          {checkbox(
            "auto_night_mode_time_range_goes_over_midnight",
            "Time range goes over midnight",
          )}
        </fieldset>
        <div className="native-view-settings-wake">
          {(
            [
              ["keep_screen_on", "Keep screen on"],
              [
                "keep_screen_on_when_fullscreen_card",
                'Keep screen on while displaying a "fullscreen-card"',
              ],
            ] as const
          ).map(([key, label]) => (
            <label className="native-view-setting" key={key}>
              <input
                type="checkbox"
                data-setting-key={key}
                checked={wake[key]}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setWake((current) => ({ ...current, [key]: checked }));
                  save(key, checked);
                }}
              />
              <span>{t(label)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function ViewTime({
  label,
  initial,
  readOnly,
  onChange,
  onCheck,
}: {
  label: string;
  initial: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onCheck: () => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [defaultValue] = useState(initial);
  const committed = useRef(initial);
  const [invalid, setInvalid] = useState(!isNightModeTime(initial));

  useLayoutEffect(() => {
    const control = input.current;

    // Refresh clean values after a modern Settings save without replacing typed text.
    if (control && control.value === committed.current) {
      control.value = initial;
      setInvalid(!isNightModeTime(initial));
    }

    committed.current = initial;
  }, [initial]);

  useEffect(() => {
    const control = input.current;

    const change = () => {
      if (control?.checkValidity()) onChange(control.value);
    };

    control?.addEventListener("change", change);

    return () => control?.removeEventListener("change", change);
  }, [onChange]);

  return (
    <label className="native-view-settings-time">
      <span>{t(label)}</span>
      <input
        ref={input}
        type="text"
        defaultValue={defaultValue}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        placeholder={`${t(label)} (${t("in format")} HH:mm)`}
        onKeyUp={(event) => {
          setInvalid(!isNightModeTime(event.currentTarget.value));
          onCheck();
        }}
      />
    </label>
  );
}
