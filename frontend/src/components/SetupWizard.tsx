import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { readApiConfig, writeApiConfig } from "@/lib/config";
import { ErrorBlock } from "./ErrorBlock";

const MIN_PASSWORD = 8;

export function SetupWizard() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Password must have at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await api.runSetup({
        username: username.trim(),
        password,
      });
      writeApiConfig({
        baseUrl: readApiConfig().baseUrl,
        apiKey: result.api_key,
      });
      await queryClient.resetQueries();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup failed.");
      setBusy(false);
    }
  };

  return (
    <main id="main-content" className="setup-page">
      <section className="panel setup-panel">
        <div className="panel-inner">
          <p className="wordmark">
            Grocy <span>Next</span>
          </p>
          <h1 className="panel-title">Create the administrator</h1>
          <p className="muted">
            This server has no users yet. The first account gets full access.
            This browser keeps its API key.
          </p>
          {error ? <ErrorBlock message={error} /> : null}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="setup-username">Username</label>
              <input
                id="setup-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="setup-password">Password</label>
              <input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="setup-confirm">Confirm password</label>
              <input
                id="setup-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Creating…" : "Create administrator"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
