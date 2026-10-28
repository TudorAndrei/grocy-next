import { z } from "zod";
import type { JsonObject } from "@/lib/json";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { OwnProfile } from "@/components/OwnProfile";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { currentUserQuery, systemInfoQuery, userSettingsQuery } from "@/hooks/queries";
import { readApiConfig, writeApiConfig } from "@/lib/config";
import { api } from "@/lib/api";
import { preferenceEnabled } from "@/lib/preferences";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { isNightModeTime } from "@/lib/theme";

type SettingsTab = "connection" | "profile" | "appearance" | "preferences" | "products" | "about";

type SettingsSearch = { tab: SettingsTab };

const settingsSearchSchema = z.object({
  tab: z
    .enum(["connection", "profile", "appearance", "preferences", "products", "about"])
    .catch("connection"),
});

export const Route = createFileRoute("/settings")({
  validateSearch: (search): SettingsSearch => settingsSearchSchema.parse(search),
  component: SettingsPage,
});

const preferenceFields: Array<{
  key: string;
  label: string;
  type: "number" | "checkbox" | "select" | "text";
  section?: "appearance" | "products";
  ref?: string;
  options?: string[];
  optionLabels?: Record<string, string>;
  feature?: string;
  max?: number;
  min?: number;
  step?: string;
}> = [
  { key: "locale", label: "Language", type: "select" },
  {
    key: "keep_screen_on",
    label: "Keep screen on",
    type: "checkbox",
    section: "appearance",
  },
  {
    key: "keep_screen_on_when_fullscreen_card",
    label: 'Keep screen on while displaying a "fullscreen-card"',
    type: "checkbox",
    section: "appearance",
  },
  {
    key: "show_clock_in_header",
    label: "Show clock in header",
    type: "checkbox",
    section: "appearance",
  },
  {
    key: "product_presets_location_id",
    label: "Location",
    type: "select",
    section: "products",
    ref: "locations",
    feature: "STOCK_LOCATION_TRACKING",
  },
  {
    key: "product_presets_product_group_id",
    label: "Product group",
    type: "select",
    section: "products",
    ref: "product_groups",
  },
  {
    key: "product_presets_qu_id",
    label: "Quantity unit",
    type: "select",
    section: "products",
    ref: "quantity_units",
  },
  {
    key: "product_presets_default_due_days",
    label: "Default due days",
    type: "number",
    section: "products",
    min: -1,
  },
  {
    key: "product_presets_treat_opened_as_out_of_stock",
    label: "Treat opened as out of stock",
    type: "checkbox",
    section: "products",
    feature: "STOCK_PRODUCT_OPENED_TRACKING",
  },
  {
    key: "product_presets_default_stock_label_type",
    label: "Default stock entry label",
    type: "select",
    section: "products",
    feature: "LABEL_PRINTER",
    options: ["0", "1", "2"],
    optionLabels: { "0": "No label", "1": "Single label", "2": "Label per unit" },
  },
  {
    key: "stock_due_soon_days",
    label: "Due soon days",
    type: "number",
  },
  {
    key: "stock_decimal_places_prices_input",
    label: "Decimal places allowed for prices (input)",
    type: "number",
    feature: "STOCK_PRICE_TRACKING",
    max: 10,
  },
  {
    key: "stock_decimal_places_prices_display",
    label: "Decimal places allowed for prices (display)",
    type: "number",
    feature: "STOCK_PRICE_TRACKING",
    max: 10,
  },
  {
    key: "stock_decimal_places_amounts",
    label: "Decimal places allowed for amounts",
    type: "number",
    max: 10,
  },
  {
    key: "stock_default_purchase_amount",
    label: "Default amount for purchase",
    type: "number",
    step: "any",
  },
  {
    key: "stock_default_consume_amount",
    label: "Default amount for consume",
    type: "number",
    step: "any",
  },
  {
    key: "stock_default_consume_amount_use_quick_consume_amount",
    label: 'Use the products "Quick consume amount"',
    type: "checkbox",
  },
  {
    key: "show_purchased_date_on_purchase",
    label:
      "Show purchased date on purchase and inventory page (otherwise the purchased date defaults to today)",
    type: "checkbox",
  },
  {
    key: "scan_mode_purchase_enabled",
    label: "Barcode mode defaults to purchase",
    type: "checkbox",
  },
  {
    key: "scan_mode_consume_enabled",
    label: "Barcode mode defaults to consume",
    type: "checkbox",
  },
  {
    key: "auto_reload_on_db_change",
    label: "Auto reload on external changes",
    type: "checkbox",
  },
  {
    key: "night_mode",
    section: "appearance",
    label: "Night mode",
    type: "select",
    options: ["follow-system", "on", "off"],
    optionLabels: { "follow-system": "Use system setting", on: "On", off: "Off" },
  },
  {
    key: "auto_night_mode_enabled",
    label: "Auto enable in time range",
    type: "checkbox",
    section: "appearance",
  },
  {
    key: "auto_night_mode_time_range_from",
    label: "From",
    type: "text",
    section: "appearance",
  },
  {
    key: "auto_night_mode_time_range_to",
    label: "To",
    type: "text",
    section: "appearance",
  },
  {
    key: "auto_night_mode_time_range_goes_over_midnight",
    label: "Time range goes over midnight",
    type: "checkbox",
    section: "appearance",
  },
];

function SettingsPage() {
  const { t, languages } = useI18n();
  const features = useFeatures();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const initial = readApiConfig();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [connectionSaved, setConnectionSaved] = useState(false);

  const system = useQuery(systemInfoQuery());
  const user = useQuery(currentUserQuery());
  const settings = useQuery(userSettingsQuery());
  const references = ["locations", "product_groups", "quantity_units"];

  const options = useQueries({
    queries: references.map((entity) => ({
      queryKey: ["objects", entity],
      queryFn: () => api.objects(entity),
      enabled:
        tab === "products" &&
        (entity !== "locations" || features.enabled("STOCK_LOCATION_TRACKING")),
    })),
  });

  const [draft, setDraft] = useState<Record<string, string>>({});

  const saveConnection = async (event: FormEvent) => {
    event.preventDefault();
    await queryClient.cancelQueries();
    queryClient.clear();
    writeApiConfig({ baseUrl, apiKey });
    setConnectionSaved(true);
  };

  const savePreferences = useMutation({
    mutationFn: () => {
      const body: JsonObject = {};

      for (const field of preferenceFields) {
        const raw = draft[field.key];

        if (raw === undefined) continue;

        if (field.type === "checkbox") {
          body[field.key] = raw === "1";
        } else if (field.type === "number" || field.ref) {
          body[field.key] = Number(raw);
        } else {
          body[field.key] = raw;
        }
      }

      return api.putUserSettings(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const setTab = (next: SettingsTab) => {
    navigate({ search: { tab: next } });
  };

  const settingsValue = (key: string) => {
    if (draft[key] !== undefined) return draft[key];
    const value = settings.data?.[key];

    if (value === true || value === "1") return "1";

    if (value === false || value === "0") return "0";

    if (value == null) return "";

    return String(value);
  };

  const renderPreferences = (section: "appearance" | "preferences" | "products") => (
    <>
      {settings.isLoading ? <LoadingBlock label={t("Loading preferences…")} /> : null}
      {settings.isSuccess ? (
        <form
          className="panel panel-inner"
          onSubmit={(e) => {
            e.preventDefault();
            savePreferences.mutate();
          }}
        >
          <div className="form-grid">
            {preferenceFields.map((field) =>
              (field.section ?? "preferences") !== section ||
              (field.feature && !features.enabled(field.feature)) ? null : (
                <div className="field" key={field.key}>
                  <label htmlFor={`pref-${field.key}`}>{t(field.label)}</label>
                  {field.type === "checkbox" ? (
                    <input
                      id={`pref-${field.key}`}
                      type="checkbox"
                      checked={preferenceEnabled(settingsValue(field.key))}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [field.key]: e.target.checked ? "1" : "0",
                        }))
                      }
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={`pref-${field.key}`}
                      value={settingsValue(field.key)}
                      onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                    >
                      {field.ref ? (
                        <>
                          <option value="-1">{t("None")}</option>
                          {options[references.indexOf(field.ref)]?.data?.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name}
                            </option>
                          ))}
                        </>
                      ) : (
                        (field.key === "locale" ? ["", ...languages] : (field.options ?? [])).map(
                          (opt) => (
                            <option key={opt} value={opt}>
                              {t(field.optionLabels?.[opt] ?? (opt || "Default"))}
                            </option>
                          ),
                        )
                      )}
                    </select>
                  ) : (
                    <input
                      id={`pref-${field.key}`}
                      type={field.type === "text" ? "text" : "number"}
                      min={field.type === "number" ? (field.min ?? 0) : undefined}
                      placeholder={field.type === "text" ? "HH:mm" : undefined}
                      aria-invalid={
                        field.type === "text" && !isNightModeTime(settingsValue(field.key))
                      }
                      readOnly={
                        field.type === "text" &&
                        !preferenceEnabled(settingsValue("auto_night_mode_enabled"))
                      }
                      max={field.max}
                      step={field.step}
                      value={settingsValue(field.key)}
                      onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ),
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={savePreferences.isPending}>
            {t("Save")}
          </button>
          {savePreferences.isSuccess ? (
            <p className="muted" role="status">
              {t("Preferences saved.")}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );

  const error =
    system.error ||
    user.error ||
    settings.error ||
    savePreferences.error ||
    options.find((query) => query.error)?.error;

  return (
    <>
      <PageHeader
        title={t("Settings")}
        lead={t("Connection, appearance, and Grocy user preferences for this API key.")}
      />
      <Tabs
        ariaLabel={t("Settings sections")}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "connection", label: t("Connection") },
          { id: "profile", label: t("Profile") },
          { id: "appearance", label: t("Appearance") },
          { id: "preferences", label: t("Preferences") },
          { id: "products", label: t("Presets for new products") },
          { id: "about", label: t("About") },
        ]}
      />
      {error ? (
        <ErrorBlock message={error instanceof Error ? error.message : t("Settings error.")} />
      ) : null}
      <TabPanel id="settings-connection" labelledBy="tab-connection" hidden={tab !== "connection"}>
        <section className="panel" style={{ maxWidth: "32rem" }}>
          <div className="panel-inner">
            <form onSubmit={saveConnection}>
              <div className="field">
                <label htmlFor="api-base">{t("API base URL")}</label>
                <input
                  id="api-base"
                  type="text"
                  placeholder={t("Leave blank when UI and API share a host")}
                  value={baseUrl}
                  onChange={(e) => {
                    setConnectionSaved(false);
                    setBaseUrl(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="api-key">{t("API key")}</label>
                <input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => {
                    setConnectionSaved(false);
                    setApiKey(e.target.value);
                  }}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                {t("Save connection")}
              </button>
              {connectionSaved ? (
                <p className="muted" role="status">
                  {t("Connection saved.")}
                </p>
              ) : null}
            </form>
          </div>
        </section>
      </TabPanel>
      <TabPanel id="settings-profile" labelledBy="tab-profile" hidden={tab !== "profile"}>
        {tab === "profile" ? <OwnProfile /> : null}
      </TabPanel>
      <TabPanel id="settings-appearance" labelledBy="tab-appearance" hidden={tab !== "appearance"}>
        {tab === "appearance" ? renderPreferences("appearance") : null}
      </TabPanel>
      <TabPanel
        id="settings-preferences"
        labelledBy="tab-preferences"
        hidden={tab !== "preferences"}
      >
        {tab === "preferences" ? renderPreferences("preferences") : null}
      </TabPanel>
      <TabPanel id="settings-products" labelledBy="tab-products" hidden={tab !== "products"}>
        {tab === "products" ? renderPreferences("products") : null}
      </TabPanel>
      <TabPanel id="settings-about" labelledBy="tab-about" hidden={tab !== "about"}>
        {system.isLoading || user.isLoading ? (
          <LoadingBlock label={t("Loading system info…")} />
        ) : null}
        {system.data ? (
          <section className="panel">
            <div className="panel-inner">
              <dl className="meta-list">
                <div>
                  <dt>{t("Grocy")}</dt>
                  <dd>
                    {system.data.grocy_version.Version} ({system.data.grocy_version.ReleaseDate})
                  </dd>
                </div>
                <div>
                  <dt>{t("Database version")}</dt>
                  <dd>{system.data.db_version}</dd>
                </div>
                <div>
                  <dt>{t("Python")}</dt>
                  <dd>{system.data.python_version}</dd>
                </div>
                <div>
                  <dt>{t("SQLite")}</dt>
                  <dd>{system.data.sqlite_version}</dd>
                </div>
                <div>
                  <dt>{t("Server")}</dt>
                  <dd>{system.data.os}</dd>
                </div>
                {user.data ? (
                  <div>
                    <dt>{t("Signed in as")}</dt>
                    <dd>
                      {user.data.first_name} {user.data.last_name} ({user.data.username})
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </section>
        ) : null}
      </TabPanel>
    </>
  );
}
