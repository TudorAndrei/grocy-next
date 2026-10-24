import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { readApiConfig, writeApiConfig } from "@/lib/config";
import { PageHeader } from "@/components/PageHeader";
import { useNotify } from "@/components/Toaster";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const initial = readApiConfig();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    writeApiConfig({ baseUrl, apiKey });
    void queryClient.invalidateQueries();
    notify({ message: "Connection saved. Data is reloading." });
  }

  return (
    <>
      <PageHeader title="Settings" lead="Where this UI finds your Grocy Next server." />
      <section className="panel narrow">
        <h2 className="panel-head">Connection</h2>
        <form className="panel-body" onSubmit={onSubmit}>
          <label className="field">
            <span>API base URL</span>
            <input
              type="url"
              placeholder="https://grocy.example.home"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <small className="field-hint">Leave empty to use the dev proxy on this host.</small>
          </label>
          <label className="field">
            <span>GROCY-API-KEY</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="dev-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <small className="field-hint">The local demo key is dev-key.</small>
          </label>
          <button type="submit" className="btn btn-primary">
            Save connection
          </button>
        </form>
      </section>
    </>
  );
}
