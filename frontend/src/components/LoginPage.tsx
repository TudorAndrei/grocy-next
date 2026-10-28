import { useI18n } from "@/lib/i18n";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { signInWithKey } from "@/lib/session";
import { AuthCard } from "./AuthCard";
import { ErrorBlock } from "./ErrorBlock";

export function LoginPage() {
  const { t: tr } = useI18n();

  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await api.login({ username: username.trim(), password });
      await signInWithKey(queryClient, result.api_key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Sign-in failed."));
      setBusy(false);
    }
  };

  return (
    <AuthCard title={tr("Sign in")} lead={tr("Sign in with your Grocy Next account.")}>
      {error ? <ErrorBlock message={error} /> : null}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="login-username">{tr("Username")}</label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">{tr("Password")}</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? tr("Signing in…") : tr("Sign in")}
        </button>
      </form>
    </AuthCard>
  );
}
