import { z } from "zod";
import type { JsonObject } from "@/lib/json";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { OwnProfile } from "@/components/OwnProfile";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { useTheme } from "@/hooks/useTheme";
import { currentUserQuery, systemInfoQuery, userSettingsQuery } from "@/hooks/queries";
import { readApiConfig, writeApiConfig } from "@/lib/config";
import { api } from "@/lib/api";
import { preferenceEnabled } from "@/lib/preferences";
import { useFeatures } from "@/lib/features";

type SettingsTab = "connection" | "profile" | "appearance" | "preferences" | "about";

type SettingsSearch = { tab: SettingsTab };

const settingsSearchSchema = z.object({
  tab: z.enum(["connection", "profile", "appearance", "preferences", "about"]).catch("connection"),
});

const themePreferenceSchema = z.enum(["light", "dark", "system"]);

export const Route = createFileRoute("/settings")({
  validateSearch: (search): SettingsSearch => settingsSearchSchema.parse(search),
  component: SettingsPage,
});

const preferenceFields: Array<{
  key: string;
  label: string;
  type: "number" | "checkbox" | "select";
  options?: string[];
  feature?: string;
  max?: number;
  step?: string;
}> = [
  {
    key: "stock_due_soon_days",
    label: "Due soon window (days)",
    type: "number",
  },
  {
    key: "stock_decimal_places_prices_input",
    label: "Decimal places for price inputs",
    type: "number",
    feature: "STOCK_PRICE_TRACKING",
    max: 10,
  },
  {
    key: "stock_decimal_places_prices_display",
    label: "Decimal places for price display",
    type: "number",
    feature: "STOCK_PRICE_TRACKING",
    max: 10,
  },
  {
    key: "stock_decimal_places_amounts",
    label: "Decimal places for amounts",
    type: "number",
    max: 10,
  },
  {
    key: "stock_default_purchase_amount",
    label: "Default purchase amount",
    type: "number",
    step: "any",
  },
  {
    key: "stock_default_consume_amount",
    label: "Default consume amount",
    type: "number",
    step: "any",
  },
  {
    key: "stock_default_consume_amount_use_quick_consume_amount",
    label: "Use the product quick consume amount",
    type: "checkbox",
  },
  {
    key: "show_purchased_date_on_purchase",
    label: "Show purchase date",
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
    label: "Reload when the database changes",
    type: "checkbox",
  },
  {
    key: "night_mode",
    label: "Grocy night mode (server UI setting)",
    type: "select",
    options: ["follow-system", "on", "off"],
  },
];

function SettingsPage() {
  const features = useFeatures();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { preference, setPreference } = useTheme();
  const initial = readApiConfig();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [connectionSaved, setConnectionSaved] = useState(false);

  const system = useQuery(systemInfoQuery());
  const user = useQuery(currentUserQuery());
  const settings = useQuery(userSettingsQuery());
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
        } else if (field.type === "number") {
          body[field.key] = Number(raw);
        } else {
          body[field.key] = raw;
        }
      }

      return api.putUserSettings(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user", "settings"] });
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

  const error = system.error || user.error || settings.error || savePreferences.error;

  return (
    <>
      <PageHeader
        title="Settings"
        lead="Connection, appearance, and Grocy user preferences for this API key."
      />
      <Tabs
        ariaLabel="Settings sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "connection", label: "Connection" },
          { id: "profile", label: "Profile" },
          { id: "appearance", label: "Appearance" },
          { id: "preferences", label: "Preferences" },
          { id: "about", label: "About" },
        ]}
      />
      {error ? (
        <ErrorBlock message={error instanceof Error ? error.message : "Settings error."} />
      ) : null}
      <TabPanel id="settings-connection" labelledBy="tab-connection" hidden={tab !== "connection"}>
        <section className="panel" style={{ maxWidth: "32rem" }}>
          <div className="panel-inner">
            <form onSubmit={saveConnection}>
              <div className="field">
                <label htmlFor="api-base">API base URL</label>
                <input
                  id="api-base"
                  type="text"
                  placeholder="Leave blank when UI and API share a host"
                  value={baseUrl}
                  onChange={(e) => {
                    setConnectionSaved(false);
                    setBaseUrl(e.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="api-key">API key</label>
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
                Save connection
              </button>
              {connectionSaved ? (
                <p className="muted" role="status">
                  Connection saved.
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
        <section className="panel" style={{ maxWidth: "32rem" }}>
          <div className="panel-inner">
            <div className="field">
              <label htmlFor="theme-pref">App theme</label>
              <select
                id="theme-pref"
                value={preference}
                onChange={(e) => setPreference(themePreferenceSchema.parse(e.target.value))}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <p className="muted">
              This theme applies to Grocy Next only. Server-side night mode is under Preferences.
            </p>
          </div>
        </section>
      </TabPanel>
      <TabPanel
        id="settings-preferences"
        labelledBy="tab-preferences"
        hidden={tab !== "preferences"}
      >
        {settings.isLoading ? <LoadingBlock label="Loading preferences…" /> : null}
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
                field.feature && !features.enabled(field.feature) ? null : (
                  <div className="field" key={field.key}>
                    <label htmlFor={`pref-${field.key}`}>{field.label}</label>
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
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`pref-${field.key}`}
                        type="number"
                        min="0"
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
              Save preferences
            </button>
            {savePreferences.isSuccess ? (
              <p className="muted" role="status">
                Preferences saved.
              </p>
            ) : null}
          </form>
        ) : null}
      </TabPanel>
      <TabPanel id="settings-about" labelledBy="tab-about" hidden={tab !== "about"}>
        {system.isLoading || user.isLoading ? <LoadingBlock label="Loading system info…" /> : null}
        {system.data ? (
          <section className="panel">
            <div className="panel-inner">
              <dl className="meta-list">
                <div>
                  <dt>Grocy</dt>
                  <dd>
                    {system.data.grocy_version.Version} ({system.data.grocy_version.ReleaseDate})
                  </dd>
                </div>
                <div>
                  <dt>Database version</dt>
                  <dd>{system.data.db_version}</dd>
                </div>
                <div>
                  <dt>Python</dt>
                  <dd>{system.data.python_version}</dd>
                </div>
                <div>
                  <dt>SQLite</dt>
                  <dd>{system.data.sqlite_version}</dd>
                </div>
                <div>
                  <dt>Server</dt>
                  <dd>{system.data.os}</dd>
                </div>
                {user.data ? (
                  <div>
                    <dt>Signed in as</dt>
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
