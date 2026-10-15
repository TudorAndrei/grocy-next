import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { readApiConfig, writeApiConfig } from "@/lib/config";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const initial = readApiConfig();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await queryClient.cancelQueries();
    queryClient.clear();
    writeApiConfig({ baseUrl, apiKey });
    setSaved(true);
  }

  return (
    <>
      <PageHeader
        title="Connection"
        lead="Enter your server address and API key. Leave the address blank when the web application and API use the same server."
      />
      <section className="panel" style={{ maxWidth: "32rem" }}>
        <div className="panel-inner">
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="api-base">API base URL</label>
              <input
                id="api-base"
                type="text"
                placeholder="https://your-grocy.example (optional locally)"
                value={baseUrl}
                onChange={(e) => {
                  setSaved(false);
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
                placeholder="dev-key"
                value={apiKey}
                onChange={(e) => {
                  setSaved(false);
                  setApiKey(e.target.value);
                }}
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Save connection
            </button>
            {saved ? (
              <p className="muted" style={{ marginTop: "1rem" }} role="status">
                Connection saved.
              </p>
            ) : null}
          </form>
        </div>
      </section>
    </>
  );
}
