import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { writeApiConfig } from "@/lib/config";
import { pictureBytes } from "./fixtures/picture";

beforeEach(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidePopover");
  Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value() {} });
  onTestFinished(() => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "hidePopover", descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
  });
});

function mount(path: string) {
  writeApiConfig({ baseUrl: "/house", apiKey: "code-key" });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:code";
      static revokeObjectURL = () => {};
    },
  );

  const product = {
    id: 17,
    name: "Code product",
    qu_id_stock: 1,
    qu_id_purchase: 1,
    location_id: 1,
  };

  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = String(input).replace(/^\/house/, "");

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/system/config")
      return Response.json({
        FEATURE_FLAG_LABEL_PRINTER: true,
        LABEL_PRINTER_RUN_SERVER: false,
        LABEL_PRINTER_WEBHOOK: "http://printer.test/label",
      });

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path === "/api/user/settings") return Response.json({});

    if (path === "/api/objects/products") return Response.json([product]);

    if (path === "/api/objects/quantity_units") return Response.json([{ id: 1, name: "Piece" }]);

    if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

    if (path === "/api/stock")
      return Response.json([{ product_id: 17, product, amount: 2, amount_opened: 0 }]);

    if (path.startsWith("/api/stock/volatile")) return Response.json({ missing_products: [] });

    if (path === "/api/chores") return Response.json([{ id: 17, chore_name: "Code chore" }]);

    if (path === "/api/batteries")
      return Response.json([{ id: 17, battery: { name: "Code battery" } }]);

    if (path === "/api/v2/recipes/overview")
      return Response.json([
        {
          id: 17,
          name: "Code recipe",
          picture_file_name: null,
          desired_servings: 1,
          due_score: 0,
          missing_products_count: 0,
          product_names: "",
          stock_status: "Xenoughinstock",
        },
      ]);

    if (path === "/api/stock/products/17/entries")
      return Response.json([
        { id: 991, amount: 2, location_id: 1, best_before_date: "2099-01-01", open: 0 },
      ]);

    if (path.startsWith("/api/objects/stock_log"))
      return Response.json([
        { id: 1, product_id: 17, amount: 2, transaction_type: "purchase", undone: 0 },
      ]);

    if (path.endsWith("/nutrition"))
      return Response.json({ error_message: "Not found" }, { status: 404 });

    if (path.includes("/shopping-lists/") || path.includes("nutrition/proposals"))
      return Response.json({ items: [] });

    if (path.endsWith("/printlabel")) return Response.json({ grocycode: "test-label" });

    if (path.includes("/grocycode?download=true"))
      return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

    if (path === "http://printer.test/label") return new Response(null, { status: 204 });

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return fetchMock;
}

test.each([
  { tab: "Products", type: "Product", path: "/api/stock/products/17/printlabel" },
  { tab: "Recipes", type: "Recipe", path: "/api/recipes/17/printlabel" },
  { tab: "Chores", type: "Chore", path: "/api/chores/17/printlabel" },
  { tab: "Batteries", type: "Battery", path: "/api/batteries/17/printlabel" },
])("the $tab label panel sends a printer request", async ({ tab, type, path }) => {
  const fetchMock = mount("/labels");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: tab }));
  const panel = screen.getByRole("tabpanel", { name: tab });
  const control = await within(panel).findByRole("button", { name: "Grocycode" });
  const popover = document.getElementById(control.getAttribute("aria-controls")!)!;
  await user.click(
    within(popover).getByRole("button", {
      name: `Print ${type} Grocycode on label printer`,
      hidden: true,
    }),
  );
  await screen.findByText("Label request sent");
  expect(fetchMock.mock.calls.filter(([url]) => String(url) === `/house${path}`)).toHaveLength(1);
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url) === "http://printer.test/label"),
  ).toHaveLength(1);
});

test.each([
  { page: "/products", name: "Code product Grocycode", target: "/api/v2/products/17/grocycode" },
  { page: "/products/17", name: "Grocycode", target: "/api/v2/products/17/grocycode" },
  { page: "/stock", name: "Code product Grocycode", target: "/api/v2/products/17/grocycode" },
  { page: "/journal", name: "Code product Grocycode", target: "/api/v2/products/17/grocycode" },
  { page: "/chores", name: "Code chore Grocycode", target: "/api/v2/chores/17/grocycode" },
  { page: "/batteries", name: "Code battery Grocycode", target: "/api/v2/batteries/17/grocycode" },
  {
    page: "/products/17",
    name: "Stock entry 991 Grocycode",
    target: "/api/v2/stock/entries/991/grocycode",
  },
])("$page downloads the selected $name", async ({ page, name, target }) => {
  const fetchMock = mount(page);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const control = await screen.findByRole("button", { name });
  const popover = document.getElementById(control.getAttribute("aria-controls")!)!;
  await userEvent
    .setup()
    .click(within(popover).getByRole("button", { name: /Download .* Grocycode/, hidden: true }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());

  const request = fetchMock.mock.calls.find(
    ([url]) => String(url) === `/house${target}?download=true`,
  );

  expect(request).toBeTruthy();
  expect(new Headers(request?.[1]?.headers).get("GROCY-API-KEY")).toBe("code-key");
});
