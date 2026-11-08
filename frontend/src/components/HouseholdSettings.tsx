import { useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useI18n } from "@/lib/i18n";
import { useNativePreferenceAutosave } from "@/lib/native-preferences";
import { preferenceEnabled } from "@/lib/preferences";
import type { UserSettings } from "@/lib/types";
import {
  householdDueSoonValue,
  householdSettings,
  householdSettingsDefaults,
  sameHouseholdSetting,
  type HouseholdSettingsKind,
} from "@/lib/household-settings";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { Icon } from "./Icon";

export function HouseholdSettings({ kind }: { kind: HouseholdSettingsKind }) {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const [initial, setInitial] = useState<UserSettings>();

  if (!initial && settings.isSuccess && settings.isFetchedAfterMount && !settings.isFetching)
    setInitial(settings.data);

  return (
    <>
      <PageHeader title={t(householdSettings[kind].title)} />
      {!initial && !settings.error ? <LoadingBlock label={t("Loading preferences…")} /> : null}
      {settings.error ? (
        <>
          <ErrorBlock message={settings.error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {initial ? <SettingsControls key={kind} kind={kind} settings={initial} /> : null}
    </>
  );
}

function SettingsControls({
  kind,
  settings,
}: {
  kind: HouseholdSettingsKind;
  settings: UserSettings;
}) {
  const { t } = useI18n();
  const save = useNativePreferenceAutosave(settings);
  const config = householdSettings[kind];
  const id = useId();
  const [days, setDays] = useState(() => householdDueSoonValue(settings, kind));
  const committedDays = useRef(days);

  const [swapped, setSwapped] = useState(() =>
    preferenceEnabled(settings.chores_overview_swap_tracking_buttons),
  );

  const saved = useRef({ ...householdSettingsDefaults, ...settings });
  const input = useRef<HTMLInputElement>(null);

  const persist = (key: string, value: UserSettings[string]) => {
    if (sameHouseholdSetting(saved.current[key], value)) return;
    saved.current[key] = value;
    save(key, value);
  };

  const commitDays = () => {
    if (!input.current || input.current.value === committedDays.current) return;
    committedDays.current = input.current.value;

    if (input.current.checkValidity()) persist(config.writeKey, input.current.value);
  };

  const step = (delta: number) => {
    if (!input.current) return;
    const current = input.current.value;
    const next = String(Number.parseFloat(current || (delta === 1 ? "0" : "1")) + delta);
    input.current.value = next;
    setDays(next);
    commitDays();
  };

  return (
    <section
      className="panel panel-inner"
      style={{ maxWidth: "32rem" }}
      aria-label={t(config.title)}
    >
      {config.overview ? <h2 className="panel-title">{t(config.overview)}</h2> : null}
      <div className="field">
        <label htmlFor={id}>{t("Due soon days")}</label>
        <div className="number-picker">
          <input
            id={id}
            ref={input}
            type="number"
            required
            min={0}
            step={1}
            value={days}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setDays(event.target.value)}
            onBlur={commitDays}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              step(event.key === "ArrowUp" ? 1 : -1);
            }}
          />
          {([1, -1] as const).map((delta) => (
            <button
              key={delta}
              type="button"
              className="btn number-picker-step"
              aria-label={t(delta === 1 ? "Increase %s" : "Decrease %s", t("Due soon days"))}
              aria-controls={id}
              onClick={() => step(delta)}
            >
              <Icon name={delta === 1 ? "up" : "down"} />
            </button>
          ))}
        </div>
        <span id={`${id}-hint`} className="field-hint">
          {t("Set to 0 to hide due soon filters/highlighting")}
        </span>
      </div>
      {kind === "chores" ? (
        <label className="check-field">
          <input
            type="checkbox"
            checked={swapped}
            onChange={(event) => {
              setSwapped(event.target.checked);
              persist("chores_overview_swap_tracking_buttons", event.target.checked);
            }}
          />
          {t("Swap track next schedule / track now buttons")}
        </label>
      ) : null}
      <div className="actions">
        <Link to={config.destination} className="btn btn-primary">
          {t("OK")}
        </Link>
      </div>
    </section>
  );
}
