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
