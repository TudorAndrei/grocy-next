import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mealPlanCalendarFixture } from "./fixtures/mealplan-calendar";
import { mountNativeEditor } from "./fixtures/native-editor";

function gate() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountCalendar({
  holdWrite = false,
  holdRecipe = false,
  holdProduct = false,
  failWrite = false,
  copyEmpty = false,
  failCopyFirst = false,
  holdRetryCopyTail = false,
} = {}) {
  const data = mealPlanCalendarFixture();
  data.recipes.push({ ...data.recipes[0]!, id: 8, name: "Soup", base_servings: 4.125 });
  const rows = data.events.map((event) => ({ ...event.entry }));
  const writes: { path: string; method: string; body: JsonObject }[] = [];
  const write = gate();
  const recipe = gate();
  const product = gate();
  let failing = failWrite;
  let copiedFailure = failCopyFirst;
  let reads = 0;
  let nextId = 200;

  const app = mountNativeEditor(
    "/mealplan?start=2026-11-02",
    (url, init) => {
      if (url === "/api/user/settings") return Response.json({ stock_decimal_places_amounts: 2 });

      if (url === "/api/v2/shopping-lists/1")
        return Response.json({ id: 1, name: "Shopping list", items: [] });

      if (url.startsWith("/api/v2/meal-plan/calendar")) {
        reads++;

        return Response.json({
          ...data,
          events: rows.map((entry) => ({
            id: entry.id,
            start: entry.day,
            type: entry.type,
            title:
              entry.type === "recipe"
                ? (data.recipes.find((recipe) => recipe.id === Number(entry.recipe_id))?.name ?? "")
                : "",
            date_format: "date",
            entry,
            recipe:
              entry.type === "recipe"
                ? (data.recipes.find((recipe) => recipe.id === Number(entry.recipe_id)) ?? null)
                : null,
            product_details:
              entry.type === "product"
                ? data.events.find((event) => event.type === "product")!.product_details
                : null,
            note_html: entry.note ?? "",
          })),
        });
      }

      if (/^\/api\/objects\/recipes\/\d+$/.test(url) && (!init?.method || init.method === "GET")) {
        const response = () =>
          Response.json(data.recipes.find((row) => row.id === Number(url.split("/").at(-1))));

        return holdRecipe ? recipe.promise.then(response) : response();
      }

      if (url.startsWith("/api/stock/products/") && (!init?.method || init.method === "GET")) {
        const response = () =>
          Response.json({
            ...data.events.find((event) => event.type === "product")!.product_details,
            product: data.products.find((row) => row.id === Number(url.split("/").at(-1))),
            quantity_unit_stock: data.units.find(
              (row) =>
                row.id ===
                data.products.find((row) => row.id === Number(url.split("/").at(-1)))?.qu_id_stock,
            ),
          });

        return holdProduct ? product.promise.then(response) : response();
      }

      if (url.startsWith("/api/objects/meal_plan?query[]=day="))
        return Response.json(
          copyEmpty ? [] : rows.filter((row) => row.day === url.split("day=")[1]),
        );

      if (
        (url === "/api/objects/meal_plan" && init?.method === "POST") ||
        (/^\/api\/objects\/meal_plan\/\d+$/.test(url) && init?.method === "PUT")
      ) {
        const body: JsonObject = JSON.parse(String(init.body));
        const call = { path: url, method: init.method!, body };
        writes.push(call);
        const index = writes.length;

        return (async () => {
          if (holdWrite) await write.promise;

          if (holdRetryCopyTail && index > 4) await write.promise;

          if (copiedFailure) {
            copiedFailure = false;

            return Response.json({ error_message: "First copy rejected" }, { status: 400 });
          }

          if (failing)
            return Response.json({ error_message: "Meal write denied" }, { status: 403 });
          const id = init.method === "POST" ? nextId++ : Number(url.split("/").at(-1));
          let entry = rows.find((row) => row.id === id);

          if (!entry) {
            entry = {
              id,
              day: "",
              type: "note",
              recipe_id: null,
              recipe_servings: 1,
              product_id: null,
              product_amount: 0,
              product_qu_id: null,
              note: null,
              section_id: -1,
              done: 0,
              row_created_timestamp: "2026-11-01 12:00:00",
            };
            rows.push(entry);
          }

          Object.assign(entry, body);

          return init.method === "POST"
            ? Response.json({ created_object_id: String(id) })
            : new Response(null, { status: 204 });
        })();
      }

      if (url === "/api/objects/meal_plan") return Response.json(rows);

      if (url === "/api/objects/meal_plan_sections") return Response.json(data.sections);

      if (url === "/api/objects/recipes") return Response.json(data.recipes);

      if (url === "/api/objects/products") return Response.json(data.products);

      return undefined;
    },
    {
      FEATURE_FLAG_RECIPES: true,
      FEATURE_FLAG_RECIPES_MEALPLAN: true,
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_SHOPPINGLIST: true,
      CALENDAR_FIRST_DAY_OF_WEEK: "1",
    },
  );

  return {
    ...app,
    data,
    rows,
    writes,
    write,
    recipe,
    product,
    get reads() {
      return reads;
    },
    allowWrite() {
      failing = false;
    },
  };
}

async function add(
  kind: "recipe" | "note" | "product" | "copy",
  date = "Monday, November 2, 2026",
) {
  const user = userEvent.setup();
  const day = (await screen.findAllByRole("columnheader", { name: date }))[0]!;

  if (kind === "recipe") await user.click(within(day).getByRole("button", { name: "Add recipe" }));
  else {
    await user.click(within(day).getByRole("button", { name: "More actions" }));
    await user.click(
      within(day).getByRole("button", {
        name: kind === "copy" ? "Copy this day" : kind === "note" ? "Add note" : "Add product",
      }),
    );
  }

  return screen.findByRole("dialog", {
    name: kind === "copy" ? `Copy all meal plan entries of 2026-11-02` : "Add meal plan entry",
  });
}

async function edit(id: number) {
  const user = userEvent.setup();

  const card = await waitFor(() => {
    const card = document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`);

    if (!card) throw new Error("Meal plan entry is not visible");

    return card;
  });

  await user.click(within(card).getByRole("button", { name: "Edit this item" }));

  return screen.findByRole("dialog", { name: "Edit meal plan entry" });
}

const warmKeys = [
  ["objects", "meal_plan"],
  ["recipes"],
  ["recipe-overview"],
  ["entity-manager", "meal_plan"],
  ["entity-manager", "recipes"],
] as const;

function warmMealCaches(app: ReturnType<typeof mountCalendar>) {
  app.client.setQueryData(
    warmKeys[0],
    app.rows.map((row) => ({ ...row })),
  );
  app.client.setQueryData(
    warmKeys[1],
    app.data.recipes.map((row) => ({ ...row })),
  );
  app.client.setQueryData(warmKeys[2], []);
  app.client.setQueryData(warmKeys[3], []);
  app.client.setQueryData(warmKeys[4], []);
}

function expectMealCaches(app: ReturnType<typeof mountCalendar>, invalidated: boolean) {
  for (const key of warmKeys) {
    const state = app.client.getQueryState(key);

    if (invalidated) expect(state === undefined || state.isInvalidated).toBe(true);
    else expect(state?.isInvalidated).toBe(false);
  }
}

test("native recipe Add uses the clicked day, asynchronous base servings and an exact recipe payload", async () => {
  const app = mountCalendar({ holdRecipe: true });
  const user = userEvent.setup();
  const dialog = await add("recipe");
  warmMealCaches(app);
  expectMealCaches(app, false);
  expect(within(dialog).getByLabelText<HTMLInputElement>("Day").value).toBe("2026-11-02");
  await user.type(within(dialog).getByRole("combobox", { name: "Recipe" }), "Soup");
  await user.click(within(dialog).getByRole("option", { name: "Soup" }));
  expect(within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Servings" }).value).toBe(
    "1",
  );
  await act(async () => app.recipe.release());
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Servings" }).value,
    ).toBe("4.125"),
  );
  await user.clear(within(dialog).getByRole("spinbutton", { name: "Servings" }));
  await user.type(within(dialog).getByRole("spinbutton", { name: "Servings" }), "4.12");
  await user.selectOptions(within(dialog).getByRole("combobox", { name: "Section" }), "2");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toEqual({
    path: "/api/objects/meal_plan",
    method: "POST",
    body: {
      type: "recipe",
      day: "2026-11-02",
      recipe_id: "8",
      recipe_servings: "4.12",
      section_id: "2",
    },
  });
  await waitFor(() => expect(app.reads).toBe(2));
  expectMealCaches(app, true);
});

test("recipe editing preserves raw servings and Add retains servings/section but clears its recipe choice", async () => {
  const app = mountCalendar();
  const user = userEvent.setup();
  let dialog = await edit(101);
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe(
    "Rice dinner",
  );
  expect(within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Servings" }).value).toBe(
    "3",
  );
  expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/objects/recipes/7")).toBe(
    false,
  );
  await user.clear(within(dialog).getByRole("spinbutton", { name: "Servings" }));
  await user.type(within(dialog).getByRole("spinbutton", { name: "Servings" }), "5.25");
  await user.selectOptions(within(dialog).getByRole("combobox", { name: "Section" }), "2");
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  dialog = await add("recipe");
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe("");
  expect(within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Servings" }).value).toBe(
    "5.25",
  );
  expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Section" }).value).toBe(
    "2",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(app.writes).toEqual([]);
});

test("native note editing submits only note fields and Add accepts blank text in the default section", async () => {
  const app = mountCalendar();
  const user = userEvent.setup();
  let dialog = await edit(103);
  warmMealCaches(app);
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: "Note" }).value).toBe(
    "<strong>Leftovers</strong>",
  );
  expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Section" }).value).toBe(
    "0",
  );
  await user.clear(within(dialog).getByRole("textbox", { name: "Note" }));
  await user.type(
    within(dialog).getByRole("textbox", { name: "Note" }),
    "Bring a pot{Enter}And a lid",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toEqual({
    path: "/api/objects/meal_plan/103",
    method: "PUT",
    body: { type: "note", day: "2026-11-04", note: "Bring a pot\nAnd a lid", section_id: "0" },
  });
  await waitFor(() => expect(app.reads).toBe(2));
  expectMealCaches(app, true);
  dialog = await add("note");
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: "Note" }).value).toBe("");
  expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Section" }).value).toBe(
    "-1",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes[1]!.body.note).toBe("");
});

test("product editing reselects stock units and converts a new display unit into the native stored stock amount", async () => {
  const app = mountCalendar({ holdProduct: true });
  const user = userEvent.setup();
  app.rows.find((row) => row.id === 102)!.product_qu_id = 2;
  const dialog = await edit(102);
  await act(async () => app.product.release());
  await waitFor(() =>
    expect(within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Amount" }).value).toBe(
      "250",
    ),
  );
  expect(
    within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit" }).value,
  ).toBe("1");
  await user.selectOptions(within(dialog).getByRole("combobox", { name: "Quantity unit" }), "2");
  await user.clear(within(dialog).getByRole("spinbutton", { name: "Amount" }));
  await user.type(within(dialog).getByRole("spinbutton", { name: "Amount" }), "0.5");
  expect(within(dialog).getByText("This equals 500 g")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toEqual({
    path: "/api/objects/meal_plan/102",
    method: "PUT",
    body: {
      type: "product",
      day: "2026-11-03",
      product_id: "11",
      product_amount: "500.",
      product_qu_id: "2",
      section_id: "2",
    },
  });
});

test("native save denial retains an editable draft and exact identity for retry without a busy lock", async () => {
  const app = mountCalendar({ failWrite: true });
  const user = userEvent.setup();
  const dialog = await edit(103);
  await user.clear(within(dialog).getByRole("textbox", { name: "Note" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "Keep my draft");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await user.click(await screen.findByRole("button", { name: /Click to show technical details/ }));
  expect(await screen.findByText(/Meal write denied/)).toBeTruthy();
  await user.click(
    within(screen.getByRole("dialog", { name: "Error details" })).getByRole("button", {
      name: "OK",
    }),
  );
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: "Note" }).value).toBe(
    "Keep my draft",
  );
  expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(
    false,
  );
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  app.allowWrite();
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.reads).toBe(2));
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/objects/meal_plan/103",
    "/api/objects/meal_plan/103",
  ]);
});

test("overlapping native saves remain enabled and a cancelled dialog's save still reloads its living page", async () => {
  const app = mountCalendar({ holdWrite: true });
  const user = userEvent.setup();
  const dialog = await add("note");
  await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "First note");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(2);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await add("recipe");
  await act(async () => app.write.release());
  await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull();
});

test.each(["note", "copy"] as const)(
  "a committed %s write after departure invalidates warm caches without reloading or reporting on its replacement page",
  async (kind) => {
    const app = mountCalendar({ holdWrite: true });
    const user = userEvent.setup();
    const dialog = await add(kind);
    warmMealCaches(app);

    if (kind === "note")
      await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "Late note");
    else await user.type(within(dialog).getByLabelText("Day"), "2026-11-05");
    await user.click(
      within(dialog).getByRole("button", { name: kind === "note" ? "Save" : "Copy" }),
    );
    await waitFor(() => expect(app.writes).toHaveLength(1));
    await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
    const readsAfterDeparture = app.reads;
    expectMealCaches(app, false);
    await act(async () => {
      app.write.release();
      await app.write.promise;
    });
    expect(app.router.history.location.pathname).toBe("/settings");
    await waitFor(() => expectMealCaches(app, true));
    expect(app.reads).toBe(readsAfterDeparture);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

test("copy day posts independent mixed entries in parallel, clears completion and waits for the native receipts", async () => {
  const app = mountCalendar({ holdWrite: true });

  for (const row of app.rows) {
    row.day = "2026-11-02";
    row.done = 1;
  }

  const user = userEvent.setup();
  const dialog = await add("copy");
  warmMealCaches(app);
  await user.type(within(dialog).getByLabelText("Day"), "2026-11-05");
  await user.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(app.writes).toHaveLength(3));
  expect(app.writes.map((write) => write.body.type)).toEqual(["recipe", "product", "note"]);

  for (const write of app.writes) {
    expect(write.path).toBe("/api/objects/meal_plan");
    expect(write.body.day).toBe("2026-11-05");
    expect(write.body.done).toBe(0);
    expect(write.body).not.toHaveProperty("id");
    expect(write.body).not.toHaveProperty("row_created_timestamp");
  }

  expect(app.reads).toBe(1);
  expectMealCaches(app, false);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await act(async () => app.write.release());
  await waitFor(() => expect(app.reads).toBe(2));
  expectMealCaches(app, true);
});

test("copying an empty day leaves its dialog open and reopening clears only the target date", async () => {
  const app = mountCalendar({ copyEmpty: true });
  const user = userEvent.setup();
  let dialog = await add("copy");
  await user.type(within(dialog).getByLabelText("Day"), "2026-11-05");
  await user.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(
      app.fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith("/api/objects/meal_plan?query[]=day=2026-11-02"),
      ),
    ).toBe(true),
  );
  expect(app.writes).toEqual([]);
  expect(app.reads).toBe(1);
  expect(dialog.isConnected).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  dialog = await add("copy");
  expect(within(dialog).getByLabelText<HTMLInputElement>("Day").value).toBe("");
});

test("native copy counters survive a partial failure and reload on the next matching receipt before its held siblings", async () => {
  const app = mountCalendar({ failCopyFirst: true, holdRetryCopyTail: true });

  for (const row of app.rows) row.day = "2026-11-02";
  const user = userEvent.setup();
  const dialog = await add("copy");
  await user.type(within(dialog).getByLabelText("Day"), "2026-11-05");
  await user.click(within(dialog).getByRole("button", { name: "Copy" }));
  await user.click(await screen.findByRole("button", { name: /Click to show technical details/ }));
  expect(await screen.findByText(/First copy rejected/)).toBeTruthy();
  await user.click(
    within(screen.getByRole("dialog", { name: "Error details" })).getByRole("button", {
      name: "OK",
    }),
  );
  await waitFor(() => expect(app.rows.filter((row) => row.day === "2026-11-05")).toHaveLength(2));
  expect(app.reads).toBe(1);
  await user.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(app.writes).toHaveLength(6));
  await waitFor(() => expect(app.reads).toBe(2));
  // The first new success reaches the retained counter of three; the other two requests are held.
  expect(app.rows.filter((row) => row.day === "2026-11-05")).toHaveLength(3);
  await act(async () => app.write.release());
});

test("product Add clears the previous product, retains its section and serializes a disabled sole stock unit", async () => {
  const app = mountCalendar();
  const user = userEvent.setup();
  let dialog = await edit(102);
  await waitFor(() =>
    expect(within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Amount" }).value).toBe(
      "250",
    ),
  );
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  dialog = await add("product");
  expect(within(dialog).getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Section" }).value).toBe(
    "2",
  );
  await user.type(within(dialog).getByLabelText("Product"), "Herbs");
  const unit = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit" });
  await waitFor(() => expect(unit.disabled).toBe(true));
  expect(unit.value).toBe("1");
  expect(within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Amount" }).value).toBe(
    "1",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toEqual({
    path: "/api/objects/meal_plan",
    method: "POST",
    body: {
      type: "product",
      day: "2026-11-02",
      product_id: "12",
      product_amount: "1.",
      product_qu_id: "1",
      section_id: "2",
    },
  });
});

test("a pending recipe lookup survives Cancel and updates the retained servings after another Add opens", async () => {
  const app = mountCalendar({ holdRecipe: true });
  const user = userEvent.setup();
  let dialog = await add("recipe");
  await user.type(within(dialog).getByRole("combobox", { name: "Recipe" }), "Soup");
  await user.click(within(dialog).getByRole("option", { name: "Soup" }));
  await waitFor(() =>
    expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/objects/recipes/8")).toBe(
      true,
    ),
  );
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  dialog = await add("recipe");
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe("");
  await act(async () => app.recipe.release());
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLInputElement>("spinbutton", { name: "Servings" }).value,
    ).toBe("4.125"),
  );
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe("");
  expect(app.writes).toEqual([]);
});
