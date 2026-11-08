import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type { RecipeFormContext, RecipeFormRecord } from "@/lib/recipe-form-context";
import type { JsonObject } from "@/lib/json";
import type { UserSettings } from "@/lib/types";
import { writeApiConfig } from "@/lib/config";
import { mountNativeEditor } from "./fixtures/native-editor";
import { pictureBytes } from "./fixtures/picture";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function uploadText(body: BodyInit | null | undefined) {
  if (!(body instanceof Blob)) throw new Error("Expected file upload bytes");

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(body);
  });
}

const recipe = {
  id: 7,
  name: "Rice dinner",
  description: "<p>Cook gently</p>",
  picture_file_name: "old.png",
  base_servings: 2.3456,
  desired_servings: 99,
  not_check_shoppinglist: 1,
  product_id: 2,
  type: "normal",
};

function context(): RecipeFormContext {
  return {
    recipe: { ...recipe },
    positions: [
      {
        id: 11,
        recipe_id: 7,
        product_id: 1,
        amount: 1500,
        qu_id: 2,
        only_check_single_unit_in_stock: 0,
        ingredient_group: "Pantry",
        note: "<em>Rinse first</em>",
        note_html: "<em>Rinse first</em>",
        not_check_stock_fulfillment: 0,
        variable_amount: null,
        price_factor: 1,
        round_up: 0,
      },
      {
        id: 12,
        recipe_id: 7,
        product_id: 2,
        amount: "bad",
        qu_id: 1,
        only_check_single_unit_in_stock: 0,
        ingredient_group: "Sauce",
        note: null,
        not_check_stock_fulfillment: 0,
        variable_amount: "to taste",
        price_factor: 1,
        round_up: 0,
      },
    ],
    nestings: [{ id: 30, recipe_id: 7, includes_recipe_id: 8, servings: 3 }],
    recipes: [
      { ...recipe, id: 8, name: "A sauce" },
      { ...recipe, id: 10, name: "Broth" },
      { ...recipe },
    ],
    products: [
      {
        id: 2,
        name: "Jar",
        active: 0,
        location_id: 1,
        qu_id_stock: 1,
        qu_id_purchase: 1,
        qu_id_consume: 1,
        qu_id_price: 1,
        not_check_stock_fulfillment_for_recipes: 0,
      },
      {
        id: 1,
        name: "Rice",
        active: 1,
        location_id: 1,
        qu_id_stock: 1,
        qu_id_purchase: 2,
        qu_id_consume: 1,
        qu_id_price: 1,
        not_check_stock_fulfillment_for_recipes: 0,
      },
    ],
    units: [
      { id: 1, name: "g", name_plural: "g", plural_forms: null, active: 1 },
      { id: 2, name: "kg", name_plural: "kg", plural_forms: null, active: 1 },
    ],
    conversions: [
      {
        id: 1,
        product_id: 1,
        from_qu_id: 1,
        to_qu_id: 2,
        from_qu_name: "g",
        from_qu_name_plural: "g",
        to_qu_name: "kg",
        to_qu_name_plural: "kg",
        factor: 0.001,
        path: "1/2",
      },
    ],
    fields: [
      {
        id: 1,
        entity: "recipes",
        name: "note",
        caption: "Owner note",
        type: "text-single-line",
        input_required: 0,
        default_value: null,
        config: null,
        sort_number: 1,
        show_as_column_in_tables: 0,
      },
    ],
    values: { note: "Stored owner note" },
  };
}

function preparation(kind: "ready" | "change", html = "<p>Cook gently</p>") {
  const frame = screen.getByTitle<HTMLIFrameElement>("Preparation");
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "null",
      source: frame.contentWindow,
      data: {
        channel: "grocy-description",
        kind,
        html,
        empty: !html,
        height: 390,
        fullscreen: false,
      },
    }),
  );
}

function mountRecipe(
  path = "/recipe/7",
  {
    failPrimary = false,
    holdPrimary = false,
    holdSettings = false,
    heldField = "",
    failField = "",
    failPicture = false,
    holdPicture = false,
    holdNesting = false,
    holdGrocycode = false,
    holdFileDelete = false,
    holdLabels = false,
    failLabelRead = false,
    failWebhook = false,
    basepath = "",
    imported = false,
    createIds = new Array<number>(),
    failPictureOnce = false,
    holdPartial = false,
  } = {},
) {
  const data = context();

  if (imported) data.recipe!.name = "Imported\rRecipe\nName";
  let createCount = 0;
  let pictureFailed = false;

  const labelReads: {
    signal: AbortSignal | null | undefined;
    gate: ReturnType<typeof deferred>;
  }[] = [];

  const printerRequests: RequestInit[] = [];
  const records = new Map<number, RecipeFormRecord>(data.recipes.map((row) => [row.id, row]));
  records.set(7, data.recipe!);
  const values = new Map<number, Record<string, string | null>>([[7, data.values]]);
  const calls: { path: string; method: string; body?: JsonObject; file?: BodyInit | null }[] = [];
  const signals: { path: string; method: string; signal?: AbortSignal | null }[] = [];
  const primary = deferred();
  const metadata = deferred();
  const partial = deferred();
  const fileDelete = deferred();
  const picture = deferred();
  const nesting = deferred();
  const settingsGate = deferred();
  const contextGate = deferred();
  const grocycodeGate = deferred();
  let contextHeld = false;
  let failingPrimary = failPrimary;
  let heldParent = holdPrimary;
  let reads = 0;
  const settings: UserSettings = { stock_decimal_places_amounts: 2 };
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const createObjectURL = vi.fn(() => `blob:recipe-${createObjectURL.mock.calls.length}`);
  const revokeObjectURL = vi.fn();
  onTestFinished(() => {
    messages.mockRestore();
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const seen = new WeakSet<HTMLIFrameElement>();

  const observer = new MutationObserver(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      'iframe[title="Preparation"]',
    )) {
      if (seen.has(frame)) continue;
      seen.add(frame);
      setTimeout(() => {
        if (frame.isConnected) preparation("ready");
      }, 0);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  onTestFinished(() => observer.disconnect());

  const app = mountNativeEditor(
    path,
    (url, init) => {
      if (url === "/api/objects/userfields?query[]=entity=recipes")
        return Response.json(data.fields);

      if (url.startsWith("/api/userfields/recipes/") && !init?.method)
        return Response.json(values.get(Number(url.split("/").at(-1))) ?? {});

      if (url === "/api/user/settings")
        return holdSettings
          ? settingsGate.promise.then(() => Response.json(settings))
          : Response.json(settings);

      if (url.startsWith("/api/user/settings/") && init?.method === "PUT") {
        settings[decodeURIComponent(url.split("/").at(-1)!)] = JSON.parse(String(init.body)).value;

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/user/settings/") && init?.method === "DELETE") {
        delete settings[decodeURIComponent(url.split("/").at(-1)!)];

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/recipes/editor" || url.startsWith("/api/v2/recipes/editor?")) {
        reads++;
        const id = new URL(url, "http://localhost").searchParams.get("recipe_id");

        if (id !== null && !records.has(Number(id)))
          return Response.json({ error_message: "Recipe missing" }, { status: 404 });

        const response = Response.json(
          id === null
            ? { ...data, recipe: null, positions: [], nestings: [], values: {} }
            : {
                ...data,
                recipe: records.get(Number(id)),
                positions: data.positions.filter((row) => row.recipe_id === Number(id)),
                nestings: data.nestings.filter((row) => row.recipe_id === Number(id)),
                values: values.get(Number(id)) ?? {},
              },
        );

        return contextHeld ? contextGate.promise.then(() => response) : response;
      }

      if (url === "/api/v2/content/recipes/editor" && init?.method === "POST")
        return new Response("<!doctype html><html><body>Preparation</body></html>");

      if (url === "/api/v2/recipes/overview") return Response.json([]);

      if (/^\/api\/v2\/recipes\/\d+\/view$/.test(url))
        return Response.json({
          recipe_id: 7,
          need_fulfilled: true,
          need_fulfilled_with_shopping_list: true,
          missing_products_count: 0,
          missing_ingredients: [],
          cards: [
            {
              id: 7,
              name: data.recipe?.name,
              desired_servings: 1,
              picture_file_name: null,
              preparation_html: "",
              costs: 0,
              calories: 0,
              prices_incomplete: false,
              need_fulfilled_with_shopping_list: true,
              ingredients: [],
            },
          ],
        });

      if (url === "/api/recipes/7/printlabel") {
        const gate = deferred();
        const requestNumber = labelReads.length + 1;
        labelReads.push({ signal: init?.signal, gate });

        return (async () => {
          if (holdLabels) await gate.promise;

          return failLabelRead
            ? Response.json({ error_message: "private recipe label failure" }, { status: 503 })
            : Response.json({ recipe_id: 7, recipe_name: "Rice dinner", request: requestNumber });
        })();
      }

      if (url === "https://printer.test/recipe") {
        printerRequests.push(init ?? {});

        return failWebhook
          ? new Response("private printer failure", { status: 503 })
          : new Response(null, { status: 204 });
      }

      if (/^\/(?:api\/v2\/recipes|recipe)\/\d+\/grocycode/.test(url)) {
        const response = () =>
          new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

        return holdGrocycode ? grocycodeGate.promise.then(response) : response();
      }

      if (url.startsWith("/api/files/recipepictures/")) {
        if (!init?.method || init.method === "GET")
          return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });
        calls.push({ path: url, method: init.method, file: init.body });
        signals.push({ path: url, method: init.method, signal: init.signal });

        return (async () => {
          if (holdPicture) await picture.promise;

          const failing = failPicture || (failPictureOnce && !pictureFailed);
          pictureFailed = true;

          return failing
            ? Response.json({ error_message: "Picture failed" }, { status: 503 })
            : new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/files/userfiles/") && init?.method) {
        calls.push({ path: url, method: init.method, file: init.body });
        signals.push({ path: url, method: init.method, signal: init.signal });

        return (async () => {
          if (holdFileDelete && init.method === "DELETE") await fileDelete.promise;

          return new Response(null, { status: 204 });
        })();
      }

      if (
        (url === "/api/objects/recipes" && init?.method === "POST") ||
        (/^\/api\/objects\/recipes\/\d+$/.test(url) && init?.method === "PUT")
      ) {
        const body: JsonObject = JSON.parse(String(init.body));
        calls.push({ path: url, method: init.method!, body });
        signals.push({ path: url, method: init.method!, signal: init.signal });

        return (async () => {
          if (heldParent) await primary.promise;

          if (holdPartial && Object.keys(body).length === 0) await partial.promise;

          if (failingPrimary)
            return Response.json({ error_message: "Recipe write denied" }, { status: 403 });

          const id =
            init.method === "POST"
              ? (createIds[createCount++] ?? 9)
              : Number(url.split("/").at(-1));

          const target = records.get(id) ?? {
            ...recipe,
            id,
            name: "",
            description: null,
            product_id: null,
            picture_file_name: null,
            base_servings: 1,
            desired_servings: 1,
            not_check_shoppinglist: 0,
          };

          Object.assign(target, body);

          if (Object.hasOwn(body, "product_id"))
            target.product_id = body.product_id === "" ? null : Number(body.product_id);

          if (Object.hasOwn(body, "not_check_shoppinglist"))
            target.not_check_shoppinglist = Number(body.not_check_shoppinglist);
          records.set(id, target);

          return init.method === "POST"
            ? Response.json({ created_object_id: String(id) })
            : new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/userfields/recipes/") && init?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(init.body));
        calls.push({ path: url, method: "PUT", body });
        signals.push({ path: url, method: "PUT", signal: init.signal });
        const fieldName = Object.keys(body)[0]!;

        return (async () => {
          if (fieldName === heldField) await metadata.promise;

          if (fieldName === failField)
            return Response.json({ error_message: "Recipe field failed" }, { status: 503 });
          const id = Number(url.split("/").at(-1));
          const saved = values.get(id) ?? {};
          Object.assign(saved, body);
          values.set(id, saved);

          return new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/objects/recipes_pos/") && init?.method === "DELETE") {
        calls.push({ path: url, method: "DELETE" });
        data.positions = data.positions.filter((row) => row.id !== Number(url.split("/").at(-1)));

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/objects/recipes_nestings") && init?.method) {
        const body: JsonObject = init.body ? JSON.parse(String(init.body)) : {};
        calls.push({ path: url, method: init.method, body });

        return (async () => {
          if (holdNesting) await nesting.promise;

          if (init.method === "DELETE")
            data.nestings = data.nestings.filter((row) => row.id !== Number(url.split("/").at(-1)));
          else if (init.method === "POST")
            data.nestings.push({
              id: 31,
              recipe_id: Number(body.recipe_id),
              includes_recipe_id: Number(body.includes_recipe_id),
              servings: String(body.servings),
            });
          else {
            const row = data.nestings.find((row) => row.id === Number(url.split("/").at(-1)))!;
            Object.assign(row, body);
            row.recipe_id = Number(body.recipe_id);
            row.includes_recipe_id = Number(body.includes_recipe_id);
          }

          return init.method === "POST"
            ? Response.json({ created_object_id: "31" })
            : new Response(null, { status: 204 });
        })();
      }

      return undefined;
    },
    {
      FEATURE_FLAG_RECIPES: true,
      FEATURE_FLAG_STOCK: false,
      FEATURE_FLAG_SHOPPINGLIST: false,
      FEATURE_FLAG_LABEL_PRINTER: true,
      LABEL_PRINTER_RUN_SERVER: false,
      LABEL_PRINTER_WEBHOOK: "https://printer.test/recipe",
      LABEL_PRINTER_HOOK_JSON: true,
      LABEL_PRINTER_PARAMS: { station: "Kitchen" },
    },
    { basepath: basepath || undefined },
  );

  return {
    ...app,
    data,
    calls,
    signals,
    primary,
    metadata,
    partial,
    fileDelete,
    picture,
    nesting,
    settingsGate,
    contextGate,
    grocycodeGate,
    labelReads,
    printerRequests,
    createObjectURL,
    revokeObjectURL,
    settings,
    messages,
    get reads() {
      return reads;
    },
    holdContext: () => {
      contextHeld = true;
    },
    allowPrimary: () => {
      failingPrimary = false;
      heldParent = false;
    },
    deliverChanged: () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { Message: "IngredientsChanged", Payload: null },
        }),
      );
    },
  };
}

test("selected native recipe loads precise servings, all produced-product choices, preparation and ingredients", async () => {
  const app = mountRecipe();
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("Rice dinner");
  expect(screen.getByLabelText<HTMLInputElement>("Servings").value).toBe("2.35");
  expect(screen.getByLabelText<HTMLInputElement>("Produces product").value).toBe("Jar");
  expect(screen.getByLabelText<HTMLInputElement>("Owner note").value).toBe("Stored owner note");
  expect(screen.queryByLabelText("Desired servings")).toBeNull();
  await screen.findByTitle("Preparation");
  await screen.findByRole("table", { name: "Ingredients list" });
  expect(app.calls).toEqual([]);
});

test("selected recipe displays an authenticated 60px Grocycode and releases its preview on departure", async () => {
  writeApiConfig({ baseUrl: "", apiKey: "recipe-preview-key" });
  const app = mountRecipe("/house.hold/index.php/recipe/7", { basepath: "/house.hold/index.php" });
  const image = await screen.findByRole<HTMLImageElement>("img", { name: "Recipe Grocycode" });

  const request = app.fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/recipe/7/grocycode?size=60"),
  );

  expect(request).toBeDefined();
  expect(new Headers(request![1]?.headers).get("GROCY-API-KEY")).toBe("recipe-preview-key");
  expect(image.src).toMatch(/^blob:recipe-/);
  expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
    "/house.hold/index.php/recipe/7/grocycode?download=true",
  );
  const preview = image.src;
  expect(app.revokeObjectURL).not.toHaveBeenCalledWith(preview);
  await act(async () => app.router.navigate({ href: "/recipe/new" }));
  await screen.findByRole("heading", { name: "Create recipe" });
  await waitFor(() => expect(app.revokeObjectURL).toHaveBeenCalledWith(preview));
  expect(screen.queryByRole("img", { name: "Recipe Grocycode" })).toBeNull();
  expect(
    app.fetchMock.mock.calls.some(([url]) => String(url).includes("/recipes/new/grocycode")),
  ).toBe(false);
});

test("a Grocycode response released after recipe departure cannot allocate a preview URL", async () => {
  const app = mountRecipe("/recipe/7", { holdGrocycode: true });
  await screen.findByLabelText("Name");
  await waitFor(() =>
    expect(
      app.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/grocycode?size=60")),
    ).toBe(true),
  );

  const request = app.fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/grocycode?size=60"),
  )!;

  await act(async () => app.router.navigate({ href: "/recipe/new" }));
  await screen.findByRole("heading", { name: "Create recipe" });
  expect(request[1]?.signal?.aborted).toBe(true);
  const allocations = app.createObjectURL.mock.calls.length;
  await act(async () => {
    app.grocycodeGate.release();
    await app.grocycodeGate.promise;
  });
  expect(app.createObjectURL).toHaveBeenCalledTimes(allocations);
  expect(screen.queryByRole("img", { name: "Recipe Grocycode" })).toBeNull();
});

async function recipePrintAction() {
  await screen.findByLabelText("Name");

  return screen.getByText(/^Print (?:Recipe Grocycode )?on label printer$/);
}

test("recipe print requests remain independent while the current form draft stays usable", async () => {
  const app = mountRecipe("/recipe/7", { holdLabels: true });
  const print = await recipePrintAction();
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  await userEvent.clear(name);
  await userEvent.type(name, "Unfinished dinner");
  await userEvent.click(print);
  await waitFor(() => expect(app.labelReads).toHaveLength(1));
  await userEvent.click(print);
  await waitFor(() => expect(app.labelReads).toHaveLength(2));
  await userEvent.type(name, " draft");
  expect(name.value).toBe("Unfinished dinner draft");
  expect(name.disabled).toBe(false);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
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
      body: { recipe_id: 7, recipe_name: "Rice dinner", request: 2, station: "Kitchen" },
    },
    {
      method: "POST",
      type: "application/json",
      body: { recipe_id: 7, recipe_name: "Rice dinner", request: 1, station: "Kitchen" },
    },
  ]);
  expect(app.calls).toEqual([]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Label request sent")).toBeNull();
  expect(name.value).toBe("Unfinished dinner draft");
});

for (const stage of ["label read", "webhook"] as const) {
  test(`recipe ${stage} failure preserves the native error destination and editable draft`, async () => {
    const app = mountRecipe("/recipe/7", {
      failLabelRead: stage === "label read",
      failWebhook: stage === "webhook",
    });

    const print = await recipePrintAction();
    await userEvent.type(screen.getByLabelText("Name"), " unsaved");
    await userEvent.click(print);
    await waitFor(() => expect(app.labelReads).toHaveLength(1));

    if (stage === "webhook") {
      expect(await screen.findByText("Error while executing WebHook")).toBeTruthy();
      expect(app.printerRequests).toHaveLength(1);
      await userEvent.click(
        screen.getByRole("button", { name: /Click to show technical details/ }),
      );
      expect(screen.getByText("undefined")).toBeTruthy();
    } else {
      await act(async () => {});
      expect(app.printerRequests).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
    }

    expect(screen.queryByText(/private (recipe label|printer) failure/)).toBeNull();
    expect(screen.queryByText("Label request sent")).toBeNull();
    const name = screen.getByLabelText<HTMLInputElement>("Name");
    await userEvent.type(name, " retained");
    expect(name.value).toBe("Rice dinner unsaved retained");
    expect(app.calls).toEqual([]);
  });
}

test("a retired recipe cannot dispatch a printer webhook when its held label response completes", async () => {
  const app = mountRecipe("/recipe/7", { holdLabels: true });
  await userEvent.click(await recipePrintAction());
  await waitFor(() => expect(app.labelReads).toHaveLength(1));
  await act(async () => app.router.navigate({ href: "/recipe/new" }));
  await screen.findByRole("heading", { name: "Create recipe" });
  await act(async () => app.labelReads[0]!.gate.release());
  expect(app.printerRequests).toEqual([]);
  expect(screen.queryByText("Label request sent")).toBeNull();
  expect(screen.queryByText("Error while executing WebHook")).toBeNull();
  expect(app.labelReads[0]!.signal?.aborted).toBe(true);
});

test("cached amount precision cannot initialize recipe servings before the fresh settings read finishes", async () => {
  const app = mountRecipe("/settings?tab=connection", { holdSettings: true });
  app.client.setQueryData(["user", "settings"], { stock_decimal_places_amounts: 1 });
  await act(async () => {
    await app.router.navigate({ href: "/recipe/7" });
  });
  await waitFor(() =>
    expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/user/settings")).toBe(
      true,
    ),
  );
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(app.calls).toEqual([]);
  await act(async () => app.settingsGate.release());
  expect((await screen.findByLabelText<HTMLInputElement>("Servings")).value).toBe("2.35");
});

test.each([
  { path: "/recipe/new?product-name=", clear: false, expected: "" },
  { path: "/recipe/7?product-name=", clear: true, expected: "" },
  { path: "/recipe/new?product=1&product=2", clear: false, expected: "Rice" },
  { path: "/recipe/new?product-name=Ric", clear: false, expected: "Rice" },
  { path: "/recipe/7?product=1", clear: false, expected: "Jar" },
])(
  "native produced-product prefill preserves record precedence and empty query behavior: $path",
  async ({ path, clear, expected }) => {
    const app = mountRecipe(path);

    if (clear && app.data.recipe) app.data.recipe.product_id = null;
    await screen.findByLabelText("Name");
    expect(screen.getByLabelText<HTMLInputElement>("Produces product").value).toBe(expected);
    expect(app.calls).toEqual([]);
  },
);

async function saveButton(label = "Save & continue") {
  const button = await screen.findByRole<HTMLButtonElement>("button", { name: label });
  await waitFor(() => expect(button.disabled).toBe(false));

  return button;
}

test("create saves only native parent fields and continues to the selected editor despite embedded", async () => {
  const app = mountRecipe("/recipe/new?embedded=0&product=1");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "New soup");
  expect(screen.getByLabelText<HTMLInputElement>("Servings").value).toBe("1");
  expect(screen.getByLabelText<HTMLInputElement>("Produces product").value).toBe("Rice");
  expect(screen.queryByRole("table", { name: "Ingredients list" })).toBeNull();
  await act(async () => preparation("change", "<p>Simmer</p>"));
  await user.click(await saveButton());
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/recipe/9"));
  expect(app.calls[0]).toEqual({
    path: "/api/objects/recipes",
    method: "POST",
    body: {
      name: "New soup",
      base_servings: "1",
      not_check_shoppinglist: "0",
      product_id: "1",
      description: "<p>Simmer</p>",
    },
  });
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  await screen.findByRole("table", { name: "Ingredients list" });
});

test.each(["create", "edit"])(
  "native %s primary failure preserves its distinct busy and error behavior",
  async (mode) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = mountRecipe(mode === "create" ? "/recipe/new" : "/recipe/7?embedded", {
      failPrimary: true,
    });

    const user = userEvent.setup();
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    await user.clear(name);
    await user.type(name, "Kept draft");
    await user.click(await saveButton());
    await waitFor(() => expect(app.calls).toHaveLength(1));

    if (mode === "edit") {
      await waitFor(() => expect(name.matches(":disabled")).toBe(false));
      expect(log).toHaveBeenCalledTimes(1);
      expect(document.body.classList.contains("cursor-busy")).toBe(false);
      app.allowPrimary();
      await user.click(await saveButton("Save & return to recipes"));
      await waitFor(() => expect(app.router.state.location.pathname).toBe("/recipes"));
      expect(new URLSearchParams(app.router.history.location.search).get("recipe")).toBe("7");
    } else {
      await user.type(name, " ignored");
      expect(name.value).toBe("Kept draft");
      expect(name.matches(":disabled")).toBe(true);
      expect(document.body.classList.contains("cursor-busy")).toBe(true);
      expect(log).not.toHaveBeenCalled();
    }

    expect(
      screen.queryByRole("button", {
        name: /Error while saving, probably this item already exists/,
      }),
    ).toBeNull();
    expect(app.calls.every((call) => call.path.startsWith("/api/objects/recipes"))).toBe(true);
  },
);

test("Enter in the parent input remains ineffective instead of clicking either save action", async () => {
  const app = mountRecipe();
  const user = userEvent.setup();
  await saveButton();
  await user.click(await screen.findByLabelText("Name"));
  await user.keyboard("{Enter}");
  expect(app.calls).toEqual([]);
});

test("parent, parallel final-field callback and live picture bytes follow native save staging", async () => {
  const app = mountRecipe("/recipe/7", { holdPrimary: true, heldField: "note", holdPicture: true });
  app.data.fields.push({
    ...app.data.fields[0]!,
    id: 2,
    name: "last",
    caption: "Last field",
    sort_number: 2,
  });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " changed");
  await user.type(screen.getByLabelText("Owner note"), " changed");
  await user.type(screen.getByLabelText("Last field"), "Last");
  const first = new File([pictureBytes], "First.PNG", { type: "image/png" });
  const second = new File([pictureBytes], "Second.PNG", { type: "image/png" });
  await user.upload(screen.getByLabelText("Picture", { selector: "input" }), first);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  await user.click(await saveButton());
  await waitFor(() => expect(app.calls).toHaveLength(1));
  const filename = String(app.calls[0]?.body?.picture_file_name);
  expect(filename).toBe("iifirst.png");
  expect(screen.getByLabelText<HTMLInputElement>("Picture", { selector: "input" }).disabled).toBe(
    false,
  );
  await user.upload(screen.getByLabelText("Picture", { selector: "input" }), second);
  await act(async () => app.primary.release());
  await waitFor(() =>
    expect(app.calls.filter((call) => call.path.startsWith("/api/userfields/"))).toHaveLength(2),
  );
  await waitFor(() =>
    expect(app.calls.some((call) => call.path.startsWith("/api/files/recipepictures/"))).toBe(true),
  );
  expect(app.calls.at(-1)).toEqual({
    path: `/api/files/recipepictures/${encodeURIComponent(btoa(filename))}`,
    method: "PUT",
    file: second,
  });
  expect(app.router.state.location.pathname).toBe("/recipe/7");
  await act(async () => app.picture.release());
  await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe(
    "Rice dinner changed",
  );
  expect(app.calls[0]?.body).not.toHaveProperty("desired_servings");
  await act(async () => app.metadata.release());
});

test.each(["metadata", "deletion"])(
  "custom file upload reads the live selection after held %s and independent picture failure unlocks the form",
  async (stage) => {
    const app = mountRecipe("/recipe/7", {
      holdPicture: true,
      failPicture: true,
      heldField: stage === "metadata" ? "attachment" : "",
      holdFileDelete: stage === "deletion",
    });

    app.data.fields.push({
      ...app.data.fields[0]!,
      id: 2,
      name: "attachment",
      caption: "Attachment",
      type: "file",
      sort_number: 2,
    });

    if (stage === "deletion") app.data.values.attachment = `${btoa("old.txt")}_${btoa("old.txt")}`;

    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("Attachment");
    const first = new File(["first bytes"], "first.txt", { type: "text/plain" });
    const second = new File(["second bytes"], "second.txt", { type: "text/plain" });
    await user.upload(input, first);

    if (stage === "deletion")
      await user.click(within(input.closest(".field")!).getByRole("button", { name: "Delete" }));

    await user.click(screen.getByRole("button", { name: "Delete picture" }));
    await user.click(await saveButton());
    await waitFor(() =>
      expect(app.calls.some((call) => call.path === "/api/userfields/recipes/7")).toBe(true),
    );
    const metadata = app.calls.find((call) => call.path === "/api/userfields/recipes/7")!;
    const savedName = atob(String(metadata.body?.attachment).split("_")[0]!);

    if (stage === "deletion")
      await waitFor(() =>
        expect(
          app.calls.some((call) => call.path === "/api/files/userfiles/b2xkLnR4dA%3D%3D"),
        ).toBe(true),
      );

    await act(async () => app.picture.release());
    await waitFor(() => expect(input.matches(":disabled")).toBe(false));
    await user.upload(input, second);
    await act(async () => {
      app.metadata.release();
      app.fileDelete.release();
    });

    const upload = await waitFor(() => {
      const call = app.calls.find(
        (call) => call.path === `/api/files/userfiles/${encodeURIComponent(btoa(savedName))}`,
      );

      expect(call).toBeTruthy();

      return call!.file;
    });

    expect(await uploadText(upload)).toBe("second bytes");
    expect(metadata.body?.attachment).toBe(`${btoa(savedName)}_${btoa("first.txt")}`);
    await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  },
);

test("picture deletion is independent of the primary save and a failed upload ends native busy mode", async () => {
  const app = mountRecipe("/recipe/7", { holdPicture: true });
  const user = userEvent.setup();
  await saveButton();
  await user.click(screen.getByRole("button", { name: "Delete picture" }));
  await user.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  expect(app.calls.slice(0, 2).map((call) => [call.method, call.path])).toEqual([
    ["DELETE", "/api/files/recipepictures/b2xkLnBuZw%3D%3D"],
    ["PUT", "/api/objects/recipes/7"],
  ]);
  expect(app.calls[1]?.body?.picture_file_name).toBeNull();
  const keys = warmRecipeReads(app);
  expect(app.signals[0]!.signal?.aborted).toBe(true);
  await act(async () => app.picture.release());

  for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
});

test("picture-upload failure exposes details and restores the edited draft without navigating", async () => {
  const app = mountRecipe("/recipe/7", { failPicture: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " draft");
  await user.upload(
    screen.getByLabelText("Picture", { selector: "input" }),
    new File([pictureBytes], "new.png", { type: "image/png" }),
  );
  await user.click(await saveButton());
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  const details = await screen.findByRole("dialog", { name: "Error details" });
  expect(within(details).getByText(/Picture failed/)).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Rice dinner draft");
  expect(screen.getByLabelText<HTMLInputElement>("Name").matches(":disabled")).toBe(false);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(app.reads).toBe(1);
});

test("IngredientsChanged saves current serialized parent values, discards child drafts and excludes field or picture writes", async () => {
  const app = mountRecipe();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " current");
  await user.type(screen.getByLabelText("Owner note"), " unsaved");
  await user.upload(
    screen.getByLabelText("Picture", { selector: "input" }),
    new File([pictureBytes], "pending.png", { type: "image/png" }),
  );
  await act(async () => preparation("change", "<p>Current preparation</p>"));
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://foreign.example",
        data: { Message: "IngredientsChanged", Payload: null },
      }),
    );
  });
  expect(app.calls).toEqual([]);
  await act(async () => app.deliverChanged());
  await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  expect(app.calls).toEqual([
    {
      path: "/api/objects/recipes/7",
      method: "PUT",
      body: {
        name: "Rice dinner current",
        base_servings: "2.35",
        not_check_shoppinglist: "1",
        product_id: "2",
        description: "<p>Current preparation</p>",
      },
    },
  ]);
  expect((await screen.findByLabelText<HTMLInputElement>("Owner note")).value).toBe(
    "Stored owner note",
  );
  expect(
    screen.getByLabelText<HTMLInputElement>("Picture", { selector: "input" }).files,
  ).toHaveLength(0);
});

test("busy parent serialization is empty and held callbacks cannot affect a departed owner", async () => {
  const app = mountRecipe("/recipe/7", { holdPrimary: true, holdPartial: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Owner note"), " pending");
  await user.upload(
    screen.getByLabelText("Picture", { selector: "input" }),
    new File([pictureBytes], "pending.png", { type: "image/png" }),
  );
  await user.click(await saveButton());
  await waitFor(() => expect(app.calls).toHaveLength(1));
  await act(async () => app.deliverChanged());
  await waitFor(() => expect(app.calls).toHaveLength(2));
  expect(app.calls[1]?.body).toEqual({});
  await act(async () => {
    await app.router.navigate({ href: "/recipe/new" });
  });
  const keys = warmRecipeReads(app);
  expect(app.signals.every((request) => request.signal?.aborted)).toBe(true);
  await act(async () => app.primary.release());

  for (const key of keys) expect.soft(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  const afterPrimary = warmRecipeReads(app);
  await act(async () => app.partial.release());

  for (const key of afterPrimary) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(app.calls).toHaveLength(2);
  expect(app.router.state.location.pathname).toBe("/recipe/new");
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
});

test("native ingredient table renders grouped amount text, inactive products, notes and exact embedded URLs", async () => {
  const app = mountRecipe();
  app.data.positions[0]!.amount = 1500000;
  const user = userEvent.setup();
  const table = await screen.findByRole("table", { name: "Ingredients list" });
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((row) => row.textContent),
  ).toEqual(["Rice", "Jar"]);
  expect(within(table).getByText("1,500 kg")).toBeTruthy();
  expect(within(table).getByText("to taste g")).toBeTruthy();
  expect(within(table).getByText("Variable amount")).toBeTruthy();
  const rice = within(table).getByRole("rowheader", { name: "Rice" }).closest("tr")!;
  expect(within(rice).getByRole("link", { name: "Edit this item" }).getAttribute("href")).toBe(
    "/recipe/7/pos/11?embedded&product=1",
  );
  await user.click(within(rice).getByRole("button", { name: "Show notes" }));
  const note = await screen.findByRole("dialog", { name: "Show notes" });
  expect(within(note).getByText("Rinse first").tagName).toBe("EM");
  await user.click(within(note).getByRole("button", { name: "OK" }));
  const region = screen.getByRole("region", { name: "Ingredients list" });
  const add = within(region).getByRole("link", { name: "Add" });
  expect(add.getAttribute("href")).toBe("/recipe/7/pos/new?embedded");
  await user.click(add);
  const frame = await screen.findByTitle<HTMLIFrameElement>("Recipe ingredient");
  expect(new URL(frame.src).pathname + new URL(frame.src).search).toBe(
    "/recipe/7/pos/new?embedded",
  );
  expect(app.calls).toEqual([]);
  await user.click(
    within(screen.getByRole("dialog", { name: "Recipe ingredient" })).getByRole("button", {
      name: "Close",
    }),
  );
  await user.click(within(rice).getByRole("link", { name: "Edit this item" }));
  expect(new URL(screen.getByTitle<HTMLIFrameElement>("Recipe ingredient").src).pathname).toBe(
    "/recipe/7/pos/11",
  );
});

test("explicit disabled ingredient grouping persists and reset restores native defaults while discarding the draft", async () => {
  const app = mountRecipe();
  const user = userEvent.setup();
  let table = await screen.findByRole("table", { name: "Ingredients list" });
  await user.click(within(table).getByRole("button", { name: "Pantry" }));
  expect(within(table).queryByRole("rowheader", { name: "Rice" })).toBeNull();
  await user.click(within(table).getByRole("button", { name: "Pantry" }));
  await user.click(within(table).getByRole("button", { name: "Table options" }));
  let options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("radio", { name: "None" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((row) => row.textContent),
  ).toEqual(["Jar", "Rice"]);
  await waitFor(() =>
    expect(app.settings["datatables_rowGroup_recipes-pos-table"]).toBe('{"enable":false}'),
  );
  await act(async () => {
    await app.router.navigate({ href: "/settings?tab=connection" });
    await app.router.navigate({ href: "/recipe/7" });
  });
  table = await screen.findByRole("table", { name: "Ingredients list" });
  expect(within(table).queryByRole("button", { name: "Pantry" })).toBeNull();
  await user.type(screen.getByLabelText("Name"), " unsaved");
  await user.click(within(table).getByRole("button", { name: "Table options" }));
  options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("button", { name: "Reset" }));

  const confirm = screen.getByRole("dialog", {
    name: "Are you sure you want to reset the table options?",
  });

  await user.click(within(confirm).getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(app.settings["datatables_rowGroup_recipes-pos-table"]).toBeUndefined(),
  );
  await screen.findByRole("button", { name: "Pantry" });
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Rice dinner");
  expect(app.calls).toEqual([]);
});

test("ingredient deletion confirms the exact ID before native IngredientsChanged saves the latest parent and reloads", async () => {
  const app = mountRecipe();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " latest");
  let table = screen.getByRole("table", { name: "Ingredients list" });
  const row = within(table).getByRole("rowheader", { name: "Rice" }).closest("tr")!;
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  let confirm = screen.getByRole("dialog", { name: "Delete this item" });
  await user.click(within(confirm).getByRole("button", { name: "No" }));
  expect(app.calls).toEqual([]);
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  confirm = screen.getByRole("dialog", { name: "Delete this item" });
  await user.click(within(confirm).getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "IngredientsChanged", Payload: null },
      window.location.origin,
    ),
  );
  expect(app.calls).toEqual([{ path: "/api/objects/recipes_pos/11", method: "DELETE" }]);
  expect(within(table).getByRole("rowheader", { name: "Rice" })).toBeTruthy();
  await act(async () => app.deliverChanged());
  await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  table = await screen.findByRole("table", { name: "Ingredients list" });
  expect(within(table).queryByRole("rowheader", { name: "Rice" })).toBeNull();
  expect(app.calls[1]?.body?.name).toBe("Rice dinner latest");
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "CloseLastModal", Payload: null },
    window.location.origin,
  );
});

test("included-recipe Add waits for an unvalidated parent partial PUT and retains servings across Cancel and Add", async () => {
  const app = mountRecipe("/recipe/7", { holdPrimary: true });
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await user.clear(name);
  expect(name.validity.valueMissing).toBe(true);
  const region = screen.getByRole("region", { name: "Included recipes" });
  await user.click(within(region).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  expect(app.calls[0]?.body?.name).toBe("");
  expect(screen.queryByRole("dialog", { name: "Add included recipe" })).toBeNull();
  await act(async () => app.primary.release());
  let dialog = await screen.findByRole("dialog", { name: "Add included recipe" });
  await user.click(within(dialog).getByRole("button", { name: "Recipes" }));
  expect(within(dialog).getByRole("option", { name: "Rice dinner" })).toBeTruthy();
  await user.click(within(dialog).getByRole("option", { name: "Broth" }));
  await user.clear(within(dialog).getByLabelText("Servings"));
  await user.type(within(dialog).getByLabelText("Servings"), "4.5");
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(within(region).getByRole("button", { name: "Add" }));
  dialog = await screen.findByRole("dialog", { name: "Add included recipe" });
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe("");
  expect(within(dialog).getByLabelText<HTMLInputElement>("Servings").value).toBe("4.5");
  expect(app.calls.map((call) => call.path)).toEqual([
    "/api/objects/recipes/7",
    "/api/objects/recipes/7",
  ]);
});

test("included-recipe edit writes its exact nesting then reloads through current parent serialization", async () => {
  const app = mountRecipe();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " draft");
  const region = screen.getByRole("region", { name: "Included recipes" });
  await user.click(within(region).getByRole("button", { name: "Edit this item" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit included recipe" });
  expect(within(dialog).getByRole<HTMLInputElement>("combobox", { name: "Recipe" }).value).toBe(
    "A sauce",
  );
  expect(within(dialog).getByLabelText<HTMLInputElement>("Servings").value).toBe("3");
  await user.clear(within(dialog).getByLabelText("Servings"));
  await user.type(within(dialog).getByLabelText("Servings"), "2.5");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "IngredientsChanged", Payload: null },
      window.location.origin,
    ),
  );
  expect(app.calls[1]).toEqual({
    path: "/api/objects/recipes_nestings/30",
    method: "PUT",
    body: { recipe_id: 7, includes_recipe_id: "8", servings: "2.5" },
  });
  expect(screen.getByRole("dialog", { name: "Edit included recipe" })).toBeTruthy();
  await act(async () => app.deliverChanged());
  await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  expect(screen.queryByRole("dialog", { name: "Edit included recipe" })).toBeNull();
  expect(app.calls[2]?.path).toBe("/api/objects/recipes/7");
  expect(app.calls[2]?.body?.name).toBe("Rice dinner draft");
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "CloseLastModal", Payload: null },
    window.location.origin,
  );
});

test.each(["cancel", "departure"])(
  "pending nesting save preserves native callback lifetime through %s",
  async (outcome) => {
    const app = mountRecipe("/recipe/7", { holdNesting: true });
    const user = userEvent.setup();
    await screen.findByLabelText("Name");
    const region = screen.getByRole("region", { name: "Included recipes" });
    await user.click(within(region).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add included recipe" });
    await user.type(within(dialog).getByRole("combobox", { name: "Recipe" }), "Broth");
    await user.click(within(dialog).getByRole("option", { name: "Broth" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.calls.some((call) => call.path === "/api/objects/recipes_nestings")).toBe(true),
    );

    if (outcome === "cancel") {
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await user.click(within(region).getByRole("button", { name: "Add" }));
      await screen.findByRole("dialog", { name: "Add included recipe" });
    } else
      await act(async () => {
        await app.router.navigate({ href: "/settings?tab=connection" });
      });
    await act(async () => app.nesting.release());

    if (outcome === "cancel") {
      await waitFor(() =>
        expect(app.messages).toHaveBeenCalledWith(
          { Message: "IngredientsChanged", Payload: null },
          window.location.origin,
        ),
      );
      await act(async () => app.deliverChanged());
      await waitFor(() => expect(app.reads).toBeGreaterThan(1));
      expect(screen.queryByRole("dialog", { name: "Add included recipe" })).toBeNull();
    } else {
      expect(app.router.state.location.pathname).toBe("/settings");
      expect(app.messages).not.toHaveBeenCalledWith(
        { Message: "IngredientsChanged", Payload: null },
        window.location.origin,
      );
    }
  },
);

test("included-recipe deletion closes confirmation immediately and reloads only after its native receipt", async () => {
  const app = mountRecipe("/recipe/7", { holdNesting: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " latest");
  const region = screen.getByRole("region", { name: "Included recipes" });
  await user.click(within(region).getByRole("button", { name: "Delete this item" }));
  let confirm = screen.getByRole("dialog", { name: "Delete this item" });
  await user.click(within(confirm).getByRole("button", { name: "No" }));
  expect(app.calls).toEqual([]);
  await user.click(within(region).getByRole("button", { name: "Delete this item" }));
  confirm = screen.getByRole("dialog", { name: "Delete this item" });
  await user.click(within(confirm).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  expect(app.calls[0]?.path).toBe("/api/objects/recipes_nestings/30");
  expect(app.calls[0]?.method).toBe("DELETE");
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "IngredientsChanged", Payload: null },
    window.location.origin,
  );
  await act(async () => app.nesting.release());
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "IngredientsChanged", Payload: null },
      window.location.origin,
    ),
  );
  await act(async () => app.deliverChanged());
  await waitFor(() => expect(app.reads).toBeGreaterThan(1));
  const reloaded = await screen.findByRole("region", { name: "Included recipes" });
  expect(within(reloaded).queryByRole("rowheader", { name: "A sauce" })).toBeNull();
  expect(app.calls[1]?.body?.name).toBe("Rice dinner latest");
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "CloseLastModal", Payload: null },
    window.location.origin,
  );
});

function warmRecipeReads(app: ReturnType<typeof mountRecipe>) {
  const values = [
    { key: ["objects", "recipes"], value: [app.data.recipe] },
    {
      key: ["native-calendar"],
      value: { events: [], user_settings: {}, config: {}, locale: "en" },
    },
    {
      key: ["recipe-fulfillment", 7],
      value: {
        recipe_id: 7,
        need_fulfilled: true,
        need_fulfilled_with_shopping_list: true,
        missing_products_count: 0,
        positions: [],
      },
    },
    { key: ["content", "recipes", 7], value: { html: "<p>Fresh recipe preparation</p>" } },
  ];

  for (const { key, value } of values) {
    app.client.setQueryData(key, value);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  return values.map(({ key }) => key);
}

test("Recipe unchanged Arrow is native dirty and imported Name/rich Preparation serialize independently from LF metadata", async () => {
  const app = mountRecipe("/recipe/7", { imported: true });
  app.data.fields[0]!.type = "text-multi-line";
  app.data.fields.push({
    ...app.data.fields[0]!,
    id: 2,
    name: "clean",
    caption: "Clean recipe note",
  });
  app.data.values.note = "Stored line1\nStored line2";
  app.data.values.clean = "Untouched note";
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("ImportedRecipeName");
  await saveButton();
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Owner note"));
  await user.keyboard("{ArrowLeft}");
  await act(async () => preparation("change", "<p>Line one</p>\n<p><strong>Line two</strong></p>"));
  await user.click(await saveButton("Save & return to recipes"));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/recipes"));
  expect(app.calls).toEqual([
    {
      path: "/api/objects/recipes/7",
      method: "PUT",
      body: {
        name: "ImportedRecipeName",
        base_servings: "2.35",
        not_check_shoppinglist: "1",
        product_id: "2",
        description: "<p>Line one</p>\r\n<p><strong>Line two</strong></p>",
      },
    },
    {
      path: "/api/userfields/recipes/7",
      method: "PUT",
      body: { note: "Stored line1\nStored line2" },
    },
  ]);
});

test("Recipe common Save stage reads a controlled disabled DOM change only after primary response", async () => {
  const app = mountRecipe("/recipe/new", { holdPrimary: true });
  await userEvent.type(await screen.findByLabelText("Name"), "Phase-probe recipe");
  const note = screen.getByLabelText<HTMLInputElement>("Owner note");
  await userEvent.type(note, "Before primary");
  await userEvent.click(await saveButton("Save & return to recipes"));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  expect(note.matches(":disabled")).toBe(true);
  // Controlled source-stage timing proof, not a claim that users can type through native busy controls.
  note.value = "Current DOM at primary response";
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/recipes"));
  expect(app.calls[1]).toEqual({
    path: "/api/userfields/recipes/9",
    method: "PUT",
    body: { note: "Current DOM at primary response" },
  });
});

test("Recipe earlier field settlement after actual document departure stales fulfillment and rich content without new effects", async () => {
  const app = mountRecipe("/recipe/7", { heldField: "note" });
  app.data.fields.push({
    ...app.data.fields[0]!,
    id: 2,
    name: "last",
    caption: "Last recipe note",
  });
  await userEvent.type(await screen.findByLabelText("Owner note"), " earlier");
  await userEvent.type(screen.getByLabelText("Last recipe note"), "Last completes");
  await userEvent.click(await saveButton("Save & return to recipes"));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/recipes"));
  const earlier = app.signals.find((request) => request.path.startsWith("/api/userfields/"))!;
  expect(earlier.signal?.aborted).toBe(true);
  const keys = warmRecipeReads(app);
  const count = app.calls.length;
  await act(async () => app.metadata.release());

  for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(app.calls).toHaveLength(count);
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
});

test("Recipe main picture upload settling after real departure stales current recipe content without navigating back", async () => {
  const app = mountRecipe("/recipe/7", { holdPicture: true });
  await saveButton();
  await userEvent.upload(
    screen.getByLabelText("Picture", { selector: "input" }),
    new File([pictureBytes], "pending.png", { type: "image/png" }),
  );
  await userEvent.click(await saveButton());
  await waitFor(() =>
    expect(
      app.calls.some(
        (call) => call.path.startsWith("/api/files/recipepictures/") && call.method === "PUT",
      ),
    ).toBe(true),
  );
  await act(async () => app.router.navigate({ href: "/recipe/new" }));
  await screen.findByRole("heading", { name: "Create recipe" });
  const keys = warmRecipeReads(app);

  const upload = app.signals.find((request) =>
    request.path.startsWith("/api/files/recipepictures/"),
  )!;

  expect(upload.signal?.aborted).toBe(true);
  const count = app.calls.length;
  await act(async () => app.picture.release());

  for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(app.calls).toHaveLength(count);
  expect(app.router.state.location.pathname).toBe("/recipe/new");
});

test("controlled hidden Recipe create-picture retry posts a new row but preserves the original custom-field target ID", async () => {
  const app = mountRecipe("/recipe/new", { createIds: [41, 42], failPictureOnce: true });
  const name = await screen.findByLabelText("Name");
  await userEvent.type(name, "First created recipe");
  await userEvent.type(screen.getByLabelText("Owner note"), "Retained dirty note");
  const picture = screen.getByLabelText<HTMLInputElement>("Picture", { selector: "input" });
  expect(picture.closest("[hidden]")).toBeTruthy();
  // The native create column is hidden. This deliberately sets FileList to preserve its source branch, not a visible workflow.
  const file = new File([pictureBytes], "hidden.png", { type: "image/png" });
  Object.defineProperty(picture, "files", { configurable: true, value: [file] });
  await act(async () => {
    picture.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await userEvent.click(await saveButton("Save & return to recipes"));
  await screen.findByRole("button", { name: /Error while saving/ });
  await waitFor(() => expect(name.matches(":disabled")).toBe(false));
  await userEvent.clear(name);
  await userEvent.type(name, "Second created recipe");
  await userEvent.click(await saveButton("Save & return to recipes"));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/recipes"));
  expect(new URLSearchParams(app.router.history.location.search).get("recipe")).toBe("41");
  expect(
    app.calls.map((call) => (call.path.startsWith("/api/files/") ? "picture" : call.path)),
  ).toEqual([
    "/api/objects/recipes",
    "/api/userfields/recipes/41",
    "picture",
    "/api/objects/recipes",
    "/api/userfields/recipes/41",
    "picture",
  ]);
  expect(app.calls[1]!.body).toEqual({ note: "Retained dirty note" });
  expect(app.calls[4]!.body).toEqual({ note: "Retained dirty note" });
  expect(app.calls[2]!.file).toBe(file);
  expect(app.calls[5]!.file).toBe(file);
});
