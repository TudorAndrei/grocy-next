import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type { UserSettings, ShoppingListItem } from "@/lib/types";
import type { JsonValue } from "@/lib/json";
import { queryKeys } from "@/lib/api";
import type { QueryClient } from "@tanstack/react-query";
import { mountNativeEditor } from "./fixtures/native-editor";

function mountPreferences(
  settings: UserSettings,
  {
    locale = "en",
    firstDay = "",
    hold = false,
    holdDelete = false,
    denyDelete = false,
    basepath = "",
    path = "/shopping",
    holdLocale = false,
    multipleLists = false,
  } = {},
) {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  let saved = settings;
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let releaseLocale = () => {};

  const language = new Promise<void>((resolve) => {
    releaseLocale = resolve;
  });

  let settingsReads = 0;
  let calendarFirstDay = firstDay;
  let configurationReads = 0;

  let releaseDelete = () => {};

  const deletion = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });

  let denied = denyDelete;
  let reads = 0;
  const deletes: number[] = [];

  let rows: ShoppingListItem[] = [
    {
      id: 11,
      product_id: 1,
      amount: 0.2,
      stock_amount: 0.2,
      display_factor: 1,
      qu_id: 1,
      done: false,
    },
    {
      id: 12,
      product_id: 2,
      amount: 0.3,
      stock_amount: 1.2,
      display_factor: 0.25,
      qu_id: 2,
      done: false,
    },
    {
      id: 13,
      product_id: null,
      note: "Bags",
      amount: 1234.25,
      stock_amount: 1234.25,
      display_factor: 1,
      qu_id: null,
      done: false,
    },
  ];

  const writes: { url: string; body: unknown }[] = [];

  const app = mountNativeEditor(
    `${basepath}${path}`,
    async (url, options) => {
      if (url === "/api/system/config") {
        configurationReads++;

        return Response.json({
          FEATURE_FLAG_SHOPPINGLIST: true,
          FEATURE_FLAG_STOCK: true,
          FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: multipleLists,
          CALENDAR_FIRST_DAY_OF_WEEK: calendarFirstDay,
        });
      }

      if (url === "/api/user/settings") {
        settingsReads++;

        if (hold) await gate;

        return Response.json(saved);
      }

      if (url.startsWith("/api/user/settings/") && options?.method === "PUT") {
        const body = JSON.parse(String(options.body));
        saved = { ...saved, [decodeURIComponent(url.split("/").at(-1)!)]: body.value };
        writes.push({ url, body });

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/settings/shopping-context")
        return Response.json({ shopping_lists: [{ id: 1, name: "Groceries" }] });

      if (url === "/api/v2/shopping-lists")
        return Response.json([
          { id: 1, name: "Groceries", description: null, item_count: rows.length },
          { id: 2, name: "Other list", description: null, item_count: 1 },
        ]);

      if (url === "/api/objects/products")
        return Response.json([
          { id: 1, name: "Apples", location_id: 1, qu_id_stock: 1, qu_id_purchase: 1 },
          { id: 2, name: "Coffee", location_id: 1, qu_id_stock: 1, qu_id_purchase: 2 },
        ]);

      if (url === "/api/objects/locations") return Response.json([{ id: 1, name: "Pantry" }]);

      if (url === "/api/objects/quantity_units")
        return Response.json([
          { id: 1, name: "Piece", name_plural: "Pieces" },
          { id: 2, name: "Case", name_plural: "Cases" },
        ]);

      if (url.startsWith("/api/v2/shopping-lists/native-context")) {
        reads++;

        const lists = [
          { id: 1, name: "Groceries", description: null, item_count: rows.length },
          { id: 2, name: "Other list", description: null, item_count: 1 },
        ];

        return Response.json({
          list_id: 1,
          list: lists[0],
          lists,
          items: rows,
          products: [],
          units: [],
          notes_document: "<html><body></body></html>",
        });
      }

      if (url === "/api/v2/shopping-lists/1") {
        reads++;

        return Response.json({ id: 1, name: "Groceries", description: null, items: rows });
      }

      if (url === "/api/v2/shopping-lists/2")
        return Response.json({
          id: 2,
          name: "Other list",
          description: null,
          items: [
            {
              id: 22,
              product_id: 2,
              amount: 0.3,
              stock_amount: 1.2,
              display_factor: 0.25,
              qu_id: 2,
              done: false,
            },
          ],
        });

      if (/^\/api\/v2\/shopping-lists\/[12]\/notes\/editor$/.test(url))
        return new Response("<html></html>");
      const item = /^\/api\/objects\/shopping_list\/(11|12)$/.exec(url);

      if (item && options?.method === "DELETE") {
        const id = Number(item[1]);
        deletes.push(id);

        if (holdDelete) await deletion;

        if (denied) return Response.json({ error_message: "Delete denied" }, { status: 403 });
        rows = rows.filter((row) => row.id !== id);

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/shopping-lists/items" && options?.method === "POST") {
        writes.push({ url, body: JSON.parse(String(options.body)) });

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/v2/localization")) {
        if (holdLocale) await language;

        return Response.json({
          locale,
          direction: "ltr",
          languages: ["en", "de"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: { "": { moment_locale: [locale] } },
          },
        });
      }

      return undefined;
    },
    {
      FEATURE_FLAG_SHOPPINGLIST: true,
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: multipleLists,
      CALENDAR_FIRST_DAY_OF_WEEK: firstDay,
    },
    { basepath },
  );

  return {
    ...app,
    writes,
    release,
    releaseLocale,
    settingsReads: () => settingsReads,
    configurationReads: () => configurationReads,
    changeFirstDay: (value: string) => {
      calendarFirstDay = value;
    },
    deletes,
    releaseDelete,
    reads: () => reads,
    allowDelete: () => {
      denied = false;
    },
    replaceSettings: (value: UserSettings) => {
      saved = value;
    },
  };
}

test("round-up uses stock quantity before conversion and leaves the raw item amount for undo", async () => {
  const app = mountPreferences({ shopping_list_round_up: "off" });
  await screen.findByText("1 Piece");
  expect(screen.getByText("0.5 Cases")).toBeTruthy();
  expect(screen.getByText("1,235")).toBeTruthy();
  const row = screen.getByRole("checkbox", { name: "Apples in the basket" }).closest("li")!;
  await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
  await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(app.writes).toEqual([
      {
        url: "/api/v2/shopping-lists/items",
        body: { product_id: 1, amount: 0.2, shopping_list_id: 1, qu_id: 1, note: null },
      },
    ]),
  );
});

test("shopping preference calendar is an inline month with week numbers, navigation and Today", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 7, 12));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  mountPreferences({ shopping_list_show_calendar: "false" }, { locale: "de", firstDay: "1" });
  const calendar = await screen.findByRole("region", { name: "Calendar" });
  const month = within(calendar).getByRole("table", { name: "November 2026" });
  expect(
    within(month)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual(["#", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
  expect(
    within(month)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent),
  ).toEqual(["44", "45", "46", "47", "48", "49"]);
  expect(within(calendar).queryByRole("dialog")).toBeNull();
  expect(within(calendar).queryByRole("button", { name: "Close the picker" })).toBeNull();
  await userEvent.click(within(calendar).getByRole("button", { name: "Next Month" }));
  expect(within(calendar).getByRole("table", { name: "Dezember 2026" })).toBeTruthy();
  fireEvent.keyDown(calendar, { key: "PageDown" });
  fireEvent.keyDown(calendar, { key: "t" });
  expect(within(calendar).getByRole("table", { name: "Dezember 2026" })).toBeTruthy();
  await userEvent.click(within(calendar).getByRole("button", { name: "Go to today" }));
  await userEvent.click(within(calendar).getByRole("button", { name: "8. November 2026" }));
  expect(
    within(calendar).getByRole("button", { name: "8. November 2026" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(within(calendar).getByRole("table", { name: "November 2026" })).toBeTruthy();
});

test("a shopping page waits for preferences then retains its initial display flags through background reads", async () => {
  const app = mountPreferences(
    { shopping_list_round_up: true, shopping_list_show_calendar: true },
    { hold: true },
  );

  await screen.findByText("Loading preferences…");
  expect(screen.queryByRole("checkbox", { name: "Apples in the basket" })).toBeNull();
  await act(async () => app.release());
  await screen.findByText("1 Piece");
  expect(screen.getByRole("region", { name: "Calendar" })).toBeTruthy();
  app.replaceSettings({ shopping_list_round_up: "0", shopping_list_show_calendar: "0" });
  await act(async () => app.client.invalidateQueries({ queryKey: ["user", "settings"] }));
  expect(screen.getByText("1 Piece")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Calendar" })).toBeTruthy();
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await act(async () => app.router.navigate({ href: "/shopping" }));
  await screen.findByText("0.2 Pieces");
  expect(screen.queryByRole("region", { name: "Calendar" })).toBeNull();
});

test("saved native shopping preferences take effect after OK returns to the shopping page", async () => {
  const app = mountPreferences(
    { shopping_list_round_up: false, shopping_list_show_calendar: false },
    { path: "/shoppinglistsettings" },
  );

  await userEvent.click(
    await screen.findByRole("checkbox", { name: "Show a month-view calendar" }),
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Round up quantity amounts to the nearest whole number" }),
  );
  await waitFor(() => expect(app.writes).toHaveLength(2));
  await userEvent.click(screen.getByRole("link", { name: "OK" }));
  await screen.findByText("1 Piece");
  expect(screen.getByText("0.5 Cases")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Calendar" })).toBeTruthy();
  expect(app.router.history.location.pathname).toBe("/shoppinglist");
});

test("a held localization response supplies the calendar's first ready language", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 7, 12));
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const app = mountPreferences(
    { shopping_list_show_calendar: true },
    { locale: "de", holdLocale: true },
  );

  await screen.findByText("0.2 Pieces");
  await act(async () => app.releaseLocale());
  const calendar = await screen.findByRole("region", { name: "Calendar" });
  await within(calendar).findByRole("table", { name: "März 2026" });
});

test("a same-list change message starts a fresh settings session and retires the open purchase dialog", async () => {
  const app = mountPreferences({ shopping_list_show_calendar: true, shopping_list_round_up: true });
  await screen.findByText("1 Piece");
  const row = screen.getByRole("checkbox", { name: "Apples in the basket" }).closest("li")!;
  await userEvent.click(within(row).getByRole("link", { name: "Add this item to stock" }));
  await screen.findByRole("dialog", { name: "Purchase" });
  const before = app.settingsReads();
  app.replaceSettings({ shopping_list_show_calendar: false, shopping_list_round_up: false });
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { Message: "ShoppingListChanged", Payload: 1 },
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull());
  await screen.findByText("0.2 Pieces");
  expect(document.querySelector('iframe[title="Purchase"]')).toBeNull();
  expect(screen.queryByRole("region", { name: "Calendar" })).toBeNull();
  expect(app.settingsReads()).toBeGreaterThan(before);
});

test("selected-list navigation rereads settings and resets the inline calendar", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 7, 12));
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const app = mountPreferences(
    { shopping_list_show_calendar: true, shopping_list_round_up: false },
    { multipleLists: true },
  );

  await screen.findByText("0.3 Cases");
  const calendar = screen.getByRole("region", { name: "Calendar" });
  await userEvent.click(within(calendar).getByRole("button", { name: "Next Month" }));
  expect(within(calendar).getByRole("table", { name: "December 2026" })).toBeTruthy();
  const before = app.settingsReads();
  const previousConfiguration = app.configurationReads();
  app.changeFirstDay("1");
  app.replaceSettings({ shopping_list_show_calendar: true, shopping_list_round_up: true });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Shopping list" }), "2");
  await screen.findByText("0.5 Cases");
  expect(
    within(screen.getByRole("region", { name: "Calendar" })).getByRole("table", {
      name: "November 2026",
    }),
  ).toBeTruthy();
  expect(app.settingsReads()).toBeGreaterThan(before);
  expect(app.configurationReads()).toBeGreaterThan(previousConfiguration);
  expect(
    within(screen.getByRole("region", { name: "Calendar" })).getAllByRole("columnheader")[1]
      ?.textContent,
  ).toBe("Mo");
});

function frameMessage(
  frame: HTMLIFrameElement,
  Message: string,
  Payload: JsonValue,
  origin = window.location.origin,
  source = frame.contentWindow,
) {
  window.dispatchEvent(new MessageEvent("message", { origin, source, data: { Message, Payload } }));
}

function warmPurchaseCaches(client: QueryClient) {
  const keys = [queryKeys.stockOverview, queryKeys.recipes, queryKeys.recipesFulfillment];

  for (const key of keys) client.setQueryData(key, []);
  // Products are already warm from the live shopping catalog query.
  client.setQueryData(queryKeys.products, client.getQueryData(queryKeys.products));

  return [...keys, queryKeys.products];
}

test("rounded stock quantity reaches the native purchase iframe and only its matching item completion removes the row", async () => {
  const app = mountPreferences(
    { shopping_list_round_up: true },
    { basepath: "/house", holdDelete: true },
  );

  await screen.findByText("0.5 Cases");
  const row = screen.getByRole("checkbox", { name: "Coffee in the basket" }).closest("li")!;
  const trigger = within(row).getByRole("link", { name: "Add this item to stock" });
  const link = new URL(trigger.getAttribute("href")!, window.location.href);
  expect(link.pathname).toBe("/house/purchase");
  expect(Object.fromEntries(link.searchParams)).toEqual({
    embedded: "",
    flow: "shoppinglistitemtostock",
    product: "2",
    amount: "2",
    listitemid: "12",
    quId: "2",
  });
  await userEvent.click(trigger);
  await screen.findByRole("dialog", { name: "Purchase" });
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Purchase"]')!;
  expect(frame.src).toBe(link.href);
  await act(async () => {
    frameMessage(frame, "AfterItemAdded", "12", "https://foreign.invalid");
    frameMessage(frame, "AfterItemAdded", "12", window.location.origin, window);
    frameMessage(frame, "AfterItemAdded", "11");
  });
  expect(app.deletes).toEqual([]);
  await act(async () => frameMessage(frame, "AfterItemAdded", "12"));
  await waitFor(() => expect(app.deletes).toEqual([12]));
  await act(async () => {
    frameMessage(frame, "ShowSuccessMessage", "Purchased Coffee");
    frameMessage(frame, "Ready", null);
  });
  expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull();
  expect(document.querySelector<HTMLIFrameElement>('iframe[title="Purchase"]')!).toBe(frame);
  expect(screen.getByText("Purchased Coffee")).toBeTruthy();
  const apples = screen.getByRole("checkbox", { name: "Apples in the basket" }).closest("li")!;
  await userEvent.click(within(apples).getByRole("link", { name: "Add this item to stock" }));
  const nextFrame = document.querySelector<HTMLIFrameElement>('iframe[title="Purchase"]')!;
  await act(async () => frameMessage(nextFrame, "AfterItemAdded", 11));
  await waitFor(() => expect(app.deletes).toEqual([12, 11]));
  await act(async () => app.releaseDelete());
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Coffee in the basket" })).toBeNull(),
  );
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Apples in the basket" })).toBeNull(),
  );
});

test("closing the native purchase iframe keeps confirmed page-owned completion alive", async () => {
  const app = mountPreferences({ shopping_list_round_up: false });
  await screen.findByText("0.2 Pieces");
  const row = screen.getByRole("checkbox", { name: "Apples in the basket" }).closest("li")!;
  await userEvent.click(within(row).getByRole("link", { name: "Add this item to stock" }));
  const dialog = await screen.findByRole("dialog", { name: "Purchase" });
  const frame = within(dialog).getByTitle<HTMLIFrameElement>("Purchase");
  expect(new URL(frame.src).searchParams.get("amount")).toBe("0.2");
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull();
  await act(async () => frameMessage(frame, "AfterItemAdded", 11));
  await waitFor(() => expect(app.deletes).toEqual([11]));
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Apples in the basket" })).toBeNull(),
  );
});

test("failed native purchase completion logs and permits retry without an extra removal receipt", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mountPreferences({}, { denyDelete: true });
  await screen.findByText("0.2 Pieces");
  const row = screen.getByRole("checkbox", { name: "Apples in the basket" }).closest("li")!;
  await userEvent.click(within(row).getByRole("link", { name: "Add this item to stock" }));
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Purchase"]')!;
  const caches = warmPurchaseCaches(app.client);
  await act(async () => frameMessage(frame, "AfterItemAdded", 11));
  await waitFor(() => expect(error).toHaveBeenCalled());

  for (const key of caches) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(screen.getByRole("checkbox", { name: "Apples in the basket" })).toBeTruthy();
  app.allowDelete();
  await act(async () => frameMessage(frame, "AfterItemAdded", 11));
  await waitFor(() => expect(app.deletes).toEqual([11, 11]));
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Apples in the basket" })).toBeNull(),
  );
  expect(screen.queryByText("Removed Apples")).toBeNull();
});

test("departure retires a held native row removal but leaves committed shopping caches stale", async () => {
  const app = mountPreferences({}, { holdDelete: true });
  await screen.findByText("0.2 Pieces");
  const row = screen.getByRole("checkbox", { name: "Apples in the basket" }).closest("li")!;
  await userEvent.click(within(row).getByRole("link", { name: "Add this item to stock" }));
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Purchase"]')!;
  const caches = warmPurchaseCaches(app.client);
  await act(async () => frameMessage(frame, "AfterItemAdded", 11));
  await waitFor(() => expect(app.deletes).toEqual([11]));

  for (const key of caches) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  warmPurchaseCaches(app.client);
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));

  for (const key of caches) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  const readsAtDeparture = app.reads();
  await act(async () => app.releaseDelete());
  await waitFor(() => expect(app.client.getQueryState(["shopping", 1])?.isInvalidated).toBe(true));
  expect(app.reads()).toBe(readsAtDeparture);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(app.router.history.location.pathname).toBe("/settings");
});
