import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EntityManager } from "@/components/EntityManager";
import type { JsonObject } from "@/lib/json";

test.each([
  [true, true],
  [false, false],
  [true, false],
])("product options follow tracking (%s) and opening (%s) defaults", async (tracking, opening) => {
  let saved: JsonObject | undefined;

  const product = {
    id: 1,
    name: "Milk",
    location_id: 2,
    default_consume_location_id: 2,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    shopping_location_id: 3,
    default_best_before_days: 20,
    default_best_before_days_after_open: 3,
    default_best_before_days_after_freezing: 60,
    default_best_before_days_after_thawing: 2,
    should_not_be_frozen: 1,
    treat_opened_as_out_of_stock: 1,
    default_stock_label_type: 2,
    auto_reprint_stock_label: 1,
    default_purchase_price_type: 3,
    due_type: 2,
    calories: null,
  };

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: opening,
          FEATURE_FLAG_STOCK_PRODUCT_FREEZING: tracking,
          FEATURE_FLAG_LABEL_PRINTER: tracking,
          ENERGY_UNIT: "kJ",
        });

      if (path === "/api/objects/products/1" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body));

        return new Response(null, { status: 204 });
      }

      if (path === "/api/objects/products") return Response.json([product]);

      if (path === "/api/user/settings")
        return Response.json({
          product_presets_location_id: 99,
          product_presets_qu_id: 99,
          product_presets_default_due_days: -1,
          product_presets_treat_opened_as_out_of_stock: false,
          product_presets_default_stock_label_type: 0,
        });

      if (path === "/api/objects/quantity_units") return Response.json([{ id: 1, name: "Bottle" }]);

      if (path === "/api/objects/locations") return Response.json([{ id: 2, name: "Fridge" }]);

      if (path === "/api/objects/shopping_locations")
        return Response.json([{ id: 3, name: "Store" }]);

      return Response.json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EntityManager entity="products" />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Milk/ }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Fresh milk");
  expect(screen.getByLabelText<HTMLInputElement>("Energy per stock unit (kJ)").value).toBe("1");

  if (tracking) await user.selectOptions(screen.getByLabelText("Default stock label"), "1");
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(saved?.name).toBe("Fresh milk"));
  expect(saved).toMatchObject({
    location_id: tracking ? 2 : 1,
    default_consume_location_id: tracking ? 2 : 1,
    shopping_location_id: tracking ? 3 : 1,
    default_best_before_days: tracking ? 20 : 1,
    default_best_before_days_after_freezing: tracking ? 60 : 0,
    default_best_before_days_after_thawing: tracking ? 2 : 0,
    should_not_be_frozen: tracking ? 1 : 0,
    due_type: tracking ? "2" : 1,
    calories: 1,
  });

  if (tracking)
    expect(saved).toMatchObject({
      default_stock_label_type: "1",
      auto_reprint_stock_label: 1,
      default_purchase_price_type: "3",
    });
  else {
    expect(saved).not.toHaveProperty("default_stock_label_type");
  }

  if (opening) expect(saved?.treat_opened_as_out_of_stock).toBe(1);
  else expect(saved).not.toHaveProperty("treat_opened_as_out_of_stock");

  if (tracking && !opening) expect(saved?.default_best_before_days_after_open).toBe(1);
});
