import { useI18n } from "@/lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useMatch, useRouter, useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { signInWithKey } from "@/lib/session";
import { AuthCard } from "./AuthCard";
import { ErrorBlock } from "./ErrorBlock";
import { selectCookieSession } from "@/lib/config";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { nativeLoginQuery } from "@/lib/native-auth";
import { LoadingBlock } from "./LoadingBlock";

export function LoginPage() {
  const directLogin = Boolean(useMatch({ from: "/login", shouldThrow: false }));

  return directLogin ? <NativeLogin /> : <AccountLogin />;
}

function NativeLogin() {
  const { t } = useI18n();
  const context = useQuery(nativeLoginQuery());

  return (
    <AuthCard title={t("Login")}>
      {context.error ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button type="button" className="btn" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : context.isSuccess && context.isFetchedAfterMount ? (
        <NativeLoginForm action={context.data.login_url} />
      ) : (
        <LoadingBlock />
      )}
    </AuthCard>
  );
}

function NativeLoginForm({ action }: { action: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const raw = useLocation({ select: () => router.history.location.search });
  const username = useRef<HTMLInputElement>(null);

  const [invalid] = useState(() => {
    try {
      return nativeQueryParameter(raw, "invalid") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const timer = window.setTimeout(() => username.current?.focus(), 500);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <form method="post" action={action} noValidate onSubmit={selectCookieSession}>
      <div className="field">
        <label htmlFor="username">{t("Username")}</label>
        <input
          ref={username}
          id="username"
          name="username"
          type="text"
          required
          autoComplete="username"
        />
      </div>
      <div className="field">
        <label htmlFor="password">{t("Password")}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
        {invalid ? <p role="alert">{t("Invalid credentials, please try again")}</p> : null}
      </div>
      <label className="check-field">
        <input type="checkbox" name="stay_logged_in" />
        <span title={t("When not set, you will get logged out at latest after 30 days")}>
          {t("Stay logged in permanently")}
        </span>
      </label>
      <button type="submit" className="btn btn-primary">
        {t("OK")}
      </button>
    </form>
  );
}

function AccountLogin() {
  const { t: tr } = useI18n();

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const direct = useMatch({ from: "/signin", shouldThrow: false });
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

      if (direct) await navigate({ to: "/", replace: true });
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
            autoFocus
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
