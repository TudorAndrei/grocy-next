import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { RecipeIngredientContext } from "@/lib/recipe-form-context";
import type { JsonObject } from "@/lib/json";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

const recipe = {
  id: 4,
  name: "Bread",
  description: null,
  picture_file_name: null,
  base_servings: 1,
  desired_servings: 1,
  not_check_shoppinglist: 0,
  type: "normal",
  product_id: null,
};

const products = [
  {
    id: 10,
    name: "Flour",
    active: 1,
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    not_check_stock_fulfillment_for_recipes: 1,
  },
  {
    id: 20,
    name: "Oil",
    active: 0,
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    not_check_stock_fulfillment_for_recipes: 1,
  },
];

const units = [
  { id: 1, name: "Gram", name_plural: "Grams", plural_forms: null, active: 1 },
  { id: 2, name: "Cup", name_plural: "Cups", plural_forms: null, active: 0 },
  { id: 3, name: "Pinch", name_plural: "Pinches", plural_forms: null, active: 0 },
];

const conversions = products.flatMap((product) => [
  {
    id: product.id,
    product_id: product.id,
    from_qu_id: 1,
    to_qu_id: 1,
    factor: "1",
    path: "1",
    from_qu_name: "Gram",
    from_qu_name_plural: "Grams",
    to_qu_name: "Gram",
    to_qu_name_plural: "Grams",
  },
  {
    id: product.id + 1,
    product_id: product.id,
    from_qu_id: 1,
    to_qu_id: 2,
    factor: product.id === 10 ? "0.01" : "0.5",
    path: "1,2",
    from_qu_name: "Gram",
    from_qu_name_plural: "Grams",
    to_qu_name: "Cup",
    to_qu_name_plural: "Cups",
  },
]);

const position = {
  id: 9,
  recipe_id: 88,
  product_id: 20,
  amount: "4",
  qu_id: 2,
  only_check_single_unit_in_stock: 0,
  ingredient_group: "Sauce",
  note: "Stir gently",
  not_check_stock_fulfillment: 0,
  variable_amount: "To taste",
  price_factor: "1.234",
  round_up: 1,
};

function mountIngredient(
  path = "/recipe/4/pos/9?embedded&product=20",
  options: {
    holdDetails?: boolean;
    holdSave?: boolean;
    holdBarcode?: boolean;
    holdSettings?: boolean;
    holdContext?: boolean;
    denied?: boolean;
    missing?: boolean;
    oneUnit?: boolean;
    priceTracking?: boolean;
    failSaveOnce?: boolean;
    failBarcode?: boolean;
  } = {},
) {
  const details = deferred();
  const save = deferred();
  const barcode = deferred();
  const settings = deferred();
  const contextGate = deferred();
  const writes: Array<{ path: string; body: JsonObject }> = [];
  const detailReads: string[] = [];
  let failSave = options.failSaveOnce;
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => messages.mockRestore());

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/v2/user/permissions") return Response.json({ RECIPES: !options.denied });

      if (url === "/api/user/settings") {
        if (options.holdSettings) await settings.promise;

        return Response.json({ stock_decimal_places_amounts: 2 });
      }

      if (url.startsWith("/api/v2/recipes/ingredient-editor?")) {
        if (options.holdContext) await contextGate.promise;

        if (options.missing)
          return Response.json({ error_message: "Record not found" }, { status: 404 });
        const edit = new URL(url, "http://grocy.test").searchParams.has("position_id");

        const context: RecipeIngredientContext = {
          recipe,
          position: edit ? position : null,
          products: edit ? products : products.filter((row) => row.active === 1),
          barcodes: [{ product_id: 10, barcodes: "123,FLOUR-CODE" }],
          units,
          conversions: options.oneUnit
            ? conversions.filter((row) => row.to_qu_id === 1)
            : conversions,
          barcode_lookup_plugin_name: "",
        };

        return Response.json(context);
      }

      if (url.startsWith("/api/stock/products/")) {
        detailReads.push(url);

        if (options.holdDetails) await details.promise;

        return Response.json({
          product: { id: Number(url.split("/").at(-1)) },
          quantity_unit_stock: units[0],
        });
      }

      if (url === "/api/objects/product_barcodes" && init?.method === "POST") {
        writes.push({ path: url, body: JSON.parse(String(init.body)) });

        if (options.holdBarcode) await barcode.promise;

        if (options.failBarcode)
          return Response.json({ error_message: "Barcode failed" }, { status: 503 });

        return Response.json({ created_object_id: "42" });
      }

      if (
        url.startsWith("/api/objects/recipes_pos") &&
        ["POST", "PUT"].includes(init?.method ?? "")
      ) {
        writes.push({ path: url, body: JSON.parse(String(init?.body)) });

        if (options.holdSave) await save.promise;

        if (failSave) {
          failSave = false;

          return Response.json({ error_message: "Primary failed" }, { status: 503 });
        }

        if (options.denied)
          return Response.json({ error_message: "Permission denied" }, { status: 403 });

        return init?.method === "POST"
          ? Response.json({ created_object_id: "22" })
          : new Response(null, { status: 204 });
      }

      if (
        url.startsWith("/api/objects/product_barcodes_view?") ||
        url.startsWith("/api/objects/products?")
      )
        return Response.json([]);

      if (url === "/api/v2/recipes/overview") return Response.json([]);

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_RECIPES: true,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: options.priceTracking ?? true,
      FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
    },
  );

  const receipts = () =>
    messages.mock.calls
      .map(([message]) => message)
      .filter(
        (message) =>
          message?.Message === "IngredientsChanged" || message?.Message === "CloseLastModal",
      );

  return {
    ...app,
    writes,
    messages,
    receipts,
    detailReads,
    details,
    save,
    barcode,
    settings,
    contextGate,
  };
}

async function ready() {
  await screen.findByRole("form", { name: /recipe ingredient/ });
}

test("native ingredient new route loads parent defaults without a selected product", async () => {
  const app = mountIngredient("/recipe/4/pos/new");
  await ready();
  expect(screen.getByRole("heading", { name: "Add recipe ingredient" })).toBeTruthy();
  expect(screen.getByText("Bread")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Amount").value).toBe("1");
  expect(screen.getByLabelText<HTMLInputElement>("Price factor").value).toBe("1");
  expect(screen.getByLabelText<HTMLInputElement>("Group").value).toBe("");
  expect(
    screen.getByLabelText<HTMLInputElement>(
      "Disable stock fulfillment checking for this ingredient",
    ).checked,
  ).toBe(false);
  expect(within(screen.getByRole("form")).queryByText("Oil")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
});

test("edit resolves inactive product and saved inactive unit after held details and submits stock amount", async () => {
  const app = mountIngredient(undefined, { holdDetails: true });
  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Oil");
  expect(screen.getByLabelText<HTMLInputElement>("Amount").value).toBe("4");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  await act(async () => app.details.release());
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Amount").value).toBe("2"));
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("2");
  expect(screen.getByText("This equals 4 Grams")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Price factor").value).toBe("1.23");
  expect(
    screen.getByLabelText<HTMLInputElement>(
      "Disable stock fulfillment checking for this ingredient",
    ).checked,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(2));
  expect(app.writes).toEqual([
    {
      path: "/api/objects/recipes_pos/9",
      body: {
        recipe_id: 4,
        product_id: "20",
        amount: "4.",
        qu_id: "2",
        variable_amount: "To taste",
        round_up: "1",
        only_check_single_unit_in_stock: "0",
        not_check_stock_fulfillment: "1",
        ingredient_group: "Sauce",
        note: "Stir gently",
        price_factor: "1.23",
      },
    },
  ]);
  expect(app.receipts()).toEqual([
    { Message: "IngredientsChanged", Payload: null },
    { Message: "CloseLastModal", Payload: null },
  ]);
  expect(screen.getByLabelText<HTMLInputElement>("Amount").matches(":disabled")).toBe(true);
});

test("direct selected edit does not invent a product prefill from the stored position", async () => {
  const app = mountIngredient("/recipe/4/pos/9");
  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Note").value).toBe("Stir gently");
  expect(app.detailReads).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
});

test("first raw product query wins and first new-product reload clears unmatched initial amount", async () => {
  const app = mountIngredient("/recipe/4/pos/new?product=10&product=20");
  await ready();
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("1"),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Flour");
  expect(screen.getByLabelText<HTMLInputElement>("Amount").value).toBe("");
  expect(
    screen.getByLabelText<HTMLInputElement>(
      "Disable stock fulfillment checking for this ingredient",
    ).checked,
  ).toBe(false);
  await userEvent.type(screen.getByLabelText("Amount"), "3");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]?.body.amount).toBe("3.");
  expect(app.writes[0]?.body).not.toHaveProperty("display_amount");
  expect(app.writes[0]?.body.product_id).toBe("10");
});

test("only-any-stock allows unrelated inactive units and unchecking restores stock unit with zero minimum", async () => {
  const app = mountIngredient();
  await ready();
  await screen.findByText("This equals 4 Grams");
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Only check if any amount is in stock"));
  await user.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  await user.clear(screen.getByLabelText("Amount"));
  await user.type(screen.getByLabelText("Amount"), "5");
  expect(screen.queryByText(/This equals/)).toBeNull();
  await user.click(screen.getByLabelText("Only check if any amount is in stock"));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("1"),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Amount").min).toBe("0");
  await user.clear(screen.getByLabelText("Amount"));
  await user.type(screen.getByLabelText("Amount"), "0");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]?.body.amount).toBe("0.");
  expect(app.writes[0]?.body.qu_id).toBe("1");
});

test("single-option unit is omitted like native disabled select and hidden pricing serializes one", async () => {
  const app = mountIngredient("/recipe/4/pos/new?product=10", {
    oneUnit: true,
    priceTracking: false,
  });

  await ready();
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").disabled).toBe(true),
  );
  expect(screen.queryByLabelText("Price factor")).toBeNull();
  await userEvent.type(screen.getByLabelText("Amount"), "2");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]?.body).not.toHaveProperty("qu_id");
  expect(app.writes[0]?.body.price_factor).toBe("1");
});

test("barcode assignment and primary start independently and success does not wait for barcode", async () => {
  const app = mountIngredient(
    "/recipe/4/pos/9?flow=InplaceAddBarcodeToExistingProduct&barcode=unlisted&product=20",
    { holdBarcode: true },
  );

  await ready();
  await screen.findByText("This equals 4 Grams");
  expect(screen.getByText("unlisted")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(2));
  expect(app.writes.map((row) => row.path)).toEqual([
    "/api/objects/product_barcodes",
    "/api/objects/recipes_pos/9",
  ]);
  expect(app.writes[0]?.body).toEqual({ barcode: "unlisted", product_id: "20" });
  await act(async () => app.barcode.release());
});

test("barcode success hides info but raw flow survives primary failure and retry assigns again", async () => {
  const app = mountIngredient(
    "/recipe/4/pos/9?flow=InplaceAddBarcodeToExistingProduct&barcode=unlisted&product=20",
    { holdSave: true, failSaveOnce: true },
  );

  await ready();
  await screen.findByText("This equals 4 Grams");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByText("unlisted")).toBeNull());
  await act(async () => app.save.release());
  await screen.findByText("Error while saving, probably this item already exists");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(2));
  expect(app.writes.map((row) => row.path)).toEqual([
    "/api/objects/product_barcodes",
    "/api/objects/recipes_pos/9",
    "/api/objects/product_barcodes",
    "/api/objects/recipes_pos/9",
  ]);
  expect(app.writes[2]?.body.barcode).toBe("unlisted");
});

test("product-name prefill lowercases stored barcode data while preserving query case", async () => {
  const app = mountIngredient("/recipe/4/pos/new?product-name=flour-code");
  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Flour");
  await act(async () =>
    app.router.navigate({
      to: "/recipe/$recipeId/pos/$positionId",
      params: { recipeId: "4", positionId: "new" },
      search: { "product-name": "FLOUR-CODE" },
    }),
  );
  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  await act(async () => {
    await app.router.navigate({
      to: "/recipe/$recipeId/pos/$positionId",
      params: { recipeId: "4", positionId: "new" },
      search: { "product-name": "" },
    });
  });
  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
});

test("primary error reenables single-unit select and retry includes its value", async () => {
  const app = mountIngredient("/recipe/4/pos/new?product=10", {
    oneUnit: true,
    failSaveOnce: true,
  });

  await ready();
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").disabled).toBe(true),
  );
  await userEvent.type(screen.getByLabelText("Amount"), "2");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Error while saving, probably this item already exists");
  expect(app.writes[0]?.body).not.toHaveProperty("qu_id");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").disabled).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(2));
  expect(app.writes[1]?.body.qu_id).toBe("1");
});

test("barcode error clears global cursor through wrong native form while ingredient stays busy", async () => {
  const app = mountIngredient(
    "/recipe/4/pos/9?flow=InplaceAddBarcodeToExistingProduct&barcode=unlisted&product=20",
    { holdSave: true, failBarcode: true },
  );

  await ready();
  await screen.findByText("This equals 4 Grams");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Error while saving, probably this item already exists");
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(screen.getByLabelText("Note").matches(":disabled")).toBe(true);
  expect(app.receipts()).toHaveLength(0);
  await act(async () => app.save.release());
  await waitFor(() => expect(app.receipts()).toHaveLength(2));
});

test("real picker resolves barcodes and unknown codes enter native assignment workflow", async () => {
  const app = mountIngredient("/recipe/4/pos/new");
  await ready();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Product"), "123");
  await user.tab();
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Flour"),
  );
  await user.clear(screen.getByLabelText("Product"));
  await user.type(screen.getByLabelText("Product"), "grcy:p:10");
  await user.tab();
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Flour"),
  );
  await user.clear(screen.getByLabelText("Product"));
  await user.type(screen.getByLabelText("Product"), "unknown-code");
  await user.tab();
  await screen.findByRole("button", { name: /Add as barcode to existing product/ });
  await user.click(screen.getByRole("button", { name: /Add as barcode to existing product/ }));
  await waitFor(() =>
    expect(app.router.state.location.search.flow).toBe("InplaceAddBarcodeToExistingProduct"),
  );
  expect(app.router.state.location.search.barcode).toBe("unknown-code");
  expect(app.router.state.location.pathname).toBe("/recipe/4/pos/new");
});

test("new-product workflow returns to this ingredient form with its embedded query", async () => {
  const app = mountIngredient("/recipe/4/pos/new?embedded");
  await ready();
  await userEvent.type(screen.getByLabelText("Product"), "New ingredient");
  await userEvent.tab();
  await userEvent.click(await screen.findByRole("button", { name: /Add as new product$/ }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/product/new"));
  expect(app.router.state.location.search.flow).toBe("InplaceNewProductWithName");
  expect(app.router.state.location.search.name).toBe("New ingredient");
  expect(app.router.state.location.search.returnto).toBe(
    "/recipe/4/pos/new?embedded&flow=InplaceNewProductWithName",
  );
});

test("fresh settings replace cached precision before the initial ingredient draft", async () => {
  const app = mountIngredient(undefined, { holdSettings: true });
  app.client.setQueryDefaults(["user", "settings"], { staleTime: 30_000 });
  app.client.setQueryData(["user", "settings"], { stock_decimal_places_amounts: 0 });
  await waitFor(() =>
    expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/user/settings")).toBe(
      true,
    ),
  );
  expect(screen.queryByLabelText("Price factor")).toBeNull();
  expect(app.writes).toEqual([]);
  await act(async () => app.settings.release());
  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Price factor").value).toBe("1.23");
});

test("API denial unlocks native visible controls and retains the note draft", async () => {
  const app = mountIngredient(undefined, { denied: true });
  await ready();
  await screen.findByText("This equals 4 Grams");
  await userEvent.type(screen.getByLabelText("Note"), " updated");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Error while saving, probably this item already exists");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Note").disabled).toBe(false);
  expect(screen.getByLabelText<HTMLTextAreaElement>("Note").value).toBe("Stir gently updated");
  expect(app.receipts()).toHaveLength(0);
});

test("owner departure discards held primary success messages", async () => {
  const app = mountIngredient(undefined, { holdSave: true });
  await ready();
  await screen.findByText("This equals 4 Grams");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => app.router.navigate({ to: "/recipes", search: {} }));
  await act(async () => app.save.release());
  expect(app.receipts()).toHaveLength(0);
  expect(app.router.state.location.pathname).toBe("/recipes");
});

test("fresh context gates the first draft and later refetches preserve edits", async () => {
  const app = mountIngredient("/recipes", { holdContext: true });
  app.client.setQueryData(["recipe-ingredient-editor", 4, null], {
    recipe,
    position: null,
    products: [],
    barcodes: [],
    units: [],
    conversions: [],
    barcode_lookup_plugin_name: "",
  });
  await act(async () =>
    app.router.navigate({
      to: "/recipe/$recipeId/pos/$positionId",
      params: { recipeId: "4", positionId: "new" },
      search: {},
    }),
  );
  await screen.findByRole("heading", { name: "Add recipe ingredient" });
  expect(screen.queryByLabelText("Note")).toBeNull();
  await act(async () => app.contextGate.release());
  await ready();
  await userEvent.type(screen.getByLabelText("Note"), "Keep this draft");
  await act(async () => app.client.invalidateQueries({ queryKey: ["recipe-ingredient-editor"] }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("Note").value).toBe("Keep this draft");
});

test("held stock detail replies cannot refocus or change the next page after departure", async () => {
  const app = mountIngredient(undefined, { holdDetails: true });
  await ready();
  await waitFor(() => expect(app.detailReads).toHaveLength(1));
  await act(async () => app.router.navigate({ to: "/recipes", search: {} }));
  await act(async () => app.details.release());
  expect(app.router.state.location.pathname).toBe("/recipes");
  expect(screen.queryByLabelText("Amount")).toBeNull();
  expect(app.receipts()).toHaveLength(0);
});

test("missing selected records never fall back to a new ingredient", async () => {
  mountIngredient("/recipe/4/pos/999", { missing: true });
  await screen.findByText("Record not found");
  expect(screen.queryByLabelText("Product")).toBeNull();
});

test("invalid selected identifiers never read or write an unrelated record", async () => {
  const app = mountIngredient("/recipe/4/pos/nope");
  await screen.findByText("Object not found");
  expect(
    app.fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith("/api/v2/recipes/ingredient-editor"),
    ),
  ).toBe(false);
  expect(screen.queryByLabelText("Product")).toBeNull();
  expect(app.writes).toHaveLength(0);
});
