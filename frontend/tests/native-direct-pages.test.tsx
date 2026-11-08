import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { z } from "zod";
import type { JsonObject, JsonValue } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import { mealPlanCalendarFixture } from "./fixtures/mealplan-calendar";
import { overviewFixture } from "./fixtures/stock-overview";

function mountDirectPage(
  path: string,
  {
    holdMealPlan = false,
    multipleLists = false,
    nativeListId,
    unknownList = false,
    holdItemSave = false,
  }: {
    holdMealPlan?: boolean;
    multipleLists?: boolean;
    nativeListId?: JsonValue;
    unknownList?: boolean;
    holdItemSave?: boolean;
  } = {},
) {
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const data = mealPlanCalendarFixture();
  const reads: { url: string; signal?: AbortSignal | null }[] = [];
  const writes: { url: string; body: JsonObject }[] = [];

  const lists = [
    { id: 1, name: "Groceries", description: "<p>Groceries notes</p>", item_count: 0 },
    { id: 7, name: "Weekend", description: "<p>Weekend notes</p>", item_count: 1 },
  ];

  const items = [
    { id: 70, product_id: null, amount: 1, qu_id: null, note: "Read-only list note", done: false },
  ];

  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const app = mountNativeEditor(
    path,
    async (url, options) => {
      if (["POST", "PUT"].includes(options?.method ?? "")) {
        const body: JsonObject = JSON.parse(String(options?.body ?? "{}"));
        writes.push({ url, body });

        if (url === "/api/objects/shopping_list" && holdItemSave) await gate;

        if (url === "/api/objects/shopping_list") return Response.json({ created_object_id: "80" });

        if (url === "/api/stock/shoppinglist/clear") return new Response(null, { status: 204 });

        if (url === "/api/objects/shopping_lists/1") return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/v2/shopping-lists/native-print")) {
        reads.push({ url, signal: options?.signal });

        return new Response(
          "<html><body><h1>Shopping list</h1><p>Unknown selection has no items</p></body></html>",
          { headers: { "Content-Type": "text/html" } },
        );
      }

      if (url === "/api/v2/user/permissions") return Response.json({});

      if (url.startsWith("/api/v2/meal-plan/calendar")) {
        reads.push({ url, signal: options?.signal });

        if (holdMealPlan) await gate;

        return Response.json(data);
      }

      if (url === "/api/user/settings")
        return Response.json({ night_mode: "off", stock_decimal_places_amounts: 2 });

      if (url.startsWith("/api/v2/recipes/ingredient-editor?")) {
        reads.push({ url, signal: options?.signal });

        return Response.json({
          recipe: data.recipes.find((recipe) => recipe.id === 7),
          position: null,
          products: data.products,
          units: data.units,
          conversions: data.conversions,
          barcodes: [],
          barcode_lookup_plugin_name: "",
        });
      }

      if (url.startsWith("/api/v2/shopping-lists/native-context")) {
        reads.push({ url, signal: options?.signal });
        const raw = nativeListId ?? new URL(url, "http://grocy.test").searchParams.get("list") ?? 1;

        const selected = unknownList
          ? null
          : (lists.find((list) => list.id === Number(raw)) ?? null);

        return Response.json({
          list_id: raw,
          list: selected,
          lists,
          items:
            selected?.id === 7 ||
            (unknownList && z.record(z.string(), z.json()).safeParse(raw).success)
              ? items
              : [],
          products: [],
          units: [],
          notes_document: `<html><body>${selected?.description ?? ""}</body></html>`,
        });
      }

      if (url === "/api/v2/shopping-lists") return Response.json(lists);

      if (url.startsWith("/api/v2/shopping-lists/items/editor"))
        return Response.json({
          item: null,
          lists: lists.map(({ id, name }) => ({ id, name })),
          products: [],
          units: [],
          conversions: [],
          fields: [],
          values: {},
          barcodes: [],
        });

      if (url.startsWith("/api/v2/shopping-lists/editor"))
        return Response.json({ list: { id: 7, name: "Weekend" }, fields: [], values: {} });

      if (/^\/api\/v2\/shopping-lists\/\d+$/.test(url)) {
        reads.push({ url, signal: options?.signal });
        const id = Number(url.split("/").at(-1));

        return Response.json({
          id,
          name: id === 7 ? "Weekend" : "Groceries",
          description: "",
          items: id === 7 ? items : [],
        });
      }

      if (url === "/api/v2/stock/overview") {
        reads.push({ url, signal: options?.signal });

        return Response.json(
          overviewFixture([{ product_id: 1, product: { id: 1, name: "Coffee" }, amount: 2 }]),
        );
      }

      if (url === "/api/stock") return Response.json([]);

      if (url.startsWith("/api/stock/volatile"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      if (
        url === "/api/v2/custom-data/fields" ||
        url === "/api/objects/products" ||
        url === "/api/objects/locations" ||
        url === "/api/objects/quantity_units"
      )
        return Response.json([]);

      if (url === "/api/v2/chores/overview") {
        reads.push({ url, signal: options?.signal });

        return Response.json({
          rows: [
            {
              chore_id: 1,
              name: "Water plants",
              period_type: "manually",
              track_date_only: 1,
              last_tracked_time: null,
              next_estimated_execution_time: null,
              next_execution_assigned_to_user_id: null,
              is_rescheduled: 0,
              is_reassigned: 0,
              due_type: "",
              custom_values: {},
            },
          ],
          users: [],
          current_user_id: 1,
          next_x_days: 5,
        });
      }

      if (url === "/api/chores") return Response.json([]);

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: false,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: false,
      FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: false,
      FEATURE_FLAG_RECIPES: false,
      FEATURE_FLAG_RECIPES_MEALPLAN: false,
      FEATURE_FLAG_SHOPPINGLIST: false,
      FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: multipleLists,
      FEATURE_FLAG_CHORES: false,
      FEATURE_FLAG_CHORES_ASSIGNMENTS: false,
      FEATURE_FLAG_TASKS: false,
      FEATURE_FLAG_BATTERIES: false,
      FEATURE_FLAG_EQUIPMENT: false,
      MEAL_PLAN_FIRST_DAY_OF_WEEK: "1",
    },
  );

  return { ...app, reads, writes, data, release };
}

test("native mealplan reads and renders without recipe feature flags or module grants", async () => {
  const app = mountDirectPage("/mealplan?start=2026-11-02");
  const calendar = await screen.findByRole("table", { name: "Breakfast" });
  expect(
    within(calendar).getByRole("columnheader", { name: "Monday, November 2, 2026" }),
  ).toBeTruthy();
  expect(app.reads.some((row) => row.url.startsWith("/api/v2/meal-plan/calendar"))).toBe(true);
  expect(screen.queryByText("Loading meal plan…")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Consume all ingredients needed by this recipe" }),
  ).toBeNull();
});

test("native shoppinglist retains its own path and selected list even while the multiple-list selector is disabled", async () => {
  const app = mountDirectPage("/shoppinglist?list=7");
  await screen.findByRole("heading", { name: "Weekend" });
  await screen.findByText("Read-only list note");
  expect(app.router.state.location.pathname).toBe("/shoppinglist");
  expect(app.reads.some((row) => row.url === "/api/v2/shopping-lists/native-context?list=7")).toBe(
    true,
  );
  expect(screen.queryByRole("combobox", { name: "Shopping list" })).toBeNull();
  expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add all list items to stock" })).toBeNull();
});

test("the separate modern shopping route retains its feature denial", async () => {
  const app = mountDirectPage("/shopping?list=7");
  await screen.findByRole("heading", { name: "Feature disabled" });
  expect(app.reads.filter((row) => row.url.includes("shopping-lists"))).toHaveLength(0);
});

test("native selected recipe ingredient forms load without recipes and stock, hiding only source stock controls", async () => {
  const app = mountDirectPage("/recipe/7/pos/new");
  await screen.findByRole("heading", { name: "Add recipe ingredient" });
  await screen.findByLabelText("Product");
  expect(screen.getByLabelText("Amount")).toBeTruthy();
  expect(
    screen.queryByRole("checkbox", {
      name: "Disable stock fulfillment checking for this ingredient",
    }),
  ).toBeNull();
  expect(screen.queryByRole("spinbutton", { name: "Price factor" })).toBeNull();
  expect(app.reads.some((row) => row.url.startsWith("/api/v2/recipes/ingredient-editor?"))).toBe(
    true,
  );
});

test.each([
  ["/stockoverview", "Stock overview", "Coffee"],
  ["/choresoverview", "Chores overview", "Water plants"],
])(
  "native %s still reads a table for an actor without its module feature or grant",
  async (path, tableName, item) => {
    mountDirectPage(path);
    const table = await screen.findByRole("table", { name: tableName });
    expect(within(table).getByText(item)).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "Value" })).toBeNull();
  },
);

test("native shopping selected editors stay nested beneath the native parent without redirecting", async () => {
  const app = mountDirectPage("/shoppinglist/7?embedded");
  await screen.findByRole("heading", { name: "Edit shopping list" });
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("Weekend");
  expect(app.router.state.location.pathname).toBe("/shoppinglist/7");
});

test("a held native mealplan read cannot revive its departed owner and a fresh return reads the page again", async () => {
  const app = mountDirectPage("/mealplan?start=2026-11-02", { holdMealPlan: true });
  await waitFor(() =>
    expect(app.reads.filter((row) => row.url.includes("meal-plan/calendar"))).toHaveLength(1),
  );
  await act(async () => {
    await app.router.navigate({ to: "/about" });
  });
  expect(app.reads[0]?.signal?.aborted).toBe(true);
  const departedReads = app.reads.filter((row) => row.url.includes("meal-plan/calendar")).length;
  await act(async () => app.release());
  expect(screen.queryByRole("table", { name: "Breakfast" })).toBeNull();
  expect(app.reads.filter((row) => row.url.includes("meal-plan/calendar"))).toHaveLength(
    departedReads,
  );
  app.data.events[2]!.entry.note = "Fresh server note";
  app.data.events[2]!.title = "Fresh server note";
  app.data.events[2]!.note_html = "Fresh server note";
  await act(async () => {
    await app.router.navigate({ to: "/mealplan", search: { start: "2026-11-02" } });
  });
  await screen.findByRole("table", { name: "Breakfast" });
  await screen.findByText("Fresh server note");
  expect(app.reads.filter((row) => row.url.includes("meal-plan/calendar")).length).toBeGreaterThan(
    departedReads,
  );
});

test.each([
  ["?list=7e0", "7e0", false, "7e0"],
  ["?list=1&list=7", "7", false, "7"],
  ["?list=missing", "missing", true, "missing"],
  ["?list[]=7", { "0": "7" }, true, "Array"],
])(
  "native shopping forwards raw selection %s and retains the server selector in item links",
  async (search, raw, unknown, linkValue) => {
    const app = mountDirectPage(`/shoppinglist${search}`, {
      nativeListId: raw,
      unknownList: unknown,
    });

    await screen.findByRole("heading", { name: unknown ? "Shopping list" : "Weekend" });
    const add = await screen.findByRole("link", { name: "Add item" });
    expect(add.getAttribute("href")).toBe(`/shoppinglistitem/new?embedded&list=${linkValue}`);
    expect(
      app.reads.some((row) => row.url === `/api/v2/shopping-lists/native-context${search}`),
    ).toBe(true);
    expect(app.router.history.location.search).toBe(search);
    await userEvent.click(add);

    const editor = screen
      .getByRole("dialog", { name: "Shopping list item" })
      .querySelector("iframe")!;

    expect(new URL(editor.src).search).toBe(`?embedded&list=${linkValue}`);
  },
);

test("native hidden-list actions save notes and clear DOM list1 while reading and retaining raw list7", async () => {
  const app = mountDirectPage("/shoppinglist?list=7");
  const notes = await screen.findByTitle<HTMLIFrameElement>("Notes");
  expect(notes.srcdoc).toContain("Weekend notes");

  const send = (kind: "ready" | "change", html: string) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "null",
        source: notes.contentWindow,
        data: {
          channel: "grocy-shopping-notes",
          kind,
          html,
          empty: false,
          height: 390,
          fullscreen: false,
        },
      }),
    );

  send("ready", "<p>Weekend notes</p>");
  send("change", "<p>Changed notes</p>");
  const region = screen.getByRole("region", { name: "Notes" });
  await userEvent.click(within(region).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.writes).toContainEqual({
      url: "/api/objects/shopping_lists/1",
      body: { description: "<p>Changed notes</p>" },
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: "Clear list" }));
  await waitFor(() =>
    expect(
      app.writes.some(
        (row) => row.url === "/api/stock/shoppinglist/clear" && row.body.list_id === 1,
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(app.reads.filter((row) => row.url.includes("native-context"))).toHaveLength(2),
  );
  expect(app.router.history.location.search).toBe("?list=7");
  expect(await screen.findByText("Read-only list note")).toBeTruthy();
});

test.each([false, true])(
  "native selected shopping-item save uses native return routing and embedded=%s messages",
  async (embedded) => {
    const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    onTestFinished(() => messages.mockRestore());
    const app = mountDirectPage(`/shoppinglistitem/new?list=7${embedded ? "&embedded" : ""}`);
    const note = await screen.findByLabelText("Note");
    await userEvent.type(note, "Trip note");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        app.writes.find((row) => row.url === "/api/objects/shopping_list")?.body.shopping_list_id,
      ).toBe("7"),
    );

    if (embedded) {
      await waitFor(() =>
        expect(
          messages.mock.calls
            .filter(([bag]) => bag.Message !== "ResizeResponsiveEmbeds")
            .map(([bag]) => bag),
        ).toEqual([
          { Message: "ShoppingListChanged", Payload: "7" },
          { Message: "CloseLastModal", Payload: null },
        ]),
      );
      expect(app.router.state.location.pathname).toBe("/shoppinglistitem/new");
    } else {
      await screen.findByRole("heading", { name: "Weekend" });
      expect(app.router.state.location.pathname).toBe("/shoppinglist");
      expect(app.router.history.location.search).toBe("?list=7");
    }
  },
);

test("a completed shopping-item save after departure cannot post native messages or navigate the new page", async () => {
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => messages.mockRestore());
  const app = mountDirectPage("/shoppinglistitem/new?list=7&embedded", { holdItemSave: true });
  await userEvent.type(await screen.findByLabelText("Note"), "Held note");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.writes.some((row) => row.url === "/api/objects/shopping_list")).toBe(true),
  );
  await act(async () => {
    await app.router.navigate({ to: "/about" });
  });
  await act(async () => app.release());
  expect(app.router.state.location.pathname).toBe("/about");
  expect(
    messages.mock.calls.filter(([bag]) =>
      ["ShoppingListChanged", "CloseLastModal"].includes(bag.Message),
    ),
  ).toHaveLength(0);
});

test("native paper printing uses the raw displayed selection instead of hidden DOM list1", async () => {
  // JSDOM lacks the iframe sandbox token-list API used by the real print transport.
  const sandbox = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "sandbox");
  Object.defineProperty(HTMLIFrameElement.prototype, "sandbox", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return { add: (...tokens: string[]) => this.setAttribute("sandbox", tokens.join(" ")) };
    },
  });
  onTestFinished(() => {
    if (sandbox) Object.defineProperty(HTMLIFrameElement.prototype, "sandbox", sandbox);
    else Reflect.deleteProperty(HTMLIFrameElement.prototype, "sandbox");
  });

  const app = mountDirectPage("/shoppinglist?list=missing", {
    nativeListId: "missing",
    unknownList: true,
  });

  const printed: HTMLIFrameElement[] = [];
  const seen = new WeakSet<HTMLIFrameElement>();

  const observer = new MutationObserver(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      'iframe[title="Shopping list"][aria-hidden="true"]',
    )) {
      if (seen.has(frame)) continue;
      seen.add(frame);
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(frame.srcdoc);
      doc.close();
      Object.defineProperty(doc, "fonts", {
        configurable: true,
        value: { ready: Promise.resolve() },
      });
      frame.contentWindow!.focus = () => {};

      frame.contentWindow!.print = () => {
        printed.push(frame);
      };

      fireEvent.load(frame);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  onTestFinished(() => {
    observer.disconnect();

    for (const frame of printed) frame.contentWindow?.dispatchEvent(new Event("afterprint"));
  });
  await userEvent.click(await screen.findByRole("button", { name: "Print" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Print" })).getByRole("button", { name: "Print" }),
  );
  await waitFor(() => expect(printed).toHaveLength(1));
  expect(printed[0]!.contentDocument?.body.textContent).toContain("Unknown selection has no items");

  const request = app.reads.find((row) =>
    row.url.startsWith("/api/v2/shopping-lists/native-print"),
  )!;

  expect(request.url).toMatch(/^\/api\/v2\/shopping-lists\/native-print\?list=missing&header=/);
  expect(app.reads.some((row) => row.url.includes("/shopping-lists/1/print"))).toBe(false);
});

test.each([0, -1])(
  "native ShoppingListChanged permits imported list%s and still rejects foreign origins",
  async (id) => {
    const app = mountDirectPage("/shoppinglist?list=7");
    await screen.findByText("Read-only list note");
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "https://foreign.example",
        data: { Message: "ShoppingListChanged", Payload: String(id) },
      }),
    );
    expect(app.router.history.location.search).toBe("?list=7");
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { Message: "ShoppingListChanged", Payload: String(id) },
      }),
    );
    await waitFor(() => expect(app.router.history.location.search).toBe(`?list=${id}`));
    await screen.findByRole("heading", { name: "Shopping list" });
    expect(
      app.reads.some((row) => row.url === `/api/v2/shopping-lists/native-context?list=${id}`),
    ).toBe(true);
  },
);
