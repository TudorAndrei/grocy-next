import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { UserSettings } from "@/lib/types";
import { queryKeys } from "@/lib/api";

const calendar = "Show a month-view calendar";
const rounding = "Round up quantity amounts to the nearest whole number";

const automatic =
  "Automatically add products that are below their defined min. stock amount to the shopping list";

const booking =
  'Automatically do the booking using the last price and the amount of the shopping list item, if the product has "Default due days" set';

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function mountSettings(
  path: string,
  options: {
    values?: UserSettings;
    holdFirst?: boolean;
    failWrites?: boolean;
    failRead?: boolean;
    failLocale?: boolean;
    holdRead?: boolean;
    basepath?: string;
  } = {},
) {
  const settings: UserSettings = {
    locale: "",
    shopping_list_show_calendar: false,
    shopping_list_round_up: false,
    shopping_list_auto_add_below_min_stock_amount: false,
    shopping_list_auto_add_below_min_stock_amount_list_id: 1,
    shopping_list_to_stock_workflow_auto_submit_when_prefilled: false,
    ...options.values,
  };

  const writes: Array<{ key: string; value: UserSettings[string] }> = [];
  const first = deferred();
  const read = deferred();
  let failingRead = options.failRead;
  let failingLocale = options.failLocale;
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "2026-11-01" },
          php_version: "Python",
          sqlite_version: "3",
        });

      if (url === "/api/v2/user/permissions") return Response.json({});

      if (url === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_STOCK: false,
          FEATURE_FLAG_SHOPPINGLIST: true,
          FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: false,
          LOCALE: settings.locale || "en",
          ENTRY_PAGE: "equipment",
          FEATURE_FLAG_EQUIPMENT: true,
        });

      if (url === "/api/user/settings") {
        if (options.holdRead) await read.promise;

        if (failingRead) {
          failingRead = false;

          return Response.json({ error_message: "Settings unavailable" }, { status: 503 });
        }

        return Response.json(settings);
      }

      if (url.startsWith("/api/user/settings/") && init?.method === "PUT") {
        const key = decodeURIComponent(url.slice("/api/user/settings/".length));
        const value = JSON.parse(String(init.body)).value;
        writes.push({ key, value });

        if (options.holdFirst && writes.length === 1) await first.promise;

        if (options.failWrites)
          return Response.json({ error_message: "Preference rejected" }, { status: 503 });
        settings[key] = value;

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/settings/shopping-context")
        return Response.json({
          shopping_lists: [
            { id: 3, name: "Camping" },
            { id: 1, name: "Groceries" },
            { id: 2, name: "Office" },
          ],
        });

      if (url.startsWith("/api/v2/localization")) {
        const locale = new URL(url, "http://grocy.test").searchParams.get("locale") || "en";

        if (failingLocale && url.includes("locale=en")) {
          failingLocale = false;

          return Response.json({ error_message: "Translations unavailable" }, { status: 503 });
        }

        return Response.json({
          locale,
          direction: "ltr",
          languages: ["en", "de", "fr"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: {
              "": locale === "de" ? { Language: ["Sprache"], Settings: ["Einstellungen"] } : {},
            },
          },
        });
      }

      if (url === "/api/v2/shopping-lists/1")
        return Response.json({ id: 1, name: "Groceries", items: [] });

      if (url === "/api/v2/content/equipment") return Response.json([]);

      if (url === "/api/objects/equipment") return Response.json([]);

      return undefined;
    },
    {},
    { basepath: options.basepath },
  );

  return { ...app, settings, writes, first, read, logger };
}

test("language has Default, persists raw choice and freezes the page language until navigation", async () => {
  const app = mountSettings("/usersettings?returnto=%2Fsettings%3Ftab%3Dconnection");
  const select = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Language" });
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Default", "en", "de", "fr"]);
  expect(screen.getByRole("heading", { name: "User settings" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Save|Reset/ })).toBeNull();
  const user = userEvent.setup();
  await user.selectOptions(select, "de");
  await waitFor(() => expect(app.writes).toEqual([{ key: "locale", value: "de" }]));
  expect(screen.getByRole("combobox", { name: "Language" }).getAttribute("disabled")).toBeNull();
  await act(() => app.client.refetchQueries({ queryKey: queryKeys.systemConfig }));
  await user.click(select);
  expect(screen.getByRole("combobox", { name: "Language" })).toBe(select);
  expect(document.documentElement.lang).toBe("en");
  await user.click(screen.getByRole("link", { name: "OK" }));
  await screen.findByRole("heading", { name: "Einstellungen" });
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(document.documentElement.lang).toBe("de");
});

test.each([
  [
    "?returnto=%2Fsettings%3Ftab%3Dappearance%23theme&returnto=%2Fusers",
    "/pantry/settings?tab=appearance#theme",
  ],
  ["?returnto=%2Fusers%3Fsearch%3DA%20B", "/pantry/users?search=A%20B"],
  ["?returnto[]=%2Fusers", "/pantry/"],
  ["?returnto&returnto=%2Fusers", "/pantry/"],
  ["?returnto=", "/pantry/"],
  ["?returnto=https%3A%2F%2Fevil.test%2F", "/pantry/"],
  ["?returnto=%2F%2Fevil.test", "/pantry/"],
  ["?returnto=%2F..%2Foutside", "/pantry/"],
])(
  "user settings native return link uses first raw parameter and configured path for %s",
  async (query, href) => {
    mountSettings(`/pantry/usersettings${query}`, { basepath: "/pantry" });
    await screen.findByRole("combobox", { name: "Language" });
    expect(screen.getByRole("link", { name: "OK" }).getAttribute("href")).toBe(href);
  },
);

test("shopping controls keep PHP initial selector truthiness, JS checkbox flags and raw target identity", async () => {
  const app = mountSettings("/shoppinglistsettings?returnto=%2Fusers", {
    values: {
      shopping_list_auto_add_below_min_stock_amount: "false",
      shopping_list_auto_add_below_min_stock_amount_list_id: "03",
      shopping_list_round_up: "on",
    },
  });

  const select = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Shopping list" });
  expect(screen.getByRole("heading", { name: "Shopping list settings" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Save|Reset/ })).toBeNull();
  expect(select.disabled).toBe(false);
  expect(select.selectedIndex).toBe(-1);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: automatic }).checked).toBe(false);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: rounding }).checked).toBe(true);
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Camping", "Groceries", "Office"]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: automatic }));
  expect(select.selectedIndex).toBe(-1);
  await user.selectOptions(select, "2");
  await user.click(screen.getByRole("checkbox", { name: automatic }));
  expect(select.disabled).toBe(true);
  expect(select.value).toBe("2");
  expect(app.writes).toContainEqual({
    key: "shopping_list_auto_add_below_min_stock_amount_list_id",
    value: "2",
  });
  expect(screen.getByRole("link", { name: "OK" }).getAttribute("href")).toBe("/shoppinglist");
  expect(screen.getByRole("checkbox", { name: booking })).toBeTruthy();
});

test("shopping changes overlap, do not lock or roll back, and preserve server arrival order on reopening", async () => {
  const app = mountSettings("/shoppinglistsettings", { holdFirst: true });
  const input = await screen.findByRole<HTMLInputElement>("checkbox", { name: calendar });
  const user = userEvent.setup();
  await user.click(input);
  await user.click(input);
  await waitFor(() =>
    expect(app.writes).toEqual([
      { key: "shopping_list_show_calendar", value: true },
      { key: "shopping_list_show_calendar", value: false },
    ]),
  );
  expect(input.disabled).toBe(false);
  expect(input.checked).toBe(false);
  await act(async () => app.first.release());
  await waitFor(() => expect(app.settings.shopping_list_show_calendar).toBe(true));
  expect(input.checked).toBe(false);
  await act(() => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings" });
  await act(() => app.router.navigate({ to: "/shoppinglistsettings" }));
  expect((await screen.findByRole<HTMLInputElement>("checkbox", { name: calendar })).checked).toBe(
    true,
  );
});

test("failed autosave keeps the checkbox draft without alert or automatic retry", async () => {
  const app = mountSettings("/shoppinglistsettings", { failWrites: true });
  const input = await screen.findByRole<HTMLInputElement>("checkbox", { name: calendar });
  await userEvent.setup().click(input);
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(input.checked).toBe(true);
  expect(input.disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.writes).toHaveLength(1);
});

test("fresh settings replace warm cache only before initial controls; background refetch preserves the current draft", async () => {
  const app = mountSettings("/shoppinglistsettings", {
    holdRead: true,
    values: { shopping_list_round_up: true },
  });

  app.client.setQueryData(["user", "settings"], { shopping_list_round_up: false });
  expect(screen.queryByRole("checkbox", { name: rounding })).toBeNull();
  await act(async () => app.read.release());
  const input = await screen.findByRole<HTMLInputElement>("checkbox", { name: rounding });
  expect(input.checked).toBe(true);
  app.settings.shopping_list_round_up = false;
  await act(() => app.client.refetchQueries({ queryKey: ["user", "settings"] }));
  expect(input.checked).toBe(true);
});

test("settings read failure is recoverable before controls become editable", async () => {
  mountSettings("/shoppinglistsettings", { failRead: true });
  await screen.findByRole("alert");
  expect(screen.queryByRole("checkbox", { name: calendar })).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("checkbox", { name: calendar })).toBeTruthy();
});

test("a settled save after leaving invalidates cached preferences without replacing the new page or emitting errors", async () => {
  const app = mountSettings("/shoppinglistsettings", { holdFirst: true });
  await userEvent.setup().click(await screen.findByRole("checkbox", { name: calendar }));
  await act(() => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings" });
  await act(async () => app.first.release());
  expect(app.settings.shopping_list_show_calendar).toBe(true);
  await waitFor(() =>
    expect(app.client.getQueryState(["user", "settings"])?.isInvalidated).toBe(true),
  );
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(screen.queryByRole("checkbox", { name: calendar })).toBeNull();
  expect(app.logger).not.toHaveBeenCalled();
});

test("initial localization failure exposes Retry and recovers real language choices", async () => {
  const app = mountSettings("/usersettings", { failLocale: true });
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Translations unavailable",
  );
  expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  const select = await screen.findByRole("combobox", { name: "Language" });
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Default", "en", "de", "fr"]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.writes).toEqual([]);
});
