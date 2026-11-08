import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ProductCard } from "@/components/ProductOverview";
import { LocalizationProvider } from "@/lib/i18n";
import type { PriceHistory, ProductOverviewData } from "@/lib/product-overview";
import { productOverview } from "./fixtures/product-overview";

function mount() {
  const source: ProductOverviewData = structuredClone(productOverview);
  source.product.description = "";
  let historyReads = 0;
  let holdProducts = false;
  let holdHistory = false;
  let failHistory = false;
  const historyRows: PriceHistory = [];

  const products: Array<{
    id: number;
    release: () => void;
    signal: AbortSignal | null | undefined;
  }> = [];

  const histories: Array<() => void> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/user/settings") return Response.json({ stock_decimal_places_amounts: 2 });

      if (/^\/api\/stock\/products\/[78]$/.test(path)) {
        const id = path.endsWith("7") ? 7 : 8;

        const response = Response.json(
          id === 7
            ? source
            : {
                ...source,
                product: { ...source.product, id: 8, name: "Tea" },
                stock_amount: 8,
              },
        );

        if (holdProducts)
          await new Promise<void>((resolve) => {
            products.push({ id, release: resolve, signal: init?.signal });
          });

        return response;
      }

      if (/^\/api\/stock\/products\/[78]\/price-history$/.test(path)) {
        historyReads++;

        const response = failHistory
          ? Response.json({ error_message: "History unavailable" }, { status: 503 })
          : Response.json(historyRows);

        if (holdHistory)
          await new Promise<void>((resolve) => {
            histories.push(resolve);
          });

        return response;
      }

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "test",
          direction: "ltr",
          languages: ["test"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": "nplurals=3; plural=n==1?0:n==2?1:2;",
            messages: { "": {} },
          },
        });

      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Card() {
    const [productId, setProductId] = useState(7);

    return (
      <LocalizationProvider>
        <button onClick={() => setProductId(7)}>Select coffee</button>
        <button onClick={() => setProductId(8)}>Select tea</button>
        <ProductCard
          productId={productId}
          embedded={false}
          expanded={false}
          onExpandedChange={() => {}}
          onReturn={async () => {}}
        />
      </LocalizationProvider>
    );
  }

  const root = createRootRoute({ component: Card });

  const mounted = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider
          router={createRouter({
            routeTree: root,
            history: createMemoryHistory({ initialEntries: ["/"] }),
          })}
        />
      </QueryClientProvider>
    </StrictMode>,
  );

  return {
    source,
    historyReads: () => historyReads,
    holdProducts: () => {
      holdProducts = true;
    },
    holdHistory: () => {
      holdHistory = true;
    },
    setHistoryFailure: (failed: boolean) => {
      failHistory = failed;
    },
    historyRows,
    products,
    histories,
    refresh: async () => {
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["product-overview", 7] });
      });
    },
    unmount: () => {
      mounted.unmount();
      client.clear();
    },
  };
}

function fact(label: string) {
  const field = screen.getByText(label, { selector: "dt" }).nextElementSibling;

  if (!field) throw new Error(`Missing product-card field: ${label}`);

  return field;
}

test.each([
  { active: 1, amount: 2.123456, expected: "2.12 2.123 many" },
  { active: 0, amount: 2, expected: "2 2 fallback" },
  { active: 1, amount: 0, expected: "0 0 many" },
  { active: 1, amount: -2, expected: "-2 2 pair" },
  { active: 1, amount: 1, expected: "1 1 unit" },
])(
  "product-card quantities use the browser quantity domain ($active, $amount)",
  async ({ active, amount, expected }) => {
    const app = mount();
    app.source.quantity_unit_stock = {
      name: "%s unit",
      name_plural: "%s fallback",
      plural_forms: "%s pair\n%s many",
      active,
    };
    app.source.stock_amount = amount;
    app.source.stock_amount_aggregated = 1;
    await screen.findByRole("heading", { name: "Coffee" });
    await waitFor(() => expect(fact("Stock amount").firstElementChild?.textContent).toBe(expected));
    expect(
      fact("Stock amount").querySelector(".product-overview-aggregate")?.textContent,
    ).toContain("1 1 unit");
    app.unmount();
  },
);

test("a bad own-stock unit retains later fields while writing the new raw amount", async () => {
  const app = mount();
  await screen.findByText("2.5 Pieces");
  await waitFor(() => expect(app.historyReads()).toBe(1));
  app.source.product.name = "Broken format";
  app.source.quantity_unit_stock.name_plural = "broken %";
  app.source.stock_amount = 3.123456;
  app.source.stock_value = 99;
  app.source.stock_amount_opened = 8;
  await app.refresh();
  await screen.findByRole("heading", { name: "Broken format" });
  expect(fact("Stock amount").firstElementChild?.textContent).toBe("3.123456 Pieces");
  expect(fact("Stock amount").textContent).toContain("1 opened");
  expect(fact("Stock amount").textContent).toContain("12.5 Pieces");
  expect(fact("Stock value").textContent).toBe("$12.50");
  expect(app.historyReads()).toBe(1);
  app.source.quantity_unit_stock.name_plural = "Pieces";
  await app.refresh();
  await screen.findByText("3.12 Pieces");
  expect(fact("Stock value").textContent).toBe("$99.00");
  await waitFor(() => expect(app.historyReads()).toBe(2));
  app.unmount();
});

test("overlapping product selections apply replies in native completion order", async () => {
  const app = mount();
  await screen.findByText("2.5 Pieces");
  app.holdProducts();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Select tea" }));
  await waitFor(() => expect(app.products).toHaveLength(1));
  app.source.stock_amount = 3;
  await user.click(screen.getByRole("button", { name: "Select coffee" }));
  await waitFor(() => expect(app.products).toHaveLength(2));
  await act(async () => app.products[1]?.release());
  await screen.findByText("3 Pieces");
  await act(async () => app.products[0]?.release());
  await screen.findByRole("heading", { name: "Tea" });
  expect(fact("Stock amount").firstElementChild?.textContent).toBe("8 Pieces");
  app.unmount();
});

test("price-history replies retain their request's conversion factor and completion order", async () => {
  const app = mount();
  await screen.findByText("No price history available");
  app.holdHistory();
  app.source.stock_amount = 3;
  app.source.qu_conversion_factor_price_to_stock = 2;
  app.historyRows.push({ date: "2026-10-21", price: 3, shopping_location: { name: "Old store" } });
  await app.refresh();
  await waitFor(() => expect(app.histories).toHaveLength(1));
  app.source.stock_amount = 4;
  app.source.qu_conversion_factor_price_to_stock = 6;
  app.historyRows.splice(0, 1, {
    date: "2026-10-22",
    price: 5,
    shopping_location: { name: "New store" },
  });
  await app.refresh();
  await waitFor(() => expect(app.histories).toHaveLength(2));
  await act(async () => app.histories[1]?.());
  const table = await screen.findByRole("table", { name: "Price history" });
  await within(table).findByText("$30.00");
  await act(async () => app.histories[0]?.());
  await within(table).findByText("Old store");
  expect(within(table).getByText("$6.00")).toBeTruthy();
  expect(fact("Stock amount").firstElementChild?.textContent).toBe("4 Pieces");
  app.unmount();
});

test("a failed history refresh retains prior prices and retry replaces them after recovery", async () => {
  const app = mount();
  app.historyRows.push({ date: "2026-10-21", price: 2, shopping_location: { name: "Old store" } });
  const history = await screen.findByRole("region", { name: "Price history" });
  await within(history).findByText("$12.00");
  app.setHistoryFailure(true);
  app.source.stock_amount = 4;
  await app.refresh();
  await within(history).findByText("History unavailable");
  expect(within(history).getByText("$12.00")).toBeTruthy();
  app.setHistoryFailure(false);
  app.historyRows.splice(0, 1, {
    date: "2026-10-22",
    price: 5,
    shopping_location: { name: "New store" },
  });
  await userEvent.setup().click(within(history).getByRole("button", { name: "Retry" }));
  await within(history).findByText("$30.00");
  expect(within(history).queryByText("Old store")).toBeNull();
  expect(within(history).queryByText("History unavailable")).toBeNull();
  app.unmount();
});

test("an aggregate-unit error stops at its native field and retains the prior opened amount", async () => {
  const app = mount();
  await screen.findByText("2.5 Pieces");
  await waitFor(() => expect(app.historyReads()).toBe(1));
  app.source.quantity_unit_stock = {
    name: "%s bag",
    name_plural: "bags",
    plural_forms: "%s pair\nbroken %",
    active: 1,
  };
  app.source.stock_amount = 1;
  app.source.stock_amount_aggregated = 12.34567;
  app.source.stock_amount_opened = 9;
  app.source.stock_value = 88.12;
  app.source.last_purchased = "2026-10-23";
  await app.refresh();
  await waitFor(() => expect(fact("Stock amount").firstElementChild?.textContent).toBe("1 1 bag"));
  expect(fact("Stock amount").querySelector(".product-overview-aggregate")?.textContent).toContain(
    "12.34567 Pieces",
  );
  expect(fact("Stock amount").textContent).toContain("1 opened");
  expect(fact("Stock value").textContent).toBe("88.12");
  expect(fact("Last purchased").firstElementChild?.textContent).toBe("2026-10-23");
  expect(app.historyReads()).toBe(1);
  app.unmount();
});

test("a first-read unit error leaves later card values blank and actions disabled", async () => {
  const app = mount();
  app.source.quantity_unit_stock.name_plural = "broken %";
  await screen.findByRole("heading", { name: "Coffee" });
  expect(fact("Stock amount").firstElementChild?.textContent).toBe("2.5 ");
  expect(fact("Stock value").textContent).toBe("");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Add to shopping list" }).disabled,
  ).toBe(true);
  expect(app.historyReads()).toBe(0);
  app.unmount();
});

test("product-card refresh retains the native empty-location and average-price tooltip behavior", async () => {
  const app = mount();
  await screen.findByText("$1.50 per Box");
  app.source.location = null;
  app.source.avg_price = null;
  app.source.last_price = null;
  await app.refresh();
  await waitFor(() => expect(fact("Average price").textContent).toBe("Unknown"));
  expect(fact("Average price").firstElementChild?.getAttribute("title")).toBe("$0.25 per Piece");
  expect(fact("Last price").firstElementChild?.hasAttribute("title")).toBe(false);
  expect(fact("Default location").textContent).toBe("Shelf");
  app.unmount();
});
