import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type { UserSettings } from "@/lib/types";
import { mountNativeEditor } from "./fixtures/native-editor";
import { pictureBytes } from "./fixtures/picture";
import { writeApiConfig } from "@/lib/config";
import type { RecipeListItem } from "@/lib/recipe-view";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

const field = {
  id: 1,
  entity: "recipes",
  name: "course",
  caption: "Course",
  type: "text-single-line",
  input_required: 0,
  default_value: null,
  config: null,
  sort_number: 1,
  show_as_column_in_tables: 1,
};

function mountOverview(
  path = "/recipes",
  initial: UserSettings = {},
  {
    failCopy = false,
    failDelete = false,
    holdWrite = false,
    holdSettings = false,
    images = false,
    emptyImages = false,
    interactive,
    presence = false,
    holdLabels = false,
    holdMealSaves = false,
    failMealSaves = false,
    mealPlanEnabled = false,
    labelPrinter = true,
    basepath = "",
  }: {
    failCopy?: boolean;
    failDelete?: boolean;
    holdWrite?: boolean;
    holdSettings?: boolean;
    images?: boolean;
    emptyImages?: boolean;
    interactive?: "file" | "link" | "link-with-title" | "number-decimal";
    presence?: boolean;
    holdLabels?: boolean;
    holdMealSaves?: boolean;
    failMealSaves?: boolean;
    mealPlanEnabled?: boolean;
    labelPrinter?: boolean;
    basepath?: string;
  } = {},
) {
  if (images || interactive === "file") {
    const BrowserURL = URL;
    let picture = 0;
    vi.stubGlobal(
      "URL",
      class extends BrowserURL {
        static createObjectURL() {
          return `blob:recipe-image-${++picture}`;
        }
        static revokeObjectURL() {}
      },
    );
  }

  let rows: RecipeListItem[] = [
    {
      id: 3,
      name: "Zucchini stew",
      desired_servings: 10,
      due_score: 20,
      missing_products_count: 12,
      product_names: "Courgette, Salt",
      stock_status: "notenoughinstock",
      picture_file_name: null,
      custom_values: {
        course: "Dinner",
        website: '{"title":"Garden guide","link":"https://example.com/secret"}',
        photo: emptyImages ? "0" : `${btoa("z-cover.png")}_${btoa("Second cover.png")}`,
      },
    },
    {
      id: 1,
      name: "Apple tart",
      desired_servings: 2,
      due_score: 2,
      missing_products_count: 0,
      product_names: "Apple, Sugar",
      stock_status: "Xenoughinstock",
      picture_file_name: null,
      custom_values: {
        course: "Dessert",
        website: '{"title":"Orchard guide","link":"https://example.com/other?token=hidden&mode=1"}',
        photo: emptyImages ? null : `${btoa("a-cover.png")}_${btoa("First cover.png")}`,
      },
    },
    {
      id: 2,
      name: "Broth",
      desired_servings: 4,
      due_score: 10,
      missing_products_count: 2,
      product_names: "Salt, Water",
      stock_status: "enoughinstockwithshoppinglist",
      picture_file_name: null,
      custom_values: {
        course: "Dinner",
        website: null,
        photo: emptyImages ? null : `${btoa("a-cover.png")}_${btoa("First cover.png")}`,
      },
    },
  ];

  if (interactive) {
    for (const row of rows) {
      const values = row.custom_values!;

      if (presence) {
        if (row.id === 3) delete values.photo;
        else values.photo = null;
      } else if (!emptyImages) {
        const suffix = row.id === 3 ? "z" : "a";

        if (interactive === "file")
          values.photo = `${btoa(`${suffix}-note.txt`)}_${btoa("Shared note.txt")}`;
        else if (interactive === "link-with-title")
          values.photo = JSON.stringify({
            title: "Shared link",
            link: `https://example.com/${suffix}`,
          });
        else values.photo = `https://example.com/${suffix}`;
      }
    }
  }

  const settings: UserSettings = { recipes_show_list_side_by_side: true, ...initial };
  const writes: { path: string; method: string; body: unknown }[] = [];

  const labelReads: {
    path: string;
    signal: AbortSignal | null | undefined;
    gate: ReturnType<typeof deferred>;
  }[] = [];

  const printerRequests: RequestInit[] = [];

  const mealPosts: {
    body: Record<string, string>;
    signal: AbortSignal | null | undefined;
    gate: ReturnType<typeof deferred>;
  }[] = [];

  const mealEntries: Record<string, string | number>[] = [];
  let mealFails = failMealSaves;
  const reloadGate = deferred();
  const writeGate = deferred();
  const settingsGate = deferred();
  let holdReload = false;
  let copyFails = failCopy;
  let deleteFails = failDelete;
  let reads = 0;

  const app = mountNativeEditor(
    path,
    (url, init) => {
      if (url === "/api/user/settings")
        return holdSettings
          ? settingsGate.promise.then(() => Response.json(settings))
          : Response.json(settings);

      if (url.startsWith("/api/user/settings/") && init?.method) {
        const key = decodeURIComponent(url.split("/").at(-1)!);

        if (init.method === "PUT") settings[key] = JSON.parse(String(init.body)).value;
        else delete settings[key];

        return new Response(null, { status: 204 });
      }

      if (/^\/api\/recipes\/\d+\/printlabel$/.test(url)) {
        const gate = deferred();
        const id = Number(url.split("/")[3]);
        const row = rows.find((recipe) => recipe.id === id)!;
        const request = labelReads.length + 1;
        labelReads.push({ path: url, signal: init?.signal, gate });

        return (async () => {
          if (holdLabels) await gate.promise;

          return Response.json({ recipe_id: id, recipe_name: row.name, request });
        })();
      }

      if (url === "https://printer.test/overview") {
        printerRequests.push(init ?? {});

        return new Response(null, { status: 204 });
      }

      if (url === "/api/objects/meal_plan_sections?order=sort_number:asc")
        return Response.json([{ id: 4, name: "Dinner" }]);

      if (url === "/api/objects/meal_plan" && init?.method === "POST") {
        const body: Record<string, string> = JSON.parse(String(init.body));
        const gate = deferred();
        const failure = mealFails;
        const id = 31 + mealPosts.length;
        writes.push({ path: url, method: "POST", body });
        mealPosts.push({ body, signal: init.signal, gate });

        // A dispatched write may commit before its response reaches a retired document.
        if (!failure) mealEntries.push({ ...body, id });

        return (async () => {
          if (holdMealSaves) await gate.promise;

          return failure
            ? Response.json({ error_message: "Meal entry denied" }, { status: 403 })
            : Response.json({ created_object_id: String(id) });
        })();
      }

      if (url === "/api/objects/meal_plan") return Response.json(mealEntries);

      if (url === "/api/v2/custom-data/fields")
        return Response.json([
          field,
          {
            ...field,
            id: 2,
            name: "website",
            caption: "Reference",
            type: "link-with-title",
            sort_number: 2,
          },
          { ...field, id: 3, entity: "products", name: "ignored", caption: "Other namespace" },
          ...(images || interactive
            ? [
                {
                  ...field,
                  id: 4,
                  name: "photo",
                  caption: "Cover",
                  type: interactive ?? "image",
                  sort_number: 4,
                },
              ]
            : []),
        ]);

      if (url.startsWith("/api/files/userfiles/"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

      if (url === "/api/objects/recipes")
        return Response.json(
          rows.map((row) => ({
            ...row,
            type: "normal",
            base_servings: 1,
            description: "",
            product_id: null,
            not_check_shoppinglist: 0,
          })),
        );

      if (url === "/api/v2/content/recipes/editor" && init?.method === "POST")
        return new Response("<!doctype html><html><body>Preparation editor</body></html>");

      if (/^\/api\/objects\/recipes\/\d+$/.test(url) && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push({ path: url, method: "PUT", body });
        Object.assign(
          rows.find((row) => row.id === Number(url.split("/").at(-1)))!,
          body,
        );

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/recipes/overview") {
        reads++;

        return holdReload
          ? reloadGate.promise.then(() =>
              Response.json([...rows].sort((a, b) => a.name.localeCompare(b.name))),
            )
          : Response.json([...rows].sort((a, b) => a.name.localeCompare(b.name)));
      }

      const view = /^\/api\/v2\/recipes\/(\d+)\/view$/.exec(url);

      if (view) {
        const row = rows.find((row) => row.id === Number(view[1]));

        return row
          ? Response.json({
              recipe_id: row.id,
              need_fulfilled: true,
              need_fulfilled_with_shopping_list: true,
              missing_products_count: 0,
              missing_ingredients: [],
              cards: [
                {
                  id: row.id,
                  name: row.name,
                  desired_servings: row.desired_servings,
                  picture_file_name: null,
                  preparation_html: `<p>Prepare ${row.name}.</p>`,
                  costs: 0,
                  calories: 0,
                  prices_incomplete: false,
                  need_fulfilled_with_shopping_list: true,
                  ingredients: [],
                },
              ],
            })
          : Response.json({ error_message: "Missing recipe" }, { status: 404 });
      }

      if (
        (url.startsWith("/api/objects/recipes/") && init?.method === "DELETE") ||
        (url.endsWith("/copy") && init?.method === "POST")
      ) {
        writes.push({
          path: url,
          method: init.method,
          body: init.body ? JSON.parse(String(init.body)) : null,
        });

        return (async () => {
          if (holdWrite) await writeGate.promise;

          if (url.endsWith("/copy")) {
            if (copyFails)
              return Response.json({ error_message: "Copy rejected" }, { status: 403 });
            const row = rows.find((row) => row.id === Number(url.split("/")[3]))!;
            rows = [...rows, { ...row, id: 9, name: `Copy of ${row.name}` }];

            return Response.json({ created_object_id: "9" });
          }

          if (deleteFails)
            return Response.json({ error_message: "Delete rejected" }, { status: 403 });
          rows = rows.filter((row) => row.id !== Number(url.split("/").at(-1)));

          return new Response(null, { status: 204 });
        })();
      }

      return undefined;
    },
    {
      FEATURE_FLAG_RECIPES: true,
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_RECIPES_MEALPLAN: mealPlanEnabled,
      FEATURE_FLAG_LABEL_PRINTER: labelPrinter,
      LABEL_PRINTER_RUN_SERVER: false,
      LABEL_PRINTER_WEBHOOK: "https://printer.test/overview",
      LABEL_PRINTER_HOOK_JSON: true,
      LABEL_PRINTER_PARAMS: { station: "Kitchen" },
    },
    { basepath: basepath || undefined },
  );

  return {
    ...app,
    settings,
    writes,
    reloadGate,
    writeGate,
    settingsGate,
    labelReads,
    printerRequests,
    mealPosts,
    mealEntries,
    allowMealSave: () => {
      mealFails = false;
    },
    get reads() {
      return reads;
    },
    holdReload() {
      holdReload = true;
    },
    allowWrite() {
      copyFails = false;
      deleteFails = false;
    },
  };
}

function savedLayout() {
  return JSON.stringify({
    time: 1,
    order: [[3, "desc"]],
    search: { search: "old search", smart: true, regex: false, caseInsensitive: true },
    columns: Array.from({ length: 11 }, (_, i) => ({
      visible: i !== 2,
      search: { search: "old column filter", smart: true, regex: false, caseInsensitive: true },
    })),
    ColReorder: [0, 1, 9, 3, 2, 4, 5, 6, 7, 8, 10],
  });
}

async function table() {
  return screen.findByRole("table");
}

async function tableAction(list: HTMLElement, name: string) {
  const row = within(list)
    .getAllByRole("row")
    .find((item) => item.hasAttribute("data-recipe-id"))!;

  await userEvent.click(within(row).getByRole("button", { name: /^More actions for recipe / }));

  return screen.getByRole("menuitem", { name });
}

function names(list: HTMLElement) {
  return within(list)
    .getAllByRole("row")
    .flatMap((row) =>
      row.getAttribute("data-recipe-id")
        ? [
            within(row).getByRole("link", { name: /^(Apple tart|Broth|Zucchini stew|Copy of )/ })
              .textContent,
          ]
        : [],
    );
}

async function printTableRecipe(list: HTMLElement, id: number) {
  const row = within(list)
    .getAllByRole("row")
    .find((item) => item.dataset.recipeId === String(id))!;

  const more = within(row).queryByRole("button", { name: /^More actions for recipe / });

  if (more) await userEvent.click(more);
  await userEvent.click(
    more
      ? screen.getByRole("menuitem", { name: "Print Recipe Grocycode on label printer" })
      : within(row).getByText("Print Recipe Grocycode on label printer"),
  );
}

test("pending table prints remain independent and survive filtering their recipe out of view", async () => {
  const app = mountOverview("/recipes", {}, { holdLabels: true });
  const list = await table();
  await printTableRecipe(list, 2);
  await waitFor(() => expect(app.labelReads).toHaveLength(1));
  await printTableRecipe(list, 2);
  await waitFor(() => expect(app.labelReads).toHaveLength(2));
  expect(app.labelReads.map((read) => read.path)).toEqual([
    "/api/recipes/2/printlabel",
    "/api/recipes/2/printlabel",
  ]);
  await userEvent.type(screen.getByRole("searchbox", { name: "Search recipes" }), "Apple");
  await waitFor(() => expect(names(list)).toEqual(["Apple tart"]));
  expect(app.router.history.location.search).toBe("?search=Apple");
  expect(app.printerRequests).toEqual([]);
  await act(async () => app.labelReads[1]!.gate.release());
  await waitFor(() => expect(app.printerRequests).toHaveLength(1));
  await act(async () => app.labelReads[0]!.gate.release());
  await waitFor(() => expect(app.printerRequests).toHaveLength(2));
  expect(
    app.printerRequests.map((request) => ({
      method: request.method,
      type: new Headers(request.headers).get("Content-Type"),
      body: JSON.parse(String(request.body)),
    })),
  ).toEqual([
    {
      method: "POST",
      type: "application/json",
      body: { recipe_id: 2, recipe_name: "Broth", request: 2, station: "Kitchen" },
    },
    {
      method: "POST",
      type: "application/json",
      body: { recipe_id: 2, recipe_name: "Broth", request: 1, station: "Kitchen" },
    },
  ]);
  expect(app.labelReads.every((read) => read.signal?.aborted === false)).toBe(true);
  expect(screen.queryByText("Label request sent")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.writes).toEqual([]);
  expect(names(list)).toEqual(["Apple tart"]);
});

test("table-options Reset retires pending recipe printing when it replaces the native document", async () => {
  const app = mountOverview("/recipes", {}, { holdLabels: true });
  const list = await table();
  await printTableRecipe(list, 2);
  await waitFor(() => expect(app.labelReads).toHaveLength(1));
  await userEvent.click(within(list).getByRole("button", { name: "Table options" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Table options" })).getByRole("button", {
      name: "Reset",
    }),
  );
  await userEvent.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(app.reads).toBe(2));
  const fresh = await screen.findByRole("table", { name: "Recipes" });
  expect(names(fresh)).toEqual(["Apple tart", "Broth", "Zucchini stew"]);
  await act(async () => app.labelReads[0]!.gate.release());
  expect(app.printerRequests).toEqual([]);
  expect(screen.queryByText("Label request sent")).toBeNull();
  expect(screen.queryByText("Error while executing WebHook")).toBeNull();
  expect(app.labelReads[0]!.signal?.aborted).toBe(true);
});

test("native table More retains prefixed Download and mutations while label printing is disabled", async () => {
  const app = mountOverview(
    "/house.hold/index.php/recipes?search=Broth",
    {},
    {
      basepath: "/house.hold/index.php",
      labelPrinter: false,
    },
  );

  const list = await table();
  const row = within(list).getByRole("link", { name: "Broth" }).closest("tr")!;
  expect(within(row).getByRole("link", { name: "Edit Broth" }).getAttribute("href")).toBe(
    "/house.hold/index.php/recipe/2",
  );
  expect(within(row).queryByRole("button", { name: "Delete this item" })).toBeNull();
  expect(within(row).queryByRole("button", { name: "Copy recipe" })).toBeNull();
  const trigger = within(row).getByRole("button", { name: "More actions for recipe Broth" });
  await userEvent.click(trigger);
  const menu = screen.getByRole("menu", { name: "More actions for recipe Broth" });
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Add to meal plan", "Delete this item", "Copy recipe", "Download Recipe Grocycode"]);
  expect(
    within(menu).getByRole("menuitem", { name: "Download Recipe Grocycode" }).getAttribute("href"),
  ).toBe("/house.hold/index.php/recipe/2/grocycode?download=true");
  expect(
    within(menu).queryByRole("menuitem", { name: "Print Recipe Grocycode on label printer" }),
  ).toBeNull();
  await userEvent.keyboard("{End}");
  expect(document.activeElement).toBe(
    within(menu).getByRole("menuitem", { name: "Download Recipe Grocycode" }),
  );
  await userEvent.tab();
  expect(screen.queryByRole("menu", { name: "More actions for recipe Broth" })).toBeNull();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("menuitem", { name: "Add to meal plan" }));
  const dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });
  await waitFor(() =>
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Section").value).toBe("4"),
  );
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe(
    "Broth",
  );
  fireEvent.change(within(dialog).getByLabelText("Day"), { target: { value: "2026-11-20" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull(),
  );
  expect(app.writes).toEqual([
    {
      path: "/api/objects/meal_plan",
      method: "POST",
      body: {
        day: "2026-11-20",
        recipe_id: "2",
        recipe_servings: "1",
        section_id: "4",
        type: "recipe",
      },
    },
  ]);
});

async function nativeMealDialog(id = 2) {
  const list = await table();

  const row = within(list)
    .getAllByRole("row")
    .find((item) => item.dataset.recipeId === String(id))!;

  await userEvent.click(within(row).getByRole("button", { name: /^More actions for recipe / }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Add to meal plan" }));
  const dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });
  await waitFor(() =>
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Section").value).toBe("4"),
  );

  return dialog;
}

test("native meal-plan saves capture independent raw drafts and finish before an unrelated held read", async () => {
  const app = mountOverview("/recipes?search=Broth", {}, { holdMealSaves: true });
  const dialog = await nativeMealDialog();
  const servings = within(dialog).getByLabelText<HTMLInputElement>("Servings");
  fireEvent.change(within(dialog).getByLabelText("Day"), { target: { value: "2026-11-20" } });
  fireEvent.change(servings, { target: { value: "1.00" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(1));
  expect(servings.matches(":disabled")).toBe(false);
  fireEvent.change(servings, { target: { value: "2.50" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(2));
  expect(app.mealPosts.map((post) => post.body)).toEqual([
    { day: "2026-11-20", recipe_id: "2", recipe_servings: "1.00", section_id: "4", type: "recipe" },
    { day: "2026-11-20", recipe_id: "2", recipe_servings: "2.50", section_id: "4", type: "recipe" },
  ]);
  expect(servings.value).toBe("2.50");
  expect(within(dialog).getByLabelText<HTMLSelectElement>("Recipe").matches(":disabled")).toBe(
    false,
  );
  expect(within(dialog).getByLabelText<HTMLInputElement>("Day").matches(":disabled")).toBe(false);
  expect(within(dialog).getByLabelText<HTMLSelectElement>("Section").matches(":disabled")).toBe(
    false,
  );
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  const readsBeforeRefresh = app.reads;
  app.holdReload();
  await act(async () => {
    void app.client.refetchQueries({ queryKey: ["recipe-overview"] });
  });
  await waitFor(() => expect(app.reads).toBe(readsBeforeRefresh + 1));
  await act(async () => app.mealPosts[1]!.gate.release());
  expect(await screen.findByText("Successfully added the recipe to the meal plan")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull();
  expect(app.client.getQueryState(["recipe-overview"])?.fetchStatus).toBe("fetching");
  await act(async () => app.mealPosts[0]!.gate.release());
  await waitFor(() =>
    expect(screen.getAllByText("Successfully added the recipe to the meal plan")).toHaveLength(2),
  );
  expect(app.mealEntries.map((entry) => entry.recipe_servings)).toEqual(["1.00", "2.50"]);
  expect(app.router.history.location.search).toBe("?search=Broth");
  await act(async () => app.reloadGate.release());
});

test("native meal-plan denial after Cancel reports generic details and retains an exact retry draft", async () => {
  const app = mountOverview(
    "/recipes?search=Broth",
    {},
    { holdMealSaves: true, failMealSaves: true },
  );

  let dialog = await nativeMealDialog();
  const day = within(dialog).getByLabelText<HTMLInputElement>("Day").value;
  fireEvent.change(within(dialog).getByLabelText("Servings"), { target: { value: "3.25" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(1));
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull();
  await act(async () => app.mealPosts[0]!.gate.release());
  expect(
    await screen.findByText("Error while saving, probably this item already exists"),
  ).toBeTruthy();
  expect(screen.queryByText("Meal entry denied")).toBeNull();
  expect(app.mealPosts[0]!.signal?.aborted).not.toBe(true);
  await userEvent.click(screen.getByRole("button", { name: /Click to show technical details/ }));
  const details = await screen.findByRole("dialog", { name: "Error details" });
  expect(within(details).getByText(/Meal entry denied/)).toBeTruthy();
  await userEvent.click(within(details).getByRole("button", { name: "OK" }));
  dialog = await nativeMealDialog();
  expect(within(dialog).getByLabelText<HTMLInputElement>("Servings").value).toBe("3.25");
  expect(within(dialog).getByLabelText<HTMLInputElement>("Day").value).toBe(day);
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe(
    "Broth",
  );
  expect(within(dialog).queryByText("Meal entry denied")).toBeNull();
  app.allowMealSave();
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(2));
  const body = { day, recipe_id: "2", recipe_servings: "3.25", section_id: "4", type: "recipe" };
  expect(app.mealPosts.map((post) => post.body)).toEqual([body, body]);
  expect(app.mealEntries).toEqual([{ ...body, id: 32 }]);
  await act(async () => app.mealPosts[1]!.gate.release());
  expect(await screen.findByText("Successfully added the recipe to the meal plan")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull();
});

test.each(["native", "additional"] as const)(
  "pending native meal-plan completion respects a later %s opening on the same document",
  async (opening) => {
    const app = mountOverview(
      "/recipes",
      {},
      {
        holdMealSaves: true,
        mealPlanEnabled: opening === "additional",
      },
    );

    let dialog = await nativeMealDialog();
    fireEvent.change(within(dialog).getByLabelText("Servings"), { target: { value: "4.50" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.mealPosts).toHaveLength(1));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    if (opening === "native") dialog = await nativeMealDialog(1);
    else {
      await userEvent.click(screen.getByRole("tab", { name: "Gallery" }));
      const card = screen.getByRole("link", { name: "Apple tart" }).closest("li")!;
      await userEvent.click(within(card).getByRole("button", { name: "Add to meal plan" }));
      dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });
    }

    expect(
      within(dialog).getByRole<HTMLInputElement | HTMLSelectElement>("combobox", { name: "Recipe" })
        .value,
    ).toBe(opening === "native" ? "Apple tart" : "1");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Servings").value).toBe("4.50");
    fireEvent.change(within(dialog).getByLabelText("Servings"), { target: { value: "6.75" } });
    await act(async () => app.mealPosts[0]!.gate.release());
    expect(await screen.findByText("Successfully added the recipe to the meal plan")).toBeTruthy();
    expect(app.mealPosts).toHaveLength(1);
    expect(app.mealPosts[0]!.body.recipe_id).toBe("2");
    expect(app.mealPosts[0]!.body.recipe_servings).toBe("4.50");
    expect(app.mealPosts[0]!.signal?.aborted).not.toBe(true);

    if (opening === "native") {
      expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull();
      dialog = await nativeMealDialog(1);
    } else {
      expect(screen.getByRole("dialog", { name: "Add meal plan entry" })).toBe(dialog);
      expect(
        within(dialog).getByRole<HTMLInputElement | HTMLSelectElement>("combobox", {
          name: "Recipe",
        }).value,
      ).toBe("1");
    }

    expect(within(dialog).getByLabelText<HTMLInputElement>("Servings").value).toBe("6.75");
  },
);

test("same-path Table Reset aborts native meal-plan transport and preserves committed-cache and replacement-dialog controls", async () => {
  const app = mountOverview("/recipes", {}, { holdMealSaves: true });
  const original = await table();
  const dialog = await nativeMealDialog();
  fireEvent.change(within(dialog).getByLabelText("Servings"), { target: { value: "2.75" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(1));
  expect(app.mealEntries).toHaveLength(1);
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await userEvent.click(within(original).getByRole("button", { name: "Table options" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Table options" })).getByRole("button", {
      name: "Reset",
    }),
  );
  await userEvent.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(original.isConnected).toBe(false));
  const fresh = await nativeMealDialog(1);
  fireEvent.change(within(fresh).getByLabelText("Servings"), { target: { value: "8.25" } });
  const keys = [["meal-plan"], ["mealplan-calendar", "?start=2026-11-02"]];

  for (const key of keys) {
    app.client.setQueryData(key, []);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  await act(async () => app.mealPosts[0]!.gate.release());
  await waitFor(() => {
    for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  });
  expect(screen.getByRole("dialog", { name: "Add meal plan entry" })).toBe(fresh);
  expect(within(fresh).getByLabelText<HTMLInputElement>("Servings").value).toBe("8.25");
  expect(within(fresh).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe(
    "Apple tart",
  );
  expect(screen.queryByText("Successfully added the recipe to the meal plan")).toBeNull();
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
  expect(app.mealPosts[0]!.signal?.aborted).toBe(true);
  expect(app.mealEntries).toEqual([{ ...app.mealPosts[0]!.body, id: 31 }]);
  expect(app.router.history.location.pathname).toBe("/recipes");
});

function fixedMealPlanToday() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 7, 12, 34, 56));
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

test("native recipe suggestions choose on Enter release before a later Enter saves the live shorthand day", async () => {
  fixedMealPlanToday();
  const user = userEvent.setup();
  const app = mountOverview();
  const dialog = await nativeMealDialog(3);
  const picker = within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" });
  const day = within(dialog).getByLabelText<HTMLInputElement>("Day");
  await user.clear(day);
  await user.type(day, "+7d");
  expect(day.value).toBe("2026-11-14");
  await user.tab();
  await user.clear(picker);
  await user.type(picker, "Br");
  expect(within(dialog).getByRole("option", { name: "Broth" })).toBeTruthy();
  await user.keyboard("{Enter>}");
  expect(picker.value).toBe("Br");
  expect(app.mealPosts).toEqual([]);
  await user.keyboard("{/Enter}");
  expect(picker.value).toBe("Broth");
  expect(within(dialog).queryByRole("listbox")).toBeNull();
  expect(app.mealPosts).toEqual([]);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(app.mealPosts).toHaveLength(1));
  expect(app.mealPosts[0]!.body).toEqual({
    day: "2026-11-14",
    recipe_id: "2",
    recipe_servings: "1",
    section_id: "4",
    type: "recipe",
  });
});

test("native typed recipe Grocycode resolves on blur and an unknown code cannot reuse the previous ID", async () => {
  fixedMealPlanToday();
  const app = mountOverview();
  let dialog = await nativeMealDialog();
  let picker = within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" });
  await userEvent.clear(picker);
  await userEvent.type(picker, "grcy:r:3");
  expect(picker.value).toBe("grcy:r:3");
  await userEvent.tab();
  expect(picker.value).toBe("Zucchini stew");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(1));
  expect(app.mealPosts[0]!.body.recipe_id).toBe("3");
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull(),
  );
  dialog = await nativeMealDialog(3);
  picker = within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" });
  await userEvent.clear(picker);
  await userEvent.type(picker, "grcy:r:999");
  await userEvent.tab();
  expect(picker.value).toBe("");
  expect(picker.checkValidity()).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(app.mealPosts).toHaveLength(1);
  await userEvent.type(picker, "Br");
  await userEvent.click(within(dialog).getByRole("option", { name: "Broth" }));
  act(() => {
    document.dispatchEvent(
      new CustomEvent("Grocy.BarcodeScanned", {
        detail: { barcode: "grcy:r:1", target: "@productpicker" },
      }),
    );
  });
  expect(picker.value).toBe("Broth");
  act(() => {
    document.dispatchEvent(
      new CustomEvent("Grocy.BarcodeScanned", {
        detail: { barcode: "grcy:r:1", target: "@recipepicker" },
      }),
    );
  });
  expect(picker.value).toBe("grcy:r:1");
  expect(picker.form?.checkValidity()).toBe(true);
  expect(app.mealPosts).toHaveLength(1);
  await waitFor(() => expect(picker.value).toBe("Apple tart"));
  expect(app.mealPosts).toHaveLength(1);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(2));
  expect(app.mealPosts[1]!.body.recipe_id).toBe("1");
});

test("a real still-shown recipe menu blocks Save after rapid Cancel and valid native reopening", async () => {
  const app = mountOverview();
  let dialog = await nativeMealDialog();
  const picker = within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" });
  await userEvent.clear(picker);
  await userEvent.type(picker, "Br");
  expect(within(dialog).getByRole("listbox")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "More actions for recipe Apple tart" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Add to meal plan" }));
  dialog = screen.getByRole("dialog", { name: "Add meal plan entry" });
  const current = within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" });
  expect(current.value).toBe("Apple tart");
  expect(current.form?.checkValidity()).toBe(true);
  expect(within(dialog).getByRole("listbox")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(app.mealPosts).toEqual([]);
  await waitFor(() => expect(within(dialog).queryByRole("listbox")).toBeNull());
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(1));
  expect(app.mealPosts[0]!.body.recipe_id).toBe("1");
});

test("native Day reinitializes from prior visible text and restored cached dates require actual revalidation", async () => {
  fixedMealPlanToday();
  const app = mountOverview();
  let dialog = await nativeMealDialog();
  let day = within(dialog).getByLabelText<HTMLInputElement>("Day");
  expect(day.value).toBe("2026-11-07");
  await userEvent.clear(day);
  await userEvent.type(day, "bad");
  await userEvent.tab();
  expect(day.value).toBe("");
  expect(day.validity.customError).toBe(true);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(app.mealPosts).toEqual([]);
  await userEvent.type(day, "2026-12-20");
  await userEvent.tab();
  expect(day.value).toBe("2026-12-20");
  expect(day.checkValidity()).toBe(true);
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  dialog = await nativeMealDialog();
  day = within(dialog).getByLabelText<HTMLInputElement>("Day");
  expect(day.value).toBe("2026-11-07");
  await userEvent.clear(day);
  await userEvent.type(day, "bad");
  await userEvent.tab();
  expect(day.value).toBe("2026-12-20");
  expect(day.validity.customError).toBe(true);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(app.mealPosts).toEqual([]);
  await userEvent.click(day);
  await userEvent.keyboard("{Shift}");
  expect(day.checkValidity()).toBe(true);
  await userEvent.clear(day);
  await userEvent.type(day, "bad");
  await userEvent.tab();
  expect(day.value).toBe("2026-12-20");
  expect(day.validity.customError).toBe(true);
  await userEvent.click(within(dialog).getByRole("button", { name: "Day: Calendar" }));
  const calendar = screen.getByRole("dialog", { name: "Day: Calendar" });
  await userEvent.click(within(calendar).getByRole("button", { name: "Close the picker" }));
  expect(day.checkValidity()).toBe(true);
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.mealPosts).toHaveLength(1));
  expect(app.mealPosts[0]!.body.day).toBe("2026-12-20");
});

test("native recipe layout restores nine base indexes and custom columns before choosing the first ordered recipe", async () => {
  const app = mountOverview("/recipes", { "datatables_state_recipes-table": savedLayout() });
  const list = await table();
  expect(names(list)).toEqual(["Zucchini stew", "Broth", "Apple tart"]);
  expect(await screen.findByRole("heading", { level: 1, name: "Apple tart" })).toBeTruthy();
  expect(
    within(list).getByRole("link", { name: "Zucchini stew" }).closest("tr")?.dataset.selected,
  ).toBe("true");
  expect(
    within(list)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual([
    "Table options",
    "Name: Sort",
    "Course: Sort",
    "Due score: Sort",
    "Requirements fulfilled: Sort",
    "Reference: Sort",
  ]);
  expect(within(list).queryByText("Other namespace")).toBeNull();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("searchbox", { name: "Search recipes" }),
    '"Garden guide" Dinner',
  );
  expect(names(list)).toEqual(["Zucchini stew"]);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.type(screen.getByRole("searchbox", { name: "Search recipes" }), "secret");
  expect(names(list)).toEqual(["Zucchini stew"]);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.type(screen.getByRole("searchbox", { name: "Search recipes" }), "token");
  expect(screen.getByText("No recipe matches this filter.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await waitFor(() =>
    expect(String(app.settings["datatables_state_recipes-table"])).not.toContain("old search"),
  );
  await user.click(within(list).getByRole("button", { name: "Requirements fulfilled: Sort" }));
  expect(names(list)).toEqual(["Apple tart", "Zucchini stew", "Broth"]);
});

test("recipe status groups use native shadow labels and table reset reloads fresh rows after a delayed response", async () => {
  const app = mountOverview();
  const list = await table();
  const user = userEvent.setup();
  await user.click(within(list).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("radio", { name: "Requirements fulfilled" }));
  await waitFor(() =>
    expect(app.settings["datatables_rowGroup_recipes-table"]).toBe('{"enable":true,"dataSrc":"8"}'),
  );
  await user.click(within(options).getByRole("button", { name: "OK" }));

  const group = within(list).getByRole("button", {
    name: "Not enough in stock, but already on the shopping list",
  });

  await user.click(group);
  expect(
    within(list).getByRole("link", { name: "Broth", hidden: true }).closest("tr")?.style.display,
  ).toBe("none");
  await user.click(within(list).getByRole("button", { name: "Table options" }));
  app.holdReload();
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
  await waitFor(() => expect(app.reads).toBe(2));
  await act(async () => app.reloadGate.release());
  await waitFor(() =>
    expect(names(screen.getByRole("table", { name: "Recipes" }))).toEqual([
      "Apple tart",
      "Broth",
      "Zucchini stew",
    ]),
  );
  expect(
    screen.queryByRole("button", { name: "Not enough in stock, but already on the shopping list" }),
  ).toBeNull();
  expect(app.settings["datatables_rowGroup_recipes-table"]).toBeUndefined();
});

test("custom image groups retain encoded file identity, native HTML order and named dialog interaction", async () => {
  writeApiConfig({ baseUrl: "", apiKey: "recipe-image-key" });
  const opened = vi.spyOn(window, "open").mockImplementation(() => null);
  onTestFinished(() => opened.mockRestore());

  const app = mountOverview(
    "/recipes",
    { recipes_show_list_side_by_side: false },
    { images: true },
  );

  const list = await table();
  const user = userEvent.setup();
  await user.click(within(list).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("radio", { name: "Cover" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(list.querySelectorAll("tr.stock-table-group")).toHaveLength(2));
  const headers = Array.from(list.querySelectorAll<HTMLTableRowElement>("tr.stock-table-group"));
  await within(headers[0]!).findByRole("img", { name: "Second cover.png" });
  await within(headers[1]!).findByRole("img", { name: "First cover.png" });
  expect(names(list)).toEqual(["Zucchini stew", "Apple tart", "Broth"]);
  const imageUrl = `/files/userfiles/${btoa("z-cover.png")}_${btoa("Second cover.png")}?force_serve_as=picture`;
  const image = within(headers[0]!).getByRole("link", { name: "Second cover.png" });
  expect(image.getAttribute("href")).toBe(imageUrl);
  await user.click(image);
  const dialog = await screen.findByRole("dialog", { name: "Details" });
  expect(dialog.classList.contains("form")).toBe(true);
  expect(within(dialog).getByTitle<HTMLIFrameElement>("Details").getAttribute("src")).toBe(
    window.location.origin + imageUrl,
  );
  expect(opened).not.toHaveBeenCalled();
  expect(app.fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/files/"))).toEqual(
    [],
  );
  expect(
    within(list).getByRole("link", { name: "Zucchini stew", hidden: true }).closest("tr")?.style
      .display,
  ).toBe("none");
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await user.click(within(headers[1]!).getByRole("button", { name: "Group: First cover.png" }));

  for (const name of ["Apple tart", "Broth"])
    expect(
      within(list).getByRole("link", { name, hidden: true }).closest("tr")?.style.display,
    ).toBe("none");
  expect(app.writes).toHaveLength(0);
});

test.each(["image", "file"] as const)(
  "PHP-empty %s zero remains a text group while null values share a blank group without file reads",
  async (type) => {
    const app = mountOverview(
      "/recipes",
      { recipes_show_list_side_by_side: false },
      {
        images: type === "image",
        interactive: type === "file" ? "file" : undefined,
        emptyImages: true,
      },
    );

    const list = await table();
    const user = userEvent.setup();
    await user.click(within(list).getByRole("button", { name: "Table options" }));
    const options = screen.getByRole("dialog", { name: "Table options" });
    await user.click(within(options).getByRole("radio", { name: "Cover" }));
    await user.click(within(options).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(list.querySelectorAll("tr.stock-table-group")).toHaveLength(2));
    expect(within(list).getByRole("button", { name: "0" })).toBeTruthy();
    const zeroRow = within(list).getByRole("link", { name: "Zucchini stew" }).closest("tr")!;
    expect(within(zeroRow).getByText("0", { selector: "td" })).toBeTruthy();
    expect(within(list).queryByRole("img")).toBeNull();
    expect(
      app.fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/files/userfiles/")),
    ).toHaveLength(0);
  },
);

test.each(["file", "link", "link-with-title"] as const)(
  "%s groups preserve target identity and coalesce identical metadata",
  async (interactive) => {
    writeApiConfig({ baseUrl: "", apiKey: "recipe-file-key" });
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    onTestFinished(() => opened.mockRestore());

    const app = mountOverview(
      "/recipes",
      { recipes_show_list_side_by_side: false },
      { interactive },
    );

    const list = await table();
    const user = userEvent.setup();
    await user.click(within(list).getByRole("button", { name: "Table options" }));
    const options = screen.getByRole("dialog", { name: "Table options" });
    await user.click(within(options).getByRole("radio", { name: "Cover" }));
    await user.click(within(options).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(list.querySelectorAll("tr.stock-table-group")).toHaveLength(2));
    const headers = Array.from(list.querySelectorAll<HTMLTableRowElement>("tr.stock-table-group"));

    if (interactive !== "file") {
      expect(
        headers.map((header) => within(header).getByRole("link").getAttribute("href")),
      ).toEqual(["https://example.com/a", "https://example.com/z"]);
      expect(names(list)).toEqual(["Apple tart", "Broth", "Zucchini stew"]);
      expect(within(headers[0]!).getByRole("link").textContent).toBe(
        interactive === "link" ? "https://example.com/a" : "Shared link",
      );
      await user.click(within(headers[0]!).getByRole("link"));
    } else {
      expect(
        headers.map((header) =>
          within(header).getByRole("link", { name: "Shared note.txt" }).getAttribute("href"),
        ),
      ).toEqual(
        ["z", "a"].map(
          (prefix) => `/files/userfiles/${btoa(`${prefix}-note.txt`)}_${btoa("Shared note.txt")}`,
        ),
      );
      expect(
        headers.map(
          (header) =>
            within(header).getByRole<HTMLAnchorElement>("link", { name: "Shared note.txt" }).target,
        ),
      ).toEqual(["_blank", "_blank"]);
      expect(names(list)).toEqual(["Zucchini stew", "Apple tart", "Broth"]);
      await user.click(within(headers[1]!).getByRole("link", { name: "Shared note.txt" }));
      expect(opened).not.toHaveBeenCalled();
      expect(
        app.fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/files/")),
      ).toEqual([]);
    }

    for (const name of ["Apple tart", "Broth"])
      expect(
        within(list).getByRole("link", { name, hidden: true }).closest("tr")?.style.display,
      ).toBe("none");
    expect(app.writes).toHaveLength(0);
  },
);

test.each(["link", "link-with-title", "number-decimal"] as const)(
  "%s groups distinguish a missing value from a saved legacy NULL",
  async (interactive) => {
    mountOverview(
      "/recipes",
      { recipes_show_list_side_by_side: false },
      { interactive, presence: true },
    );
    const list = await table();
    const user = userEvent.setup();
    await user.click(within(list).getByRole("button", { name: "Table options" }));
    const options = screen.getByRole("dialog", { name: "Table options" });
    await user.click(within(options).getByRole("radio", { name: "Cover" }));
    await user.click(within(options).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(list.querySelectorAll("tr.stock-table-group")).toHaveLength(2));
    const imported = within(list).getByRole("link", { name: "Apple tart" }).closest("tr")!;
    const missing = within(list).getByRole("link", { name: "Zucchini stew" }).closest("tr")!;
    const importedCell = imported.cells[imported.cells.length - 1]!;
    const missingCell = missing.cells[missing.cells.length - 1]!;
    expect(missingCell.childElementCount).toBe(0);

    if (interactive === "number-decimal")
      expect(importedCell.querySelector("span.locale-number-generic")).toBeTruthy();
    else expect(importedCell.querySelector('a[href=""]')).toBeTruthy();
    const selector = interactive === "number-decimal" ? "span.locale-number-generic" : 'a[href=""]';
    expect(
      Array.from(list.querySelectorAll("tr.stock-table-group")).filter((header) =>
        header.querySelector(selector),
      ),
    ).toHaveLength(1);
  },
);

test("native list copy and gallery delete retain exact identities and reload the resulting selection", async () => {
  const app = mountOverview("/recipes?search=Broth&status=enoughinstockwithshoppinglist");
  const list = await table();
  const user = userEvent.setup();
  await user.click(await tableAction(list, "Copy recipe"));
  await screen.findByRole("heading", { level: 1, name: "Copy of Broth" });
  expect(app.writes).toEqual([{ path: "/api/recipes/2/copy", method: "POST", body: {} }]);
  expect(app.router.history.location.search).toBe("?recipe=9");
  await user.click(screen.getByRole("tab", { name: "Gallery" }));
  const card = screen.getByRole("link", { name: "Copy of Broth" }).closest("li")!;
  await user.click(within(card).getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "No" }));
  expect(app.writes).toHaveLength(1);
  await user.click(within(card).getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: "Copy of Broth" })).toBeNull());
  expect(app.writes[1]).toEqual({ path: "/api/objects/recipes/9", method: "DELETE", body: null });
  expect(app.router.history.location.search).toBe("");
});

test("recipe table visibility, numeric ordering, column order and cleared saved searches survive a return visit", async () => {
  const app = mountOverview();
  const user = userEvent.setup();
  let list = await table();
  await user.click(within(list).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("checkbox", { name: "Desired servings" }));
  await user.click(within(options).getByRole("checkbox", { name: "Reference" }));

  for (let i = 0; i < 6; i++)
    await user.click(within(options).getByRole("button", { name: "Move Course earlier" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  await user.click(within(list).getByRole("button", { name: "Desired servings: Sort" }));
  expect(names(list)).toEqual(["Apple tart", "Broth", "Zucchini stew"]);
  await user.click(within(list).getByRole("button", { name: "Desired servings: Sort" }));
  expect(names(list)).toEqual(["Zucchini stew", "Broth", "Apple tart"]);
  await user.type(screen.getByRole("searchbox", { name: "Search recipes" }), "Courgette");
  expect(names(list)).toEqual(["Zucchini stew"]);
  await waitFor(() =>
    expect(JSON.parse(String(app.settings["datatables_state_recipes-table"])).order).toEqual([
      [2, "desc"],
    ]),
  );
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await act(async () => app.router.navigate({ href: "/recipes" }));
  list = await table();
  expect(names(list)).toEqual(["Zucchini stew", "Broth", "Apple tart"]);
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search recipes" }).value).toBe(
    "",
  );

  const headers = within(list)
    .getAllByRole("columnheader")
    .map((cell) => cell.textContent);

  expect(headers).toContain("Desired servings: Sort");
  expect(headers).not.toContain("Reference: Sort");
  expect(headers.indexOf("Course: Sort")).toBeLessThan(
    headers.indexOf("Requirements fulfilled: Sort"),
  );
  expect(await screen.findByRole("heading", { level: 1, name: "Apple tart" })).toBeTruthy();
});

test("gallery filters deliberately use the last handler while the list still combines status and smart search", async () => {
  localStorage.setItem("recipes_last_tab_id", "gallery-tab");
  mountOverview("/recipes?tab=list&search=Apple&status=all");
  const user = userEvent.setup();
  const catalog = within(await screen.findByRole("region", { name: "Recipe list" }));
  await catalog.findByRole("link", { name: "Zucchini stew" });
  expect(catalog.getByRole("tab", { name: "Gallery" }).getAttribute("aria-selected")).toBe("true");
  await user.selectOptions(
    catalog.getByRole("combobox", { name: "Status" }),
    "enoughinstockwithshoppinglist",
  );
  expect(catalog.queryByRole("link", { name: "Apple tart" })).toBeNull();
  expect(catalog.getByRole("link", { name: "Broth" })).toBeTruthy();
  await user.clear(catalog.getByRole("searchbox", { name: "Search recipes" }));
  await user.type(catalog.getByRole("searchbox", { name: "Search recipes" }), "Apple");
  expect(catalog.getByRole("link", { name: "Apple tart" })).toBeTruthy();
  expect(catalog.queryByRole("link", { name: "Broth" })).toBeNull();
  await user.click(catalog.getByRole("tab", { name: "List" }));
  expect(catalog.getByText("No recipe matches this filter.")).toBeTruthy();
});

test("copy denial shows native generic details and preserves filters for an exact-record retry", async () => {
  const app = mountOverview("/recipes?search=Broth", {}, { failCopy: true });
  const user = userEvent.setup();
  const list = await table();
  await user.click(await tableAction(list, "Copy recipe"));
  expect(
    await screen.findByText("Error while saving, probably this item already exists"),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Click to show technical details/ }));
  expect(await screen.findByText(/Copy rejected/)).toBeTruthy();
  expect(app.router.history.location.search).toBe("?search=Broth");
  expect(names(list)).toEqual(["Broth"]);
  app.allowWrite();
  await user.click(await tableAction(list, "Copy recipe"));
  await screen.findByRole("heading", { level: 1, name: "Copy of Broth" });
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/recipes/2/copy",
    "/api/recipes/2/copy",
  ]);
});

test("delete denial closes confirmation, logs only and leaves the selected recipe and filters intact", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mountOverview("/recipes?recipe=2&search=Broth", {}, { failDelete: true });
  const list = await table();
  const user = userEvent.setup();
  await user.click(await tableAction(list, "Delete this item"));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Delete rejected")).toBeNull();
  expect(names(list)).toEqual(["Broth"]);
  expect(app.router.history.location.search).toBe("?recipe=2&search=Broth");
});

test.each(["copy", "delete"] as const)(
  "a held recipe %s completing after departure cannot navigate or reopen its owner",
  async (kind) => {
    const app = mountOverview("/recipes?search=Broth", {}, { holdWrite: true });
    const list = await table();
    const user = userEvent.setup();
    await user.click(await tableAction(list, kind === "copy" ? "Copy recipe" : "Delete this item"));

    if (kind === "delete")
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(app.writes).toHaveLength(1));
    await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
    await act(async () => {
      app.writeGate.release();
      await app.writeGate.promise;
    });
    await waitFor(() =>
      expect(app.client.getQueryState(["recipe-overview"])?.isInvalidated).toBe(true),
    );
    expect(app.router.history.location.pathname).toBe("/settings");
    expect(screen.queryByRole("table", { name: "Recipes" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

test("native recipe cells toggle single-row selection while explicit reader links remain available", async () => {
  mountOverview("/recipes", { recipes_show_list_side_by_side: false });
  const list = await table();
  const user = userEvent.setup();
  const row = within(list).getByRole("link", { name: "Apple tart" }).closest("tr")!;
  expect(row.dataset.selected).toBe("true");
  await user.click(within(row).getByText("Dessert"));
  expect(row.dataset.selected).toBeUndefined();
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(within(row).getByText("Dessert"));
  expect(await screen.findByRole("dialog", { name: "Apple tart" })).toBeTruthy();
  expect(row.dataset.selected).toBe("true");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(within(row).getByRole("link", { name: "Apple tart" }));
  expect(await screen.findByRole("dialog", { name: "Apple tart" })).toBeTruthy();
});

test("raw false retains the native PHP split preview while selection uses JavaScript BoolVal", async () => {
  mountOverview("/recipes", { recipes_show_list_side_by_side: "false" });
  const list = await table();
  expect(await screen.findByRole("heading", { level: 1, name: "Apple tart" })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(within(list).getByRole("link", { name: "Broth" }));
  expect(await screen.findByRole("dialog", { name: "Broth" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1, name: "Apple tart" })).toBeTruthy();
});

test("a fresh settings response determines recipe ordering before cached table state can select or overwrite it", async () => {
  const app = mountOverview(
    "/settings?tab=connection",
    { "datatables_state_recipes-table": savedLayout() },
    { holdSettings: true },
  );

  app.client.setQueryData(["user", "settings"], { recipes_show_list_side_by_side: true });
  await act(async () => app.router.navigate({ href: "/recipes" }));
  await waitFor(() =>
    expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/user/settings")).toBe(
      true,
    ),
  );
  expect(screen.queryByRole("table", { name: "Recipes" })).toBeNull();
  expect(app.writes).toEqual([]);
  expect(JSON.parse(String(app.settings["datatables_state_recipes-table"])).order).toEqual([
    [3, "desc"],
  ]);
  await act(async () => app.settingsGate.release());
  const list = await table();
  expect(names(list)).toEqual(["Zucchini stew", "Broth", "Apple tart"]);
  expect(
    within(list).getByRole("link", { name: "Zucchini stew" }).closest("tr")?.dataset.selected,
  ).toBe("true");
  expect(await screen.findByRole("heading", { level: 1, name: "Apple tart" })).toBeTruthy();
});

test("the additional generic recipe editor refreshes the native list and retains its saved edit after closing", async () => {
  const app = mountOverview();
  const user = userEvent.setup();
  await table();
  await user.click(screen.getByRole("button", { name: "Edit recipes" }));
  const manager = await screen.findByRole("region", { name: "Recipes" });
  const item = (await within(manager).findByRole("heading", { name: "Broth" })).closest("li")!;
  await user.click(within(item).getByRole("button", { name: /^Edit/ }));
  const form = screen.getByRole("form", { name: "Edit recipe" });
  const name = within(form).getByRole("textbox", { name: "Name" });
  await user.clear(name);
  await user.type(name, "Broth for dinner");
  const frame = await within(form).findByTitle<HTMLIFrameElement>("Description");
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: frame.contentWindow,
        data: {
          channel: "grocy-description",
          kind: "ready",
          html: "",
          empty: true,
          height: 390,
          fullscreen: false,
        },
      }),
    );
  });
  const save = within(form).getByRole<HTMLButtonElement>("button", { name: "Save recipe" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "Recipes" })).getByRole("link", {
        name: "Broth for dinner",
      }),
    ).toBeTruthy(),
  );
  expect(app.writes.filter((write) => write.method === "PUT")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Close editor" }));
  expect(
    within(screen.getByRole("table", { name: "Recipes" })).getByRole("link", {
      name: "Broth for dinner",
    }),
  ).toBeTruthy();
});
