import { BarcodeFormat, EncodeHintType, QRCodeWriter } from "@zxing/library";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModalDialog } from "@/hooks/useModalDialog";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { JsonObject } from "@/lib/json";
import { useNativePreferenceAutosave } from "@/lib/native-preferences";
import type { UserSettings } from "@/lib/types";
import { Icon } from "./Icon";

const colorControls = [
  ["calendar_color_products", "Products", "FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING"],
  ["calendar_color_tasks", "Tasks", "FEATURE_FLAG_TASKS"],
  ["calendar_color_chores", "Chores", "FEATURE_FLAG_CHORES"],
  ["calendar_color_batteries", "Batteries", "FEATURE_FLAG_BATTERIES"],
  ["calendar_color_meal_plan", "Meal plan", "FEATURE_FLAG_RECIPES_MEALPLAN"],
] as const;

const shareTitle = "Share/Integrate calendar (iCal)";

export function NativeCalendarActions({
  settings,
  config,
  onReload,
}: {
  settings: UserSettings;
  config: JsonObject;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const save = useNativePreferenceAutosave(settings);
  const [colors, setColors] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState(() => ({ ...settings }));
  const [shares, setShares] = useState<Array<{ id: number; url: string }>>([]);
  const serial = useRef(0);
  const owner = useRef<AbortController>(undefined);

  useEffect(() => {
    const scope = new AbortController();
    owner.current = scope;

    return () => scope.abort();
  }, []);

  const share = async () => {
    const signal = owner.current?.signal;
    const id = ++serial.current;

    try {
      const result = await request<{ url: string }>("/api/calendar/ical/sharing-link", { signal });

      if (!signal?.aborted) setShares((current) => [...current, { id, url: result.url }]);
    } catch (error) {
      if (!signal?.aborted) console.error(error);
    }
  };

  return (
    <div className="native-calendar-actions">
      <button
        className="btn btn-ghost native-calendar-actions-toggle"
        type="button"
        aria-label={t("More")}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <Icon name="more" />
      </button>
      <div className="native-calendar-related-links" data-expanded={expanded}>
        <button className="btn btn-ghost" type="button" onClick={() => void share()}>
          {t(shareTitle)}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setColors(true)}>
          {t("Configure colors")}
        </button>
      </div>
      {colors ? (
        <CalendarColorDialog
          config={config}
          values={values}
          onChange={(key, value) => {
            setValues((current) => ({ ...current, [key]: value }));
            save(key, value);
          }}
          onClose={() => {
            if (owner.current?.signal.aborted) return;
            setColors(false);
            onReload();
          }}
        />
      ) : null}
      {shares.map(({ id, url }) => (
        <CalendarShareDialog
          key={id}
          url={url}
          onClose={() => {
            if (!owner.current?.signal.aborted)
              setShares((current) => current.filter((share) => share.id !== id));
          }}
        />
      ))}
    </div>
  );
}

function CalendarColorDialog({
  config,
  values,
  onChange,
  onClose,
}: {
  config: JsonObject;
  values: UserSettings;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const closed = useRef(false);

  const dismiss = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog native-calendar-colors"
      aria-label={t("Configure colors")}
      onClose={(event) => {
        if (!event.currentTarget.open) dismiss();
      }}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <h2>{t("Configure colors")}</h2>
      {colorControls.map(([key, label, feature]) =>
        config[feature] && config[feature] !== "0" ? (
          <label className="field" key={key}>
            {t(label)}
            <input
              type="color"
              value={String(values[key] ?? "")}
              onChange={(event) => onChange(key, event.target.value)}
            />
          </label>
        ) : null,
      )}
      <button className="btn btn-primary" type="button" onClick={dismiss}>
        {t("OK")}
      </button>
    </dialog>
  );
}

function CalendarShareDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const accept = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);

  useEffect(() => accept.current?.focus(), []);

  const dismiss = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  const matrix = useMemo(
    () =>
      new QRCodeWriter().encode(
        url,
        BarcodeFormat.QR_CODE,
        0,
        0,
        new Map([[EncodeHintType.CHARACTER_SET, "UTF-8"]]),
      ),
    [url],
  );

  const pixels = [];

  for (let y = 0; y < matrix.getHeight(); y += 1)
    for (let x = 0; x < matrix.getWidth(); x += 1)
      if (matrix.get(x, y))
        pixels.push(<rect key={`${x}:${y}`} x={x} y={y} width="1" height="1" />);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog native-calendar-share"
      aria-label={t(shareTitle)}
      onClose={(event) => {
        if (!event.currentTarget.open) dismiss();
      }}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <h2>{t(shareTitle)}</h2>
      <label className="field">
        {t("Use the following (public) URL to share or integrate the calendar in iCal format")}
        <input type="text" readOnly value={url} onClick={(event) => event.currentTarget.select()} />
      </label>
      <svg
        role="img"
        aria-label={t("QR-Code")}
        className="qr-code"
        viewBox={`0 0 ${matrix.getWidth()} ${matrix.getHeight()}`}
        width={matrix.getWidth() * 4}
        height={matrix.getHeight() * 4}
      >
        <rect width="100%" height="100%" fill="white" />
        <g fill="black">{pixels}</g>
      </svg>
      <button ref={accept} className="btn btn-primary" type="button" onClick={dismiss}>
        {t("OK")}
      </button>
    </dialog>
  );
}
