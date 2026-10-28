import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { UserSettings } from "@/lib/types";
import type { JsonObject } from "@/lib/json";

function app(path: string) {
  const settings: UserSettings = {
    night_mode: "off",
    product_presets_location_id: -1,
    product_presets_product_group_id: -1,
    product_presets_qu_id: -1,
    product_presets_default_due_days: 0,
    product_presets_treat_opened_as_out_of_stock: false,
    product_presets_default_stock_label_type: 0,
  };

  const products: JsonObject[] = [];
  const preferenceWrites: UserSettings[] = [];
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);

      if (url === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (url === "/api/user") return Response.json([{ id: 1, username: "tester" }]);

      if (url === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (url === "/api/system/config") return Response.json({ FEATURE_FLAG_LABEL_PRINTER: true });

      if (url === "/api/user/settings") return Response.json(settings);

      if (url === "/api/v2/user/settings" && init?.method === "PUT") {
        const body: UserSettings = JSON.parse(String(init.body));
        preferenceWrites.push(body);
        Object.assign(settings, body);

        return Response.json(body);
      }

      if (url.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (url === "/api/objects/locations") return Response.json([{ id: 2, name: "Fridge" }]);

      if (url === "/api/objects/product_groups") return Response.json([{ id: 3, name: "Dairy" }]);

      if (url === "/api/objects/quantity_units")
        return Response.json([
          { id: 1, name: "Bottle" },
          { id: 4, name: "Pack" },
        ]);

      if (url === "/api/objects/products" && init?.method === "POST") {
        products.push(JSON.parse(String(init.body)));

        return Response.json({ created_object_id: "42" });
      }

      if (url === "/api/objects/quantity_unit_conversions" && init?.method === "POST")
        return Response.json({ created_object_id: "1" });

      return Response.json(url.includes("shopping-lists") ? { items: [] } : []);
    }),
  );

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { products, preferenceWrites };
}

async function createProduct() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit catalog" }));
  const add = await screen.findByRole<HTMLButtonElement>("button", { name: "Add product" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);

  return user;
}

test("saved product presets fill all new-product units and retain the never-due value", async () => {
  const { products, preferenceWrites } = app("/settings?tab=products");
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Fridge" });
  await user.selectOptions(await screen.findByLabelText("Location"), "2");
  await user.selectOptions(await screen.findByLabelText("Product group"), "3");
  await user.selectOptions(await screen.findByLabelText("Quantity unit"), "1");
  await user.clear(screen.getByLabelText("Default due days"));
  await user.type(screen.getByLabelText("Default due days"), "-1");
  await user.click(screen.getByLabelText("Treat opened as out of stock"));
  await user.selectOptions(screen.getByLabelText("Default stock entry label"), "2");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(preferenceWrites).toContainEqual({
      product_presets_location_id: 2,
      product_presets_product_group_id: 3,
      product_presets_qu_id: 1,
      product_presets_default_due_days: -1,
      product_presets_treat_opened_as_out_of_stock: true,
      product_presets_default_stock_label_type: "2",
    }),
  );
  await user.click(screen.getByRole("link", { name: "Products" }));
  await createProduct();

  for (const label of ["Stock unit", "Purchase unit", "Consume unit", "Price unit"])
    expect(screen.getByLabelText<HTMLSelectElement>(label).value).toBe("1");
  expect(screen.getByLabelText<HTMLInputElement>("Days before expiry").value).toBe("-1");
  await user.type(screen.getByLabelText("Name"), "Milk");
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(products).toHaveLength(1));
  expect(products[0]).toMatchObject({
    name: "Milk",
    location_id: 2,
    product_group_id: 3,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    default_best_before_days: -1,
    treat_opened_as_out_of_stock: 1,
    default_stock_label_type: "2",
  });
});

test("choosing a stock unit fills empty defaults and retains a selected purchase unit", async () => {
  const { products } = app("/products");
  const user = await createProduct();
  await user.selectOptions(screen.getByLabelText("Purchase unit"), "4");
  await user.selectOptions(screen.getByLabelText("Stock unit"), "1");
  expect(screen.getByLabelText<HTMLSelectElement>("Purchase unit").value).toBe("4");
  expect(screen.getByLabelText<HTMLSelectElement>("Consume unit").value).toBe("1");
  expect(screen.getByLabelText<HTMLSelectElement>("Price unit").value).toBe("1");
  await user.type(screen.getByLabelText("Name"), "Milk");
  await user.selectOptions(screen.getByLabelText("Default location"), "2");
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(products).toHaveLength(1));
  expect(products[0]).toMatchObject({
    qu_id_stock: 1,
    qu_id_purchase: 4,
    qu_id_consume: 1,
    qu_id_price: 1,
  });
});
