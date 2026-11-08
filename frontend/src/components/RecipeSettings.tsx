import { useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { api, queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { preferenceEnabled } from "@/lib/preferences";
import type { UserSettings } from "@/lib/types";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

const controls = [
  {
    key: "recipes_show_list_side_by_side",
    label: "Show the recipe list and the recipe side by side",
    default: true,
  },
  {
    key: "recipes_show_ingredient_checkbox",
    label: "Show a little checkbox next to each ingredient to mark it as done",
    default: false,
  },
  {
    key: "recipe_ingredients_group_by_product_group",
    label: "Group ingredients by their product group",
    default: false,
  },
] as const;

type SettingKey = (typeof controls)[number]["key"];

export function RecipeSettings() {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const [initial, setInitial] = useState<UserSettings>();

  if (!initial && settings.isSuccess && !settings.isFetching) setInitial(settings.data);

  return (
    <>
      <PageHeader title={t("Recipes settings")} />
      {!initial && !settings.error ? <LoadingBlock label={t("Loading preferences…")} /> : null}
      {settings.error ? (
        <>
          <ErrorBlock message={settings.error.message} />
          <button
            className="btn"
            onClick={() => {
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {initial ? <SettingsControls settings={initial} /> : null}
    </>
  );
}

function SettingsControls({ settings }: { settings: UserSettings }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const id = useId();

  const [values, setValues] = useState(() =>
    Object.fromEntries(
      controls.map((control) => [
        control.key,
        preferenceEnabled(
          settings[control.key] === undefined ? control.default : settings[control.key],
        ),
      ]),
    ),
  );

  const saved = useRef<UserSettings>(
    Object.fromEntries(
      controls.map((control) => [
        control.key,
        settings[control.key] === undefined ? control.default : settings[control.key]!,
      ]),
    ),
  );

  const save = useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: boolean }) =>
      api.putUserSetting(key, value),
    // The native auto-save handler logs failures without rolling back its in-memory setting.
    onError: (error) => console.error(error),
  });

  const change = (key: SettingKey, value: boolean) => {
    setValues((current) => ({ ...current, [key]: value }));
    const previous = saved.current[key];

    if (previous !== undefined && previous !== null && Number(previous) === Number(value)) return;
    saved.current[key] = value;
    client.setQueryData<UserSettings>(queryKeys.userSettings, (current) => ({
      ...current,
      [key]: value,
    }));
    save.mutate({ key, value });
  };

  const hint =
    "The ingredient is crossed out when clicked, the status is not saved, means reset when the page is reloaded";

  return (
    <section
      className="panel panel-inner"
      style={{ maxWidth: "32rem" }}
      aria-label={t("Recipes settings")}
    >
      {controls.map((control, index) => (
        <div key={control.key} className="field">
          {index === 2 ? <h2 className="panel-title">{t("Recipe card")}</h2> : null}
          <label className="check-field">
            <input
              type="checkbox"
              checked={values[control.key]}
              aria-describedby={index === 1 ? `${id}-hint` : undefined}
              onChange={(event) => change(control.key, event.target.checked)}
            />
            {t(control.label)}
          </label>
          {index === 1 ? (
            <span id={`${id}-hint`} className="field-hint">
              {t(hint)}
            </span>
          ) : null}
        </div>
      ))}
      <Link
        to="/recipes"
        search={{}}
        className="btn btn-primary"
        onClick={() => {
          void client.invalidateQueries({ queryKey: queryKeys.userSettings, refetchType: "none" });
        }}
      >
        {t("OK")}
      </Link>
    </section>
  );
}
