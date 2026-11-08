import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useNativePreferenceAutosave } from "@/lib/native-preferences";
import {
  getShoppingSettingsContext,
  type ShoppingSettingsContext,
} from "@/lib/native-settings-context";
import { preferenceEnabled } from "@/lib/preferences";
import type { UserSettings } from "@/lib/types";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

const labels = {
  shopping_list_show_calendar: "Show a month-view calendar",
  shopping_list_round_up: "Round up quantity amounts to the nearest whole number",
  shopping_list_auto_add_below_min_stock_amount:
    "Automatically add products that are below their defined min. stock amount to the shopping list",
  shopping_list_to_stock_workflow_auto_submit_when_prefilled:
    'Automatically do the booking using the last price and the amount of the shopping list item, if the product has "Default due days" set',
};

type CheckboxKey = keyof typeof labels;

export function ShoppingListSettings() {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const context = useQuery({
    queryKey: ["native-settings", "shopping-context"],
    queryFn: ({ signal }) => getShoppingSettingsContext(signal),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [initial, setInitial] = useState<{
    settings: UserSettings;
    context: ShoppingSettingsContext;
  }>();

  if (
    !initial &&
    settings.isSuccess &&
    !settings.isFetching &&
    context.isSuccess &&
    !context.isFetching
  )
    setInitial({ settings: settings.data, context: context.data });
  const error = settings.error ?? context.error;

  return (
    <>
      <PageHeader title={t("Shopping list settings")} />
      {!initial && !error ? <LoadingBlock label={t("Loading preferences…")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            type="button"
            onClick={() => {
              void settings.refetch();
              void context.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {initial ? <ShoppingControls settings={initial.settings} context={initial.context} /> : null}
    </>
  );
}

function ShoppingControls({
  settings,
  context,
}: {
  settings: UserSettings;
  context: ShoppingSettingsContext;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const save = useNativePreferenceAutosave(settings);

  const [values, setValues] = useState(() =>
    Object.fromEntries(Object.keys(labels).map((key) => [key, preferenceEnabled(settings[key])])),
  );

  const raw = settings.shopping_list_auto_add_below_min_stock_amount;
  const [targetDisabled, setTargetDisabled] = useState(!raw || raw === "0");

  const [target, setTarget] = useState(
    String(
      settings.shopping_list_auto_add_below_min_stock_amount_list_id === undefined
        ? 1
        : (settings.shopping_list_auto_add_below_min_stock_amount_list_id ?? ""),
    ),
  );

  const select = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (!context.shopping_lists.some((list) => String(list.id) === target) && select.current)
      select.current.selectedIndex = -1;
  });

  const checkbox = (key: CheckboxKey) => (
    <label className="check-field" key={key}>
      <input
        type="checkbox"
        checked={values[key]}
        onChange={(event) => {
          const value = event.target.checked;
          setValues((current) => ({ ...current, [key]: value }));

          if (key === "shopping_list_auto_add_below_min_stock_amount") setTargetDisabled(!value);
          save(key, value);
        }}
      />
      {t(labels[key])}
    </label>
  );

  return (
    <section className="panel panel-inner native-settings" aria-label={t("Shopping list settings")}>
      <h2 className="panel-title">{t("Shopping list")}</h2>
      {checkbox("shopping_list_show_calendar")}
      {checkbox("shopping_list_round_up")}
      {checkbox("shopping_list_auto_add_below_min_stock_amount")}
      <label className="field">
        {t("Shopping list")}
        <select
          ref={select}
          disabled={targetDisabled}
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            save("shopping_list_auto_add_below_min_stock_amount_list_id", event.target.value);
          }}
        >
          {context.shopping_lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>
      <h2 className="panel-title">{t("Shopping list to stock workflow")}</h2>
      {checkbox("shopping_list_to_stock_workflow_auto_submit_when_prefilled")}
      <Link
        to="/shoppinglist"
        search={{}}
        className="btn btn-primary"
        onClick={() => {
          void client.invalidateQueries({ queryKey: queryKeys.userSettings, refetchType: "none" });
          void client.invalidateQueries({ queryKey: ["shopping"], refetchType: "none" });
        }}
      >
        {t("OK")}
      </Link>
    </section>
  );
}
