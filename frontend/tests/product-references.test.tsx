import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { EntityManager } from "@/components/EntityManager";
import type { EntityRow } from "@/lib/entities";
import type { JsonObject } from "@/lib/json";
import { supportDescriptionEditors } from "./fixtures/editor";

// Native option sets for a product with history, three connected active units,
// a connected inactive stock unit, and an inactive child.
const references = {
  location_id: [3, 2],
  default_consume_location_id: [3, 2],
  shopping_location_id: [6],
  product_group_id: [5],
  parent_product_id: [8, 11],
  qu_id_stock: [2, 3, 4, 1],
  qu_id_purchase: [2, 3, 1],
  qu_id_consume: [2, 3, 1],
  qu_id_price: [2, 3, 1],
};

const matrix = [
  { from_qu_id: 1, to_qu_id: 1, factor: 1 },
  { from_qu_id: 2, to_qu_id: 1, factor: 6 },
  { from_qu_id: 3, to_qu_id: 1, factor: 24 },
  { from_qu_id: 3, to_qu_id: 2, factor: 4 },
];

function mount({ child = false, precision = 4, numeric = false } = {}) {
  const product: EntityRow = {
    id: 7,
    name: "Coffee",
    location_id: 1,
    default_consume_location_id: 1,
    shopping_location_id: 3,
    product_group_id: 4,
    qu_id_stock: 1,
    qu_id_purchase: 5,
    qu_id_consume: 4,
    qu_id_price: 5,
    parent_product_id: child ? 8 : null,
    min_stock_amount: 7,
  };

  if (numeric)
    Object.assign(product, {
      min_stock_amount: 1.125,
      quick_consume_amount: 0.555,
      quick_open_amount: 0.555,
      tare_weight: 0.125,
      calories: null,
      default_best_before_days: 0.5,
    });

  const products = [product, { id: 8, name: "Parent" }, { id: 11, name: "Other parent" }];
  const writes: { path: string; body: JsonObject }[] = [];
  let attempts = 0;
  let failParent = false;
  let holdParent = false;
  let parentResponse: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://test.invalid");
      const path = url.pathname;

      if (path === "/api/v2/products/form-options") {
        if (!child && url.searchParams.has("product_id") && ++attempts === 1)
          return Response.json({ error_message: "Product choices failed" }, { status: 503 });

        const existing = url.searchParams.has("product_id");

        const newReferences = {
          ...references,
          parent_product_id: [7, 8, 11],
          qu_id_stock: [2, 3, 4, 5, 1],
          qu_id_purchase: [2, 3, 5, 1],
          qu_id_consume: [2, 3, 5, 1],
          qu_id_price: [2, 3, 5, 1],
        };

        return Response.json({
          references: existing ? references : newReferences,
          parent_disabled: existing && !child,
          conversions: existing ? matrix : [],
        });
      }

      if (path === "/api/objects/products/8" || path === "/api/objects/products/11") {
        if (failParent)
          return Response.json({ error_message: "Parent read failed" }, { status: 503 });

        if (holdParent && path.endsWith("/8"))
          await new Promise<void>((resolve) => {
            parentResponse = resolve;
          });

        return Response.json({
          id: path.endsWith("/8") ? 8 : 11,
          cumulate_min_stock_amount_of_sub_products: path.endsWith("/8") ? "on" : 0,
        });
      }

      if (path === "/api/objects/products/7" && init?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(init.body));
        writes.push({ path, body });
        Object.assign(product, body);

        return new Response(null, { status: 204 });
      }

      if (path === "/api/objects/products" && init?.method === "POST") {
        const body: JsonObject = JSON.parse(String(init.body));
        writes.push({ path, body });
        products.push({ ...body, id: 12 });

        return Response.json({ created_object_id: "12" });
      }

      if (init?.method && init.method !== "GET") {
        writes.push({ path, body: JSON.parse(String(init.body)) });

        return new Response(null, { status: 204 });
      }

      if (path === "/api/objects/products")
        return Response.json(
          products.map((row) => ({ ...row, calories: row.calories === "" ? null : row.calories })),
        );

      if (path === "/api/objects/quantity_units")
        return Response.json([
          { id: 1, name: "Piece", active: 1 },
          { id: 2, name: "Box", active: 1 },
          { id: 3, name: "Crate", active: 1 },
          { id: 4, name: "Inactive", active: 0 },
          { id: 5, name: "Unconnected", active: 1 },
        ]);

      if (path === "/api/objects/locations")
        return Response.json([
          { id: 1, name: "Inactive shelf", active: 0 },
          { id: 2, name: "Z shelf" },
          { id: 3, name: "a shelf" },
        ]);

      if (path === "/api/objects/shopping_locations")
        return Response.json([
          { id: 3, name: "Inactive store", active: 0 },
          { id: 6, name: "Store" },
        ]);

      if (path === "/api/objects/product_groups")
        return Response.json([
          { id: 4, name: "Inactive group", active: 0 },
          { id: 5, name: "Group" },
        ]);

      if (path === "/api/objects/quantity_unit_conversions_resolved")
        return Response.json(
          matrix.map((row, index) => ({ ...row, id: index + 1, product_id: 7 })),
        );

      if (path === "/api/user/settings")
        return Response.json({ stock_decimal_places_amounts: precision });

      if (path === "/api/system/config") return Response.json({});

      return Response.json([]);
    }),
  );
  supportDescriptionEditors();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const app = render(
    <QueryClientProvider client={client}>
      <EntityManager entity="products" />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return {
    writes,
    product,
    setParentFailure: (value: boolean) => {
      failParent = value;
    },
    holdParentRead: () => {
      holdParent = true;
    },
    pendingParentRead: () => Boolean(parentResponse),
    releaseParentRead: () => parentResponse?.(),
  };
}

function choices(label: string) {
  return within(screen.getByRole("combobox", { name: label }))
    .getAllByRole("option")
    .map((option) => option.textContent);
}

test("product choices retain drafts on load failure, apply native defaults, and preserve factors on unit changes", async () => {
  const { writes, product } = mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  await screen.findByText("Product choices failed");
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save product" });
  expect(save.disabled).toBe(true);
  await user.type(screen.getByLabelText("Name"), " draft");
  await user.click(screen.getByRole("button", { name: "Retry product options" }));
  const location = screen.getByRole<HTMLSelectElement>("combobox", { name: "Default location" });
  await waitFor(() => expect(location.disabled).toBe(false));
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Coffee draft");
  expect(location.value).toBe("");
  expect(choices("Default location")).toEqual(["Select an option", "a shelf", "Z shelf"]);
  expect(choices("Stock unit")).toEqual(["Select an option", "Box", "Crate", "Inactive", "Piece"]);

  for (const label of ["Purchase unit", "Consume unit", "Price unit"]) {
    expect(choices(label)).toEqual(["Select an option", "Box", "Crate", "Piece"]);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: label }).value).toBe("1");
  }

  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Parent product" }).disabled).toBe(
    true,
  );
  await screen.findByText(
    "Not possible because this product is already used as a parent product in another product",
  );
  expect(choices("Parent product")).toEqual(["None", "Parent", "Other parent"]);
  await user.selectOptions(location, "3");

  for (const label of ["Consume unit", "Price unit"])
    await user.selectOptions(screen.getByLabelText(label), "");
  await user.click(save);
  expect(writes).toEqual([]);
  await user.type(screen.getByLabelText("Name"), "!");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Consume unit" }).value).toBe("1");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Price unit" }).value).toBe("1");
  await user.selectOptions(screen.getByLabelText("Purchase unit"), "3");
  expect(screen.getByLabelText<HTMLInputElement>("Stock units per purchase unit").value).toBe("24");
  await user.selectOptions(screen.getByLabelText("Stock unit"), "2");
  expect(screen.getByLabelText<HTMLInputElement>("Stock units per purchase unit").value).toBe("4");
  await user.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body).toMatchObject({
    name: "Coffee draft!",
    location_id: 3,
    qu_id_stock: 2,
    qu_id_purchase: 3,
    qu_id_consume: 1,
    qu_id_price: 1,
    default_consume_location_id: "",
    shopping_location_id: "",
    product_group_id: "",
  });
  expect(writes[0]?.body).not.toHaveProperty("parent_product_id");
  expect(product.parent_product_id).toBeNull();
});

test.each([0, 2])(
  "product number validation follows precision %s and saves an empty optional energy value",
  async (precision) => {
    const { writes } = mount({ precision });
    const user = userEvent.setup();
    const add = await screen.findByRole<HTMLButtonElement>("button", { name: "Add product" });
    await waitFor(() => expect(add.disabled).toBe(false));
    await user.click(add);
    await user.type(screen.getByLabelText("Name"), "Numeric product");
    await user.selectOptions(screen.getByLabelText("Default location"), "3");
    await user.selectOptions(screen.getByLabelText("Stock unit"), "1");
    await user.click(screen.getByLabelText("Use container weight"));
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save product" });
    await waitFor(() => expect(save.disabled).toBe(false));
    const fraction = precision === 0 ? "1.5" : "1.001";

    const fields = [
      ["Minimum stock", ["", "-1", fraction], "0"],
      ["Days before expiry", ["", "-2", "0.5"], "-1"],
      ["Days after opening", ["", "-1", "0.5"], "0"],
      ["Days after freezing", ["", "-2", "0.5"], "-1"],
      ["Days after thawing", ["", "-1", "0.5"], "0"],
      ["Quick consume amount", ["", "0", fraction], "1"],
      ["Quick open amount", ["", "0", fraction], "1"],
      ["Container weight", ["", "-1", fraction], "0"],
      ["Energy per stock unit (kcal)", ["-1", fraction], ""],
    ] as const;

    for (const [label, invalid, valid] of fields) {
      const input = screen.getByLabelText<HTMLInputElement>(label);

      for (const value of invalid) {
        await user.clear(input);

        if (value) await user.type(input, value);
        await user.click(save);
        expect(writes, `${label}: ${value}`).toEqual([]);
        expect(input.checkValidity(), `${label}: ${value}`).toBe(false);
      }

      await user.clear(input);

      if (valid) await user.type(input, valid);
    }

    const minimum = screen.getByLabelText<HTMLInputElement>("Minimum stock");
    await user.clear(minimum);
    await user.keyboard("{ArrowDown}");
    expect(minimum.value).toBe("0");
    await user.keyboard("{ArrowUp}");
    expect(minimum.value).toBe("1");

    if (precision === 2) {
      await user.clear(minimum);
      await user.type(minimum, "0.25");
      await user.keyboard("{ArrowUp}");
      expect(minimum.value).toBe("1.25");
      await user.clear(minimum);
      await user.type(minimum, "1");
    }

    await user.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toMatchObject({
      name: "Numeric product",
      calories: "",
      min_stock_amount: 1,
      quick_consume_amount: 1,
      quick_open_amount: 1,
      tare_weight: 0,
      default_best_before_days: -1,
      default_best_before_days_after_freezing: -1,
    });
  },
);

test("product editing rounds saved amounts on load and uses the native empty energy default on reopen", async () => {
  const { writes, product } = mount({ precision: 2, numeric: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  await screen.findByText("Product choices failed");
  await user.click(screen.getByRole("button", { name: "Retry product options" }));
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save product" });
  await waitFor(() => expect(save.disabled).toBe(false));
  expect(screen.getByLabelText<HTMLInputElement>("Minimum stock").value).toBe("1.13");
  expect(screen.getByLabelText<HTMLInputElement>("Quick consume amount").value).toBe("0.56");
  expect(screen.getByLabelText<HTMLInputElement>("Quick open amount").value).toBe("0.56");
  expect(screen.getByLabelText<HTMLInputElement>("Container weight").value).toBe("0.13");
  expect(screen.getByLabelText<HTMLInputElement>("Energy per stock unit (kcal)").value).toBe("1");
  const days = screen.getByLabelText<HTMLInputElement>("Days before expiry");
  expect(days.value).toBe("0.5");
  await user.click(save);
  expect(writes).toEqual([]);
  await user.clear(days);
  await user.type(days, "2");
  await user.selectOptions(screen.getByLabelText("Default location"), "3");
  await user.clear(screen.getByLabelText("Energy per stock unit (kcal)"));
  await user.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body).toMatchObject({
    min_stock_amount: 1.13,
    quick_consume_amount: 0.56,
    quick_open_amount: 0.56,
    calories: "",
    default_best_before_days: 2,
  });
  expect(product.tare_weight).toBe(0.125);
  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  expect(screen.getByLabelText<HTMLInputElement>("Energy per stock unit (kcal)").value).toBe("1");
});

test("new product forms send explicit empty optional references with valid required units", async () => {
  const { writes } = mount();
  const user = userEvent.setup();
  const add = await screen.findByRole<HTMLButtonElement>("button", { name: "Add product" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);
  await user.type(screen.getByLabelText("Name"), "New product");
  await user.selectOptions(screen.getByLabelText("Default location"), "3");
  await user.selectOptions(screen.getByLabelText("Stock unit"), "1");
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save product" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    path: "/api/objects/products",
    body: {
      name: "New product",
      qu_id_stock: 1,
      qu_id_purchase: 1,
      qu_id_consume: 1,
      qu_id_price: 1,
      parent_product_id: "",
      product_group_id: "",
      shopping_location_id: "",
      default_consume_location_id: "",
    },
  });
});

test("parent minimum rules retain disabled values and refresh when the selected parent changes", async () => {
  const {
    writes,
    product,
    setParentFailure,
    holdParentRead,
    pendingParentRead,
    releaseParentRead,
  } = mount({ child: true });

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  let minimum = screen.getByLabelText<HTMLInputElement>("Minimum stock");
  await waitFor(() => expect(minimum.disabled).toBe(true));
  expect(minimum.value).toBe("7");
  await user.selectOptions(screen.getByLabelText("Default location"), "3");
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body).not.toHaveProperty("min_stock_amount");
  expect(product.min_stock_amount).toBe(7);

  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  minimum = screen.getByLabelText<HTMLInputElement>("Minimum stock");
  await waitFor(() => expect(minimum.disabled).toBe(true));
  await user.selectOptions(screen.getByLabelText("Parent product"), "11");
  await waitFor(() => expect(minimum.disabled).toBe(false));
  await user.clear(minimum);
  await user.type(minimum, "9");
  setParentFailure(true);
  await user.selectOptions(screen.getByLabelText("Parent product"), "8");
  await screen.findByText("Parent read failed");
  expect(minimum.disabled).toBe(false);
  expect(minimum.value).toBe("9");
  setParentFailure(false);
  await user.click(screen.getByRole("button", { name: "Retry parent product" }));
  await waitFor(() => expect(minimum.disabled).toBe(true));
  expect(minimum.value).toBe("9");
  await user.selectOptions(screen.getByLabelText("Parent product"), "");
  expect(minimum.disabled).toBe(false);
  holdParentRead();
  await user.selectOptions(screen.getByLabelText("Parent product"), "8");
  await waitFor(() => expect(pendingParentRead()).toBe(true));
  await user.selectOptions(screen.getByLabelText("Parent product"), "11");
  await act(async () => releaseParentRead());
  expect(minimum.disabled).toBe(false);
  await user.selectOptions(screen.getByLabelText("Parent product"), "");
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.body).toMatchObject({ parent_product_id: "", min_stock_amount: 9 });
  expect(product.min_stock_amount).toBe(9);
});
