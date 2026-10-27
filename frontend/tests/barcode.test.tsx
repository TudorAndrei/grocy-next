import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Route } from "@/routes/barcode";

function mount() {
  vi.stubGlobal("scrollTo", vi.fn());

  const router = createRouter({
    routeTree: createRootRoute({ component: Route.options.component }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

test("a saved barcode works when the external service is offline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/stock/products/by-barcode/123") {
        return Response.json({ product: { id: 42, name: "Saved bread" }, stock_amount: 2 });
      }

      if (path.includes("external-lookup")) {
        return Response.json({ error_message: "External service is offline" }, { status: 500 });
      }

      return Response.json([]);
    }),
  );
  mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Barcode"), "123");
  await user.click(screen.getByRole("button", { name: "Look up" }));
  const link = await screen.findByRole("link", { name: "Open product stock" });
  expect(link.getAttribute("href")).toContain("/products/42");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Look up" }).hasAttribute("disabled")).toBe(false),
  );
  expect(screen.queryByText("External service is offline")).toBeNull();
});

test("a missing legacy barcode can create the product from external lookup", async () => {
  let created = false;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/stock/products/by-barcode/123") {
        return created
          ? Response.json({ product: { id: 42, name: "Lookup bread" }, stock_amount: 0 })
          : Response.json({ error_message: "No product with barcode 123 found" }, { status: 400 });
      }

      if (path === "/api/stock/barcodes/external-lookup/123?add=true") {
        created = true;

        return Response.json({ id: "42", name: "Lookup bread", __barcode: "123" });
      }

      if (path === "/api/stock/barcodes/external-lookup/123") {
        return Response.json({ name: "Lookup bread", __barcode: "123" });
      }

      return Response.json([]);
    }),
  );
  mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Barcode"), "123");
  await user.click(screen.getByRole("button", { name: "Look up" }));
  await user.click(await screen.findByRole("button", { name: "Create product from lookup" }));
  expect(
    (await screen.findByRole("link", { name: "Open product stock" })).getAttribute("href"),
  ).toContain("/products/42");
  expect(created).toBe(true);
});

test.each([true, false])("barcode purchase follows tracking flags (%s)", async (tracking) => {
  let saved: Record<string, number> | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: tracking,
        });

      if (path === "/api/user/settings")
        return Response.json({ scan_mode_purchase_enabled: tracking ? "on" : 1 });

      if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

      if (path === "/api/stock/products/by-barcode/123/add") {
        saved = JSON.parse(String(init?.body));

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  mount();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText("Action")).toHaveProperty("value", "purchase"));

  if (tracking) {
    await screen.findByRole("option", { name: "Shelf" });
    await user.selectOptions(screen.getByLabelText("Location"), "1");
  } else {
    expect(screen.queryByRole("option", { name: "Open" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Transfer" })).toBeNull();
    expect(screen.queryByLabelText("Location")).toBeNull();
  }

  await user.type(screen.getByLabelText("Barcode"), "123");
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(saved).toEqual(tracking ? { amount: 1, location_id: 1 } : { amount: 1, price: 0 }),
  );
});
