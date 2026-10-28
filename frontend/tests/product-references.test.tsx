import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

function mount() {
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
    parent_product_id: null,
  };

  const products = [product, { id: 8, name: "Parent" }, { id: 11, name: "Other parent" }];
  const writes: { path: string; body: JsonObject }[] = [];
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://test.invalid");
      const path = url.pathname;

      if (path === "/api/v2/products/form-options") {
        if (url.searchParams.has("product_id") && ++attempts === 1)
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
          parent_disabled: existing,
          conversions: existing ? matrix : [],
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

      if (path === "/api/objects/products") return Response.json(products);

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

      if (path === "/api/system/config" || path === "/api/user/settings") return Response.json({});

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

  return { writes, product };
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
