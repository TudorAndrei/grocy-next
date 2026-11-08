import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { LocalizationProvider } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { EntityManager } from "@/components/EntityManager";
import { supportDialogs } from "./fixtures/dialogs";
import { selectCookieSession } from "@/lib/config";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountNativeFreshness(path = "/about") {
  supportDialogs();
  vi.stubGlobal("scrollTo", vi.fn());
  const server = { locale: "en", price: true, actor: 7, editable: true };
  const reads: string[] = [];
  let configGate: ReturnType<typeof deferred> | undefined;
  let keyGate: ReturnType<typeof deferred> | undefined;
  let deleteGate: ReturnType<typeof deferred> | undefined;
  let resetGate: ReturnType<typeof deferred> | undefined;
  const settingWrites: { key: string; method: string }[] = [];

  const tableSettings = new Map([
    ["datatables_rowGroup_apikeys-table", '{"enable":true,"dataSrc":"3"}'],
  ]);

  const deleted: number[] = [];
  selectCookieSession();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      reads.push(url);

      if (url === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (url === "/api/v2/system/login-context")
        return Response.json({ login_url: "/login", logout_url: "/logout" });

      if (url === "/api/user") {
        expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBeNull();

        return Response.json([{ id: server.actor, username: `actor-${server.actor}` }]);
      }

      if (url === "/api/v2/user/permissions")
        return Response.json({
          MASTER_DATA_EDIT: server.editable,
          USERS_READ: server.editable,
          CALENDAR: true,
        });

      if (url.startsWith("/api/v2/access/api-keys-context")) {
        const actor = server.actor;
        const gate = keyGate;
        keyGate = undefined;

        if (gate) await gate.promise;

        return Response.json({
          keys: [
            {
              id: 71,
              user_id: actor,
              api_key: `SECRET-${actor}`,
              description: "Phone",
              key_type: "default",
              expires: "2999-12-31 23:59:59",
              last_used: null,
              row_created_timestamp: "2025-01-01 00:00:00",
            },
          ],
          users: [{ id: actor, username: `actor-${actor}`, first_name: null, last_name: null }],
          selected_key_id: -1,
        });
      }

      if (url === "/api/objects/api_keys/71" && init?.method === "DELETE") {
        if (deleteGate) await deleteGate.promise;
        deleted.push(71);

        return new Response(null, { status: 204 });
      }

      const config = {
        LOCALE: server.locale,
        FEATURE_FLAG_STOCK: false,
        FEATURE_FLAG_SHOPPINGLIST: false,
        FEATURE_FLAG_STOCK_PRICE_TRACKING: server.price,
        FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
      };

      const settings = {
        ...Object.fromEntries(tableSettings),
        locale: server.locale,
        stock_decimal_places_amounts: 2,
        tasks_due_soon_days: 5,
      };

      if (url === "/api/system/config") {
        const gate = configGate;
        configGate = undefined;

        if (gate) await gate.promise;

        return Response.json(config);
      }

      if (url === "/api/user/settings") return Response.json(settings);

      if (url.startsWith("/api/user/settings/") && init?.method) {
        const key = decodeURIComponent(url.split("/").at(-1)!);
        settingWrites.push({ key, method: init.method });

        if (init.method === "DELETE") {
          if (key === "datatables_rowGroup_apikeys-table" && resetGate) await resetGate.promise;
          tableSettings.delete(key);
        } else tableSettings.set(key, JSON.parse(String(init.body)).value);

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/v2/localization")) {
        const selected = new URL(url, "http://grocy.test").searchParams.get("locale") ?? "en";

        return Response.json({
          locale: selected,
          direction: "ltr",
          languages: ["en", "de", "fr"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: {
              "":
                selected === "de"
                  ? {
                      "Stock settings": ["Lagereinstellungen"],
                      Calendar: ["Kalender"],
                      "Configure colors": ["Farben konfigurieren"],
                      moment_locale: ["de"],
                      fullcalendar_locale: ["de"],
                      Username: ["Benutzername"],
                    }
                  : selected === "fr"
                    ? { "Barcode scanner testing": ["Test du scanner"] }
                    : {},
            },
          },
        });
      }

      if (url === "/api/v2/system/about")
        return Response.json({
          system_info: {
            grocy_version: { Version: "4.5.0", ReleaseDate: "2025-03-28" },
            php_version: "",
            python_version: "3.13",
            sqlite_version: "3",
            db_version: 254,
            os: "Linux",
            client: "Test",
          },
          changelog: { newest_release_number: 80, changelog_items: [] },
        });

      if (url === "/api/v2/settings/stock-context")
        return Response.json({ locations: [], quantity_units: [], product_groups: [] });

      if (url === "/api/v2/calendar/context")
        return Response.json({
          events: [],
          user_settings: settings,
          config,
          locale: server.locale,
        });

      return Response.json([]);
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  });

  const router = createAppRouter({
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return {
    client,
    router,
    server,
    reads,
    deleted,
    settingWrites,
    holdReset: () => {
      resetGate = deferred();

      return resetGate;
    },
    holdKeys: () => {
      keyGate = deferred();

      return keyGate;
    },
    holdDelete: () => {
      deleteGate = deferred();

      return deleteGate;
    },
    holdConfig: () => {
      configGate = deferred();

      return configGate;
    },
  };
}

test("native document hops refresh actor/grants/config/settings/catalog and retire old actor reads and writes", async () => {
  const app = mountNativeFreshness("/manageapikeys");
  await screen.findByText("SECRET-7");
  const oldRead = app.holdKeys();
  void app.client.refetchQueries({ queryKey: ["native-api-keys"] });
  const oldWrite = app.holdDelete();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Delete this item" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  const oldReset = app.holdReset();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Table options" })).getByRole("button", {
      name: "Reset",
    }),
  );
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() =>
    expect(app.settingWrites).toContainEqual({
      key: "datatables_rowGroup_apikeys-table",
      method: "DELETE",
    }),
  );

  const resetDeletesBeforeDeparture = app.settingWrites.filter(
    (write) => write.method === "DELETE",
  );

  expect(resetDeletesBeforeDeparture).toEqual([
    { key: "datatables_rowGroup_apikeys-table", method: "DELETE" },
    { key: "datatables_state_apikeys-table", method: "DELETE" },
  ]);
  app.server.locale = "de";
  app.server.price = false;
  app.server.actor = 2;
  app.server.editable = false;
  await act(() => app.router.navigate({ to: "/stocksettings" }));
  await screen.findByRole("heading", { name: "Lagereinstellungen" });
  expect(document.documentElement.lang).toBe("de");
  expect(
    screen.queryByRole("spinbutton", { name: "Decimal places allowed for prices (input)" }),
  ).toBeNull();
  expect(app.client.getQueryData(["user", "settings"])).toMatchObject({ locale: "de" });
  expect(app.client.getQueryData(["user", "current"])).toMatchObject({ id: 2 });
  expect(screen.getByRole("link", { name: "Manage users" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  await act(async () => {
    oldRead.release();
    oldWrite.release();
    oldReset.release();
  });
  await waitFor(() => expect(app.deleted).toEqual([71]));
  expect(app.client.getQueryData(["native-api-keys", ""])).toBeUndefined();
  expect(app.client.getQueryData(["user", "current"])).toMatchObject({ id: 2 });
  expect(app.settingWrites.filter((write) => write.method === "DELETE")).toEqual(
    resetDeletesBeforeDeparture,
  );
  expect(screen.queryByText("SECRET-7")).toBeNull();
  expect(app.router.history.location.pathname).toBe("/stocksettings");
});

test("native Login uses its public catalog instead of a warm authenticated account locale", async () => {
  const app = mountNativeFreshness("/stocksettings");
  await screen.findByRole("heading", { name: "Stock settings" });
  app.server.locale = "de";
  await act(() => app.router.navigate({ to: "/calendar" }));
  await screen.findByRole("heading", { name: "Kalender", level: 1 });
  const beforeLogin = app.reads.length;
  await act(() => app.router.navigate({ to: "/login" }));
  await screen.findByRole("textbox", { name: "Username" });
  await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  expect(screen.queryByRole("textbox", { name: "Benutzername" })).toBeNull();
  expect(app.reads.slice(beforeLogin)).toContain("/api/v2/localization");
  expect(app.reads.slice(beforeLogin).some((url) => url.includes("locale=de"))).toBe(false);
});

test("partial native URI edits and background reads preserve the current catalog, while explicit calendar reload starts a fresh document", async () => {
  const app = mountNativeFreshness("/calendar?keep=initial#bookmark");
  await screen.findByRole("heading", { name: "Calendar", level: 1 });
  app.server.locale = "de";
  const before = app.reads.length;
  await act(() =>
    app.router.navigate({
      to: "/calendar",
      search: { keep: "changed" },
      hash: "local",
      replace: true,
    }),
  );
  expect(
    app.reads
      .slice(before)
      .filter((url) => url === "/api/system/config" || url === "/api/user/settings"),
  ).toEqual([]);
  await act(() => app.client.refetchQueries({ queryKey: ["system", "config"] }));
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByRole("heading", { name: "Calendar", level: 1 })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Configure colors" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Configure colors" })).getByRole("button", {
      name: "OK",
    }),
  );
  await screen.findByRole("heading", { name: "Kalender", level: 1 });
  expect(document.documentElement.lang).toBe("de");
  expect(app.router.history.location.search).toBe("");
  expect(app.router.history.location.hash).toBe("");
  app.server.locale = "en";
  await user.click(screen.getByRole("link", { name: "Kalender" }));
  await screen.findByRole("heading", { name: "Calendar", level: 1 });
  expect(document.documentElement.lang).toBe("en");
});

test("departed native preparation cannot publish a held old config or start its catalog after a newer page is ready", async () => {
  const app = mountNativeFreshness();
  await screen.findByRole("table", { name: "System info" });
  const held = app.holdConfig();
  app.server.locale = "de";
  await act(() => app.router.navigate({ to: "/stocksettings" }));
  await waitFor(() =>
    expect(app.reads.filter((url) => url === "/api/system/config").length).toBeGreaterThan(1),
  );
  app.server.locale = "fr";
  await act(() => app.router.navigate({ to: "/barcodescannertesting" }));
  await screen.findByRole("heading", { name: "Test du scanner" });
  await act(async () => held.release());
  expect(document.documentElement.lang).toBe("fr");
  expect(app.client.getQueryData(["system", "config"])).toMatchObject({ LOCALE: "fr" });
  expect(app.client.getQueryData(["user", "settings"])).toMatchObject({ locale: "fr" });
  expect(app.reads.some((url) => url.includes("/api/v2/localization?locale=de"))).toBe(false);
});

test("the saved language translates navigation and can be changed without changing field values", async () => {
  let locale = "de";
  let saved: Record<string, string> | undefined;
  localStorage.setItem("grocy_next_theme", "light");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "German household" }]);

      if (path === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (path === "/api/system/config") return Response.json({ LOCALE: locale });

      if (path === "/api/user/settings")
        return Response.json({ locale, stock_default_purchase_amount: 2 });

      if (path === "/api/v2/user/settings" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body));
        locale = saved?.locale ?? locale;

        return Response.json(saved);
      }

      if (path.startsWith("/api/v2/localization")) {
        const language = new URL(path, "http://localhost").searchParams.get("locale") ?? "de";

        const translations =
          language === "ru"
            ? {
                Settings: ["Настройки"],
                Products: ["Продукты"],
                Language: ["Язык"],
                de: ["Немецкий"],
                ru: ["Русский"],
              }
            : {
                Settings: ["Einstellungen"],
                Products: ["Produkte"],
                Language: ["Sprache"],
                Next: ["Weiter"],
                de: ["Deutsch"],
                ru: ["Russisch"],
              };

        return Response.json({
          locale: language,
          direction: "ltr",
          languages: ["de", "ru"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: { "": translations },
          },
        });
      }

      return Response.json(path.includes("shopping") ? { items: [] } : []);
    }),
  );

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/settings?tab=preferences"] }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Einstellungen" });
  // This fixture does not translate the source disclosure label.
  await userEvent.setup().click(screen.getByRole("button", { name: "Manage master data" }));
  await screen.findByRole("link", { name: "Produkte" });
  expect(document.documentElement.lang).toBe("de");
  expect(screen.getByRole("link", { name: "Grocy Next, Home" }).textContent).toContain(
    "Grocy Next",
  );
  const language = screen.getByRole<HTMLSelectElement>("combobox", { name: "Sprache" });
  expect(language.value).toBe("de");
  expect(screen.getByLabelText<HTMLInputElement>("Default amount for purchase").value).toBe("2");
  const user = userEvent.setup();
  await user.selectOptions(language, "ru");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { name: "Настройки" });
  await screen.findByRole("link", { name: "Продукты" });
  await waitFor(() => expect(saved).toEqual({ locale: "ru" }));
  expect(screen.getByLabelText<HTMLInputElement>("Default amount for purchase").value).toBe("2");
  expect(document.documentElement.lang).toBe("ru");
});

test("Hebrew labels retain user names, custom captions, and saved unit forms", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({ LOCALE: "he_IL" });

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "he_IL",
          direction: "rtl",
          languages: ["en", "he_IL"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: {
              "": {
                Settings: ["הגדרות"],
                Units: ["יחידות"],
                Name: ["שם"],
                Edit: ["עריכה"],
                "Plural forms": ["צורות רבים"],
              },
            },
          },
        });

      if (path === "/api/objects/quantity_units")
        return Response.json([
          {
            id: 1,
            name: "Settings",
            name_plural: "Settings plural",
            plural_forms: "штуки\nштук",
            userfields: { caption: "Saved text" },
          },
        ]);

      if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
        return Response.json([
          {
            id: 1,
            entity: "quantity_units",
            name: "caption",
            caption: "Settings",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
          },
        ]);

      return Response.json([]);
    }),
  );

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LocalizationProvider>
        <PageHeader title="Settings" />
        <EntityManager entity="quantity_units" />
      </LocalizationProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "יחידות" });
  expect(document.documentElement.lang).toBe("he-IL");
  expect(document.documentElement.dir).toBe("rtl");
  expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^עריכה/ }));
  expect(screen.getByLabelText<HTMLInputElement>("שם").value).toBe("Settings");
  expect(screen.getByLabelText<HTMLInputElement>("Settings").value).toBe("Saved text");
  expect(screen.getByLabelText<HTMLTextAreaElement>("צורות רבים").value).toBe("штуки\nштук");
});
