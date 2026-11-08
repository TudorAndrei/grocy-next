const STORAGE_BASE = "grocy_next_api_base";
const STORAGE_KEY = "grocy_next_api_key";
const STORAGE_COOKIE = "grocy_next_cookie_session";
const DEFAULT_API_KEY = "dev-key";

type IdentityMode = "pending" | "browser" | "key";

type AutomaticIdentity = {
  mode: IdentityMode;
  signal: AbortSignal;
  assertCurrent: () => void;
  select: (mode: "browser" | "key") => void;
};

let connectionRevision = 0;
let activeSession: ReturnType<typeof createAutomaticSession> | undefined;

export type ApiConfig = {
  baseUrl: string;
  apiKey: string;
};

function readStored(key: string): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const value = localStorage.getItem(key);

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function configuredApiConnection(): ApiConfig {
  const baseUrl =
    readStored(STORAGE_BASE) ?? (import.meta.env.VITE_API_BASE?.trim() || import.meta.env.BASE_URL);

  const apiKey = cookieSessionSelected()
    ? ""
    : (readStored(STORAGE_KEY) ?? import.meta.env.VITE_API_KEY ?? DEFAULT_API_KEY);

  return { baseUrl, apiKey };
}

function connectionIdentity(): string {
  return JSON.stringify([
    configuredApiConnection(),
    hasExplicitApiConnection(),
    cookieSessionSelected(),
    connectionRevision,
  ]);
}

function createAutomaticSession() {
  const lifetime = new AbortController();
  let identity: { connection: string; value: AutomaticIdentity } | undefined;

  const session = {
    active: () => activeSession === session && !lifetime.signal.aborted,
    dispose: () => {
      lifetime.abort();

      if (activeSession === session) activeSession = undefined;
    },
    identity: (): AutomaticIdentity | undefined => {
      if (!session.active() || cookieSessionSelected() || hasExplicitApiConnection()) return;

      const config = configuredApiConnection();

      try {
        if (new URL(config.baseUrl, window.location.href).origin !== window.location.origin) return;
      } catch {
        return;
      }

      const connection = connectionIdentity();

      if (identity?.connection === connection) return identity.value;

      const value: AutomaticIdentity = {
        mode: "pending",
        signal: lifetime.signal,
        assertCurrent: () => {
          if (!session.active() || connection !== connectionIdentity())
            throw new DOMException("The connection changed", "AbortError");
        },
        select: (mode) => {
          value.assertCurrent();

          if (value.mode !== "pending" && value.mode !== mode)
            throw new DOMException("The identity was already selected", "AbortError");

          value.mode = mode;
        },
      };

      identity = { connection, value };

      return value;
    },
  };

  return session;
}

/** Owned by the mounted application document, never persisted as a login choice. */
export function startAutomaticApiSession() {
  activeSession?.dispose();
  activeSession = createAutomaticSession();

  return activeSession;
}

export function automaticApiIdentity(): AutomaticIdentity | undefined {
  return activeSession?.identity();
}

export function automaticBrowserSessionSelected(): boolean {
  return automaticApiIdentity()?.mode === "browser";
}

export function readApiConfig(): ApiConfig {
  const config = configuredApiConnection();
  const identity = automaticApiIdentity();

  return identity && identity.mode !== "key" ? { ...config, apiKey: "" } : config;
}

export function writeApiConfig(config: ApiConfig): void {
  connectionRevision += 1;
  localStorage.removeItem(STORAGE_COOKIE);
  localStorage.setItem(STORAGE_BASE, config.baseUrl.trim());
  localStorage.setItem(STORAGE_KEY, config.apiKey.trim() || DEFAULT_API_KEY);
}

/** Native form login selects the browser cookie, independently of a saved connection key. */
export function selectCookieSession(): void {
  connectionRevision += 1;
  localStorage.setItem(STORAGE_COOKIE, "1");
}

export function cookieSessionSelected(): boolean {
  return readStored(STORAGE_COOKIE) === "1";
}

/** A saved/build-time connection is deliberate; the implicit dev-key fallback is not. */
export function hasExplicitApiConnection(): boolean {
  return (
    readStored(STORAGE_BASE) !== null ||
    readStored(STORAGE_KEY) !== null ||
    !!import.meta.env.VITE_API_BASE?.trim() ||
    !!import.meta.env.VITE_API_KEY?.trim()
  );
}

export function configStorageKeys() {
  return { base: STORAGE_BASE, key: STORAGE_KEY };
}
