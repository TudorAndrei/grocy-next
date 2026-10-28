import { useI18n } from "@/lib/i18n";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { signInWithKey } from "@/lib/session";
import { AuthCard } from "./AuthCard";
import { ErrorBlock } from "./ErrorBlock";

const MIN_PASSWORD = 8;

export function SetupWizard() {
  const { t: tr } = useI18n();

  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (password.length < MIN_PASSWORD) {
      setError(tr("Password must have at least %s characters.", String(MIN_PASSWORD)));

      return;
    }

    if (password !== confirm) {
      setError(tr("The passwords do not match."));

      return;
    }

    setError(null);
    setBusy(true);

    try {
      const result = await api.runSetup({
        setup_token: token.trim(),
        username: username.trim(),
        password,
      });

      await signInWithKey(queryClient, result.api_key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Setup failed."));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={tr("Create the administrator")}
      lead={tr(
        "This server has no users yet. Enter the setup token from the server log. The first account gets full access.",
      )}
    >
      {error ? <ErrorBlock message={error} /> : null}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="setup-token">{tr("Setup token")}</label>
          <input
            id="setup-token"
            type="password"
            autoComplete="off"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="setup-username">{tr("Username")}</label>
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
          <label htmlFor="setup-password">{tr("Password")}</label>
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
          <label htmlFor="setup-confirm">{tr("Confirm password")}</label>
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
          {busy ? tr("Creating…") : tr("Create administrator")}
        </button>
      </form>
    </AuthCard>
  );
}
