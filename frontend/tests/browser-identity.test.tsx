import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { queryKeys } from "@/lib/api";
import type { NativeApiKey } from "@/lib/native-api-keys";
import type { JsonObject } from "@/lib/json";
import { configStorageKeys, cookieSessionSelected, writeApiConfig } from "@/lib/config";
import { notesField } from "./fixtures/native-editor";
import { supportDialogs } from "./fixtures/dialogs";

const alice = { id: 2, username: "alice" };
const admin = { id: 1, username: "admin" };
const packed = `${btoa("receipt.pdf")}_${btoa("Receipt.pdf")}_extra`;

const proxyConfig = {
  MODE: "production",
  DISABLE_AUTH: false,
  AUTH_CLASS: "Grocy\\Middleware\\ReverseProxyAuthMiddleware",
  BASE_URL: "/",
  DISABLE_URL_REWRITING: false,
  FEATURE_FLAG_STOCK: false,
  FEATURE_FLAG_SHOPPINGLIST: false,
  FEATURE_FLAG_EQUIPMENT: true,
};

const record = {
  id: 1,
  name: "Shared mixer",
  description: "<p>Shared notes</p>",
  instruction_manual_file_name: "manual.pdf",
  userfields: { receipt: packed },
};

const fields = [{ ...notesField("equipment"), name: "receipt", caption: "Receipt", type: "file" }];

const grants = (id: number) => ({
  EQUIPMENT: true,
  ADMIN: id === 1,
  MASTER_DATA_EDIT: id === 1,
  USERS_READ: id === 1,
});

type Read = {
  path: string;
  key: string | null;
  signal?: AbortSignal | null;
  storedKey: string | null;
  method: string;
};

type IdentityReply = { status: number; body: unknown };

function mountBrowserPage({
  browserAvailable = true,
  holdBare = false,
  warmAdmin = false,
  bareReply,
  path = "/equipment",
  holdIdentities = false,
  strictMode = false,
  config = {},
  browserActor = "alice",
  profile,
  envKey,
  cookieSupplied = false,
  contextReply,
}: {
  browserAvailable?: boolean;
  holdBare?: boolean;
  warmAdmin?: boolean;
  bareReply?: IdentityReply;
  path?: string;
  holdIdentities?: boolean;
  strictMode?: boolean;
  config?: JsonObject;
  browserActor?: "alice" | "admin";
  profile?: { first_name: string; last_name: string; picture_file_name: string | null };
  envKey?: string;
  cookieSupplied?: boolean;
  contextReply?: IdentityReply;
} = {}) {
  supportDialogs();
  vi.stubEnv("VITE_API_BASE", undefined);
  vi.stubEnv("VITE_API_KEY", envKey);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:browser-identity";
      }
      static revokeObjectURL() {}
    },
  );
  const reads: Read[] = [];
  const pending: Array<{ read: Read; release: () => void }> = [];
  let available = browserAvailable;
  let held = false;
  let loggedOut = false;
  const serverConfig = { ...proxyConfig, ...config };
  let identityOpen = !holdIdentities;
  const creations: Array<{ read: Read; owner: number; id: number }> = [];
  const ownKeys: NativeApiKey[] = [];

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), window.location.origin);
    const path = url.pathname + url.search;
    const key = new Headers(init?.headers).get("GROCY-API-KEY");

    const read = {
      path,
      key,
      signal: init?.signal,
      storedKey: localStorage.getItem(configStorageKeys().key),
      method: init?.method ?? "GET",
    };

    reads.push(read);

    const baseActor =
      key === "dev-key"
        ? admin
        : available
          ? browserActor === "admin"
            ? admin
            : alice
          : undefined;

    const actor = !loggedOut && baseActor ? { ...baseActor, ...profile } : undefined;

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/v2/system/login-context")
      return contextReply
        ? Response.json(contextReply.body, { status: contextReply.status })
        : Response.json({
            login_url: "/login",
            logout_url: "/logout",
            browser_session_supplied: cookieSupplied,
          });

    if (path === "/logout" && read.method === "GET") {
      available = false;

      return new Response(null, { status: 302, headers: { Location: "/" } });
    }

    if (path === "/api/v2/logout") {
      if (init?.method !== "POST") return new Response(null, { status: 405 });
      loggedOut = true;

      return new Response(null, { status: 204 });
    }

    if (path === "/api/user") {
      const response =
        key === null && bareReply
          ? Response.json(bareReply.body, { status: bareReply.status })
          : actor
            ? Response.json([actor])
            : Response.json({ error_message: "Authentication required" }, { status: 401 });

      if (!identityOpen || (key === null && holdBare && !held)) {
        held = true;
        await new Promise<void>((release) => pending.push({ read, release }));
      }

      return response;
    }

    if (!actor) return Response.json({ error_message: "Authentication required" }, { status: 401 });

    if (path.startsWith("/api/v2/access/api-keys/new")) {
      const id = 100 + creations.length + 1;
      creations.push({ read, owner: actor.id, id });
      ownKeys.push({
        id,
        user_id: actor.id,
        api_key: `OWN-${actor.id}-${id}`,
        description: new URL(path, window.location.origin).searchParams.get("description"),
        key_type: "default",
        expires: "2999-12-31 23:59:59",
        last_used: null,
        row_created_timestamp: "2026-01-01 12:00:00",
      });

      return Response.json({ id });
    }

    if (path.startsWith("/api/v2/access/api-keys-context"))
      return Response.json({
        keys: ownKeys.filter((key) => actor.id === 1 || key.user_id === actor.id),
        users: [
          { ...alice, first_name: null, last_name: null },
          { ...admin, first_name: null, last_name: null },
        ],
        selected_key_id: new URL(path, window.location.origin).searchParams.get("key") ?? -1,
      });

    if (path === "/api/system/config") return Response.json(serverConfig);

    if (path === "/api/system/info") return Response.json({ grocy_version: { Version: "test" } });

    if (path === "/api/user/settings") return Response.json({});

    if (path.startsWith("/api/user/settings/")) return new Response(null, { status: 204 });

    if (path === "/api/v2/user/permissions") return Response.json(grants(actor.id));

    if (path.startsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    if (path === "/api/v2/custom-data/fields" || path.startsWith("/api/objects/userfields"))
      return Response.json(fields);

    if (path === "/api/objects/equipment") return Response.json([record]);

    if (path === "/api/objects/equipment/1") return Response.json(record);

    if (path === "/api/v2/content/equipment/1") return Response.json({ html: record.description });

    if (path.startsWith("/api/files/equipmentmanuals/") || path.startsWith("/files/userfiles/"))
      return new Response("%PDF-identity", { headers: { "Content-Type": "application/pdf" } });

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });

  if (warmAdmin) {
    client.setQueryData(queryKeys.currentUser, admin);
    client.setQueryData(queryKeys.systemConfig, proxyConfig);
    client.setQueryData(["user-permissions"], grants(admin.id));
  }

  const router = createAppRouter({
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  const contents = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  const view = render(strictMode ? <StrictMode>{contents}</StrictMode> : contents);

  onTestFinished(() => {
    view.unmount();
    client.clear();
  });

  return {
    ...view,
    client,
    router,
    reads,
    pending,
    creations,
    releaseIdentities: () => {
      identityOpen = true;
      pending.forEach((reply) => reply.release());
    },
    disableBrowser: () => {
      available = false;
    },
  };
}

type App = ReturnType<typeof mountBrowserPage>;

const identities = (app: App) => app.reads.filter((read) => read.path === "/api/user");

const protectedReads = (app: App, after = 0) =>
  app.reads
    .slice(after)
    .filter((read) =>
      [
        "/api/system/config",
        "/api/v2/user/permissions",
        "/api/objects/equipment",
        "/api/objects/equipment/1",
      ].includes(read.path),
    );

async function expectBrowserView(app: App) {
  const manual = await screen.findByLabelText<HTMLEmbedElement>("Instruction manual", {
    selector: "embed",
  });

  await waitFor(() =>
    expect(manual.getAttribute("src")).toBe(
      `${window.location.origin}/api/files/equipmentmanuals/bWFudWFsLnBkZg==`,
    ),
  );
  expect(app.client.getQueryData(queryKeys.currentUser)).toMatchObject(alice);
  expect(screen.getByRole("link", { name: "Manage users" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  await userEvent.setup().click(screen.getByRole("tab", { name: "Receipt" }));
  const panel = screen.getByRole("tabpanel", { name: "Receipt" });
  const file = within(panel).getByLabelText<HTMLEmbedElement>("Receipt", { selector: "embed" });
  await waitFor(() =>
    expect(file.getAttribute("src")).toBe(`${window.location.origin}/files/userfiles/${packed}`),
  );
  expect(within(panel).getByRole("link", { name: "Download file" }).getAttribute("href")).toBe(
    file.getAttribute("src"),
  );
  expect(protectedReads(app).length).toBeGreaterThan(0);
  expect(protectedReads(app).every((read) => read.key === null)).toBe(true);
  expect(app.reads.some((read) => read.path.startsWith("/api/files/equipmentmanuals/"))).toBe(
    false,
  );
}

async function expectKeyView(app: App, after = 0) {
  await screen.findByLabelText("Instruction manual", { selector: "object" });
  expect(app.client.getQueryData(queryKeys.currentUser)).toMatchObject(admin);
  expect(
    screen.getByRole("link", { name: "Manage users" }).getAttribute("aria-disabled"),
  ).toBeNull();
  expect(protectedReads(app, after).every((read) => read.key === "dev-key")).toBe(true);
  expect(
    app.reads.some(
      (read) => read.path.startsWith("/api/files/equipmentmanuals/") && read.key === "dev-key",
    ),
  ).toBe(true);
}

test("fresh proxy identity replaces warm Admin cache before metadata and never falls back after a later browser401", async () => {
  expect(localStorage.length).toBe(0);
  const app = mountBrowserPage({ holdBare: true, warmAdmin: true });
  await waitFor(() => expect(identities(app).length).toBeGreaterThan(0));
  expect(identities(app)[0]!.key).toBeNull();
  expect(protectedReads(app)).toEqual([]);
  expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
  await act(async () => app.pending[0]!.release());
  await expectBrowserView(app);
  expect(identities(app).every((read) => read.key === null)).toBe(true);
  expect(cookieSessionSelected()).toBe(false);
  expect(localStorage.length).toBe(0);
  app.disableBrowser();
  const before = app.reads.length;
  await act(async () =>
    app.client.refetchQueries({ queryKey: queryKeys.currentUser, exact: true }),
  );
  await screen.findByLabelText("Username");
  const later = app.reads.slice(before).filter((read) => read.path === "/api/user");
  expect(later.length).toBeGreaterThan(0);
  expect(later.every((read) => read.key === null)).toBe(true);
  expect(app.client.getQueryState(queryKeys.currentUser)?.error).toMatchObject({ status: 401 });
  expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
  expect(localStorage.length).toBe(0);
});

test("a deliberate saved Connection keeps Admin identity and authenticated Blob resources", async () => {
  writeApiConfig({ baseUrl: "/", apiKey: "dev-key" });
  const app = mountBrowserPage();
  await expectKeyView(app);
  expect(identities(app).every((read) => read.key === "dev-key")).toBe(true);
  expect(localStorage.getItem(configStorageKeys().key)).toBe("dev-key");
  expect(cookieSessionSelected()).toBe(false);
});

test("an initial bare401 permits implicit-key fallback and that key choice stays settled", async () => {
  const app = mountBrowserPage({ browserAvailable: false });
  await expectKeyView(app);
  expect(identities(app)[0]!.key).toBeNull();
  expect(
    identities(app)
      .slice(1)
      .every((read) => read.key === "dev-key"),
  ).toBe(true);
  const before = app.reads.length;
  await act(async () =>
    app.client.refetchQueries({ queryKey: queryKeys.currentUser, exact: true }),
  );
  expect(
    app.reads
      .slice(before)
      .filter((read) => read.path === "/api/user")
      .every((read) => read.key === "dev-key"),
  ).toBe(true);
  expect(localStorage.length).toBe(0);
});

test("a retired root's held bare success cannot replace the next root's settled key identity", async () => {
  const first = mountBrowserPage({ holdBare: true });
  await waitFor(() => expect(identities(first).length).toBeGreaterThan(0));
  expect(identities(first)[0]!.key).toBeNull();
  first.unmount();
  expect(first.pending[0]!.read.signal?.aborted).toBe(true);
  const next = mountBrowserPage({ browserAvailable: false });
  await expectKeyView(next);
  await act(async () => first.pending[0]!.release());
  expect(protectedReads(first)).toEqual([]);
  const before = next.reads.length;
  await act(async () =>
    next.client.refetchQueries({ queryKey: queryKeys.currentUser, exact: true }),
  );
  const later = next.reads.slice(before).filter((read) => read.path === "/api/user");
  expect(later.length).toBeGreaterThan(0);
  expect(later.every((read) => read.key === "dev-key")).toBe(true);
  expect(next.client.getQueryData(queryKeys.currentUser)).toMatchObject(admin);
  expect(screen.getByLabelText("Instruction manual", { selector: "object" })).toBeTruthy();
});

test("saving an explicit Connection retires browser metadata before reading the key actor", async () => {
  const app = mountBrowserPage();
  await expectBrowserView(app);
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  const key = await screen.findByLabelText("API key");
  await userEvent.setup().type(key, "dev-key");
  await userEvent.setup().click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => expect(localStorage.getItem(configStorageKeys().key)).toBe("dev-key"));
  await waitFor(() => expect(app.client.getQueryData(queryKeys.currentUser)).toMatchObject(admin));
  // The observer and shell must change at Save, before another route can remount them.
  await screen.findByRole("link", { name: "Sign out" });
  expect(screen.queryByRole("button", { name: "User: alice" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "Manage users" }).getAttribute("aria-disabled"),
  ).toBeNull();
  expect((await screen.findByText("Connection saved.")).getAttribute("role")).toBe("status");
  const draftKey = screen.getByLabelText("API key");
  await userEvent.setup().type(draftKey, "-draft");
  expect(screen.queryByText("Connection saved.")).toBeNull();
  await userEvent.setup().clear(draftKey);
  await userEvent.setup().type(draftKey, "dev-key");
  expect(screen.queryByText("Connection saved.")).toBeNull();
  const after = app.reads.length;
  await act(async () => app.router.navigate({ to: "/equipment" }));
  await expectKeyView(app, after);
  const afterChoice = protectedReads(app).filter((read) => read.storedKey === "dev-key");
  expect(afterChoice.length).toBeGreaterThan(0);
  expect(afterChoice.every((read) => read.key === "dev-key")).toBe(true);
  expect(
    identities(app)
      .filter((read) => read.storedKey === "dev-key")
      .every((read) => read.key === "dev-key"),
  ).toBe(true);
});

test.each([
  {
    label: "server500",
    status: 500,
    body: { error_message: "Identity unavailable" },
    expected: 500,
  },
  { label: "empty200", status: 200, body: [], expected: 502 },
  { label: "malformed200", status: 200, body: [{ id: 2, username: 42 }], expected: 502 },
])(
  "initial $label never selects the privileged fallback or starts domain metadata",
  async ({ status, body, expected }) => {
    const app = mountBrowserPage({ bareReply: { status, body } });
    await waitFor(() => expect(identities(app).length).toBeGreaterThan(0));
    expect(identities(app)[0]!.key).toBeNull();
    await screen.findByRole("alert");
    expect(app.client.getQueryState(queryKeys.currentUser)?.error).toMatchObject({
      status: expected,
    });
    expect(identities(app).every((read) => read.key === null)).toBe(true);
    expect(protectedReads(app)).toEqual([]);
    expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
    expect(localStorage.length).toBe(0);
  },
);

test.each([false, true])(
  "direct key creation waits for selected identity and is once-only in StrictMode (explicit=%s)",
  async (explicit) => {
    if (explicit) writeApiConfig({ baseUrl: "/", apiKey: "dev-key" });

    const app = mountBrowserPage({
      path: "/manageapikeys/new?description=Proxy%20owned",
      holdIdentities: true,
      strictMode: true,
    });

    await waitFor(() =>
      expect(app.pending.some((reply) => !reply.read.signal?.aborted)).toBe(true),
    );

    if (!explicit) {
      expect(identities(app).every((read) => read.key === null)).toBe(true);
      expect(app.creations).toEqual([]);
    }

    await act(async () => app.releaseIdentities());
    const table = await screen.findByRole("table", { name: "API keys" });
    const owner = explicit ? admin : alice;
    expect(app.creations).toHaveLength(1);
    expect(app.creations[0]!.owner).toBe(owner.id);
    expect(app.creations[0]!.read.key).toBe(explicit ? "dev-key" : null);
    expect(app.creations[0]!.read.path).toBe(
      "/api/v2/access/api-keys/new?description=Proxy%20owned",
    );

    const row = within(table)
      .getByRole("cell", { name: `OWN-${owner.id}-101` })
      .closest("tr")!;

    expect(within(row).getByRole("cell", { name: owner.username })).toBeTruthy();
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(app.client.getQueryData(queryKeys.currentUser)).toMatchObject(owner);

    if (!explicit) expect(localStorage.length).toBe(0);
  },
);

test("departing direct key creation while identity is held prevents a later write", async () => {
  const app = mountBrowserPage({
    path: "/manageapikeys/new?description=Retired",
    holdIdentities: true,
    strictMode: true,
  });

  await waitFor(() => expect(app.pending.some((reply) => !reply.read.signal?.aborted)).toBe(true));
  expect(app.creations).toEqual([]);
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await act(async () => app.releaseIdentities());
  await screen.findByRole("heading", { name: "Settings" });
  expect(app.creations).toEqual([]);
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(app.client.getQueryData(queryKeys.currentUser)).toMatchObject(alice);
});

type NativeAccountCase = {
  label: string;
  disabled?: string | number | boolean | null;
  mode?: string;
  actor?: "alice" | "admin";
  visible: boolean;
  action?: "Edit user" | "Change password";
  picture?: boolean;
  authClass?: string;
};

const nativeAccountCases: NativeAccountCase[] = [
  { label: "absent flag", visible: true, picture: true },
  { label: "false flag", disabled: false, visible: true },
  { label: "exact LDAP class", visible: true, authClass: "Grocy\\Middleware\\LdapAuthMiddleware" },
  {
    label: "ordinary default auth",
    visible: true,
    authClass: "Grocy\\Middleware\\DefaultAuthMiddleware",
    action: "Change password",
  },
  {
    label: "class name containing LDAP is not external",
    visible: true,
    authClass: "CustomLdapAuthMiddleware",
    action: "Change password",
  },
  { label: "numeric zero", disabled: 0, visible: true },
  { label: "string zero", disabled: "0", visible: true },
  { label: "empty string", disabled: "", visible: true },
  { label: "null flag", disabled: null, visible: true },
  { label: "true flag", disabled: true, actor: "admin", visible: false },
  { label: "truthy string false", disabled: "false", actor: "admin", visible: false },
  {
    label: "dev bypass",
    disabled: false,
    mode: "dev",
    actor: "admin",
    visible: true,
    action: "Change password",
  },
  {
    label: "demo bypass",
    disabled: false,
    mode: "demo",
    actor: "admin",
    visible: true,
    action: "Change password",
  },
  {
    label: "prerelease bypass",
    disabled: false,
    mode: "prerelease",
    actor: "admin",
    visible: true,
    action: "Change password",
  },
];

test.each(nativeAccountCases)(
  "automatic browser account respects source $label",
  async ({
    disabled,
    mode = "production",
    actor = "alice",
    visible,
    action = "Edit user",
    picture = false,
    authClass = proxyConfig.AUTH_CLASS,
  }) => {
    const base = picture ? `${window.location.origin}/house.hold/` : "/";

    const config: JsonObject = {
      ...proxyConfig,
      MODE: mode,
      AUTH_CLASS: authClass,
      BASE_URL: base,
      DISABLE_URL_REWRITING: picture,
    };

    delete config.DISABLE_AUTH;

    if (disabled !== undefined) config.DISABLE_AUTH = disabled;

    const app = mountBrowserPage({
      config,
      browserActor: actor,
      profile: {
        first_name: "Given",
        last_name: "Family",
        picture_file_name: picture ? "用户.png" : null,
      },
    });

    await screen.findByRole("columnheader", { name: "Name" });
    const username = actor === "alice" ? "alice" : "admin";
    expect(app.client.getQueryData(queryKeys.currentUser)).toMatchObject({
      id: actor === "alice" ? 2 : 1,
      username,
    });
    expect(cookieSessionSelected()).toBe(false);
    expect(localStorage.length).toBe(0);

    if (!visible) {
      expect(screen.queryByRole("button", { name: `User: ${username}` })).toBeNull();
      expect(screen.queryByRole("link", { name: "Logout" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();

      return;
    }

    const trigger = screen.getByRole("button", { name: `User: ${username}` });
    expect(trigger.textContent?.trim()).toBe(username);

    if (picture) {
      const image = trigger.querySelector("img")!;
      expect(image.getAttribute("src")).toBe(
        `${base}index.php/files/userpictures/55So5oi3LnBuZw==_55So5oi3LnBuZw==?force_serve_as=picture&best_fit_width=32&best_fit_height=32`,
      );
      expect(image.getAttribute("loading")).toBe("lazy");
      expect(image.getAttribute("width")).toBeNull();
      expect(image.getAttribute("height")).toBeNull();
    } else expect(trigger.querySelector("img")).toBeNull();
    await userEvent.setup().click(trigger);
    const prefix = picture ? `${base}index.php` : window.location.origin;
    const logout = screen.getByRole("link", { name: "Logout" });
    expect(logout.getAttribute("href")).toBe(`${prefix}/logout`);
    const user = screen.getByRole("link", { name: action });
    expect(user.getAttribute("href")).toBe(
      `${prefix}/user/${actor === "alice" ? 2 : 1}${action === "Change password" ? "?changepw=true" : ""}`,
    );
    expect(
      screen.queryByRole("link", {
        name: action === "Edit user" ? "Change password" : "Edit user",
      }),
    ).toBeNull();

    if (picture) {
      const intercepted: boolean[] = [];

      const stopNavigation = (event: MouseEvent) => {
        intercepted.push(event.defaultPrevented);
        event.preventDefault();
      };

      document.addEventListener("click", stopNavigation);
      onTestFinished(() => document.removeEventListener("click", stopNavigation));
      fireEvent.click(user, { button: 0, ctrlKey: true });
      expect(intercepted).toEqual([false]);
      await userEvent.setup().click(trigger);
      intercepted.length = 0;
      fireEvent.click(screen.getByRole("link", { name: "Logout" }), { button: 0 });
      expect(intercepted).toEqual([false]);
      expect(app.router.state.location.pathname).toBe("/equipment");
    }

    expect(app.reads.some((read) => read.path === "/api/v2/logout")).toBe(false);
  },
);

test("native account disclosure supports arrows, Escape focus restoration and outside dismissal", async () => {
  mountBrowserPage();
  const trigger = await screen.findByRole("button", { name: "User: alice" });
  const user = userEvent.setup();
  await user.click(trigger);
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Logout" }));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Edit user" }));
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Logout" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("link", { name: "Logout" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await user.click(trigger);
  await user.click(screen.getByRole("heading", { name: "Equipment" }));
  expect(screen.queryByRole("link", { name: "Logout" })).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await user.click(trigger);
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Edit user" }));
  await user.tab();
  expect(screen.queryByRole("link", { name: "Logout" })).toBeNull();
  expect(document.activeElement).not.toBe(trigger);
  expect(document.activeElement).not.toBe(document.body);
});

test.each(["saved", "build", "fallback"] as const)(
  "%s key transport retains modern sign-out and revocation",
  async (choice) => {
    if (choice === "saved") writeApiConfig({ baseUrl: "/", apiKey: "dev-key" });

    const app = mountBrowserPage({
      browserAvailable: choice !== "fallback",
      envKey: choice === "build" ? "dev-key" : undefined,
      config: { AUTH_CLASS: "Grocy\\Middleware\\DefaultAuthMiddleware" },
    });

    await expectKeyView(app);
    expect(screen.queryByRole("button", { name: /^User:/ })).toBeNull();
    const link = screen.getByRole("link", { name: "Sign out" });
    expect(link.getAttribute("href")).toBe("/signout");
    await userEvent.setup().click(link);
    await screen.findByLabelText("Username");
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/signin"));
    const logout = app.reads.filter((read) => read.path === "/api/v2/logout");
    expect(logout).toHaveLength(1);
    expect(logout[0]).toMatchObject({ method: "POST", key: "dev-key" });
    expect(localStorage.getItem(configStorageKeys().key)).toBeNull();
  },
);

test("native GET logout leaves a stale browser cookie that cannot select implicit Admin on the next root", async () => {
  const first = mountBrowserPage({ cookieSupplied: true });
  await expectBrowserView(first);
  expect(cookieSessionSelected()).toBe(false);
  await userEvent.setup().click(screen.getByRole("button", { name: "User: alice" }));
  const link = screen.getByRole("link", { name: "Logout" });
  const destination = link.getAttribute("href")!;
  const intercepted: boolean[] = [];

  const stopNavigation = (event: MouseEvent) => {
    intercepted.push(event.defaultPrevented);
    event.preventDefault();
  };

  document.addEventListener("click", stopNavigation);
  fireEvent.click(link);
  document.removeEventListener("click", stopNavigation);
  expect(intercepted).toEqual([false]);
  // A full native document request removes the SQL session, while the cookie remains supplied.
  expect((await fetch(destination)).status).toBe(302);
  expect(first.reads.filter((read) => read.path === "/logout")).toMatchObject([
    { method: "GET", key: null },
  ]);
  expect(first.reads.some((read) => read.path === "/api/v2/logout")).toBe(false);
  first.unmount();

  const next = mountBrowserPage({ browserAvailable: false, cookieSupplied: true });
  await screen.findByLabelText("Username");
  expect(identities(next).length).toBeGreaterThan(0);
  expect(identities(next).every((read) => read.key === null)).toBe(true);
  expect(next.client.getQueryState(queryKeys.currentUser)?.error).toMatchObject({ status: 401 });
  expect(next.reads.every((read) => read.key === null)).toBe(true);
  expect(
    next.reads.some(
      (read) => read.path === "/api/objects/equipment" || read.path === "/api/v2/user/permissions",
    ),
  ).toBe(false);
  expect(cookieSessionSelected()).toBe(false);
  expect(localStorage.length).toBe(0);
});

test.each([
  { label: "missing hint", body: { login_url: "/login", logout_url: "/logout" }, status: 200 },
  {
    label: "nonboolean hint",
    body: { login_url: "/login", logout_url: "/logout", browser_session_supplied: "false" },
    status: 200,
  },
  { label: "unavailable hint", body: { error_message: "Context unavailable" }, status: 503 },
])(
  "initial bare401 with $label never borrows the valid implicit Admin key",
  async ({ body, status }) => {
    const app = mountBrowserPage({ browserAvailable: false, contextReply: { body, status } });
    await waitFor(() =>
      expect(app.client.getQueryState(queryKeys.currentUser)?.status).toBe("error"),
    );
    await waitFor(() =>
      expect(app.client.getQueryState(queryKeys.currentUser)?.fetchStatus).toBe("idle"),
    );
    expect(identities(app).length).toBeGreaterThan(0);
    expect(identities(app).every((read) => read.key === null)).toBe(true);
    expect(app.client.getQueryState(queryKeys.currentUser)?.error).toMatchObject({ status: 401 });
    expect(app.reads.every((read) => read.key === null)).toBe(true);
    expect(
      app.reads.some(
        (read) =>
          read.path === "/api/objects/equipment" || read.path === "/api/v2/user/permissions",
      ),
    ).toBe(false);
    expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
    expect(localStorage.length).toBe(0);
  },
);
