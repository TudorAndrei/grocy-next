import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Route } from "@/routes/shopping";

test("an imported shopping quantity displays its saved unit", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/objects/products") {
        return Response.json([{ id: 1, name: "Milk", qu_id_stock: 1, qu_id_purchase: 2 }]);
      }

      if (path === "/api/objects/quantity_units") {
        return Response.json([
          { id: 1, name: "Piece", name_plural: "Pieces" },
          { id: 2, name: "Case", name_plural: "Cases" },
        ]);
      }

      if (path === "/api/v2/shopping-lists/1") {
        return Response.json({
          id: 1,
          name: "Groceries",
          items: [{ id: 1, product_id: 1, amount: 2, qu_id: 2, done: false }],
        });
      }

      return Response.json([]);
    }),
  );
  const Shopping = Route.options.component;

  if (!Shopping) throw new Error("The shopping route has no page.");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Shopping />
    </QueryClientProvider>,
  );
  await screen.findByText("2 Cases");
});

test("a failed purchase leaves only unfinished shopping items for retry", async () => {
  let items = [
    { id: 1, product_id: 1, amount: 1, qu_id: 1, done: true },
    { id: 2, product_id: 2, amount: 1, qu_id: 1, done: true },
  ];

  let secondAttempts = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/objects/products") {
        return Response.json([
          { id: 1, name: "Milk", qu_id_stock: 1 },
          { id: 2, name: "Eggs", qu_id_stock: 1 },
        ]);
      }

      if (path === "/api/objects/quantity_units") {
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);
      }

      if (path === "/api/v2/shopping-lists/1") {
        return Response.json({ id: 1, name: "Groceries", items });
      }

      if (path === "/api/v2/shopping-lists/1/items/1/purchase") {
        items = items.filter((item) => item.id !== 1);

        return Response.json({ purchased: true, bookings: [] });
      }

      if (path === "/api/v2/shopping-lists/1/items/2/purchase") {
        secondAttempts += 1;

        if (secondAttempts === 1) {
          return Response.json({ error_message: "Purchase could not be saved" }, { status: 400 });
        }

        items = [];

        return Response.json({ purchased: true, bookings: [] });
      }

      return Response.json([]);
    }),
  );
  const Shopping = Route.options.component;

  if (!Shopping) throw new Error("The shopping route has no page.");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Shopping />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Put 2 in stock" }));
  await user.click(await screen.findByRole("button", { name: "Put 1 in stock" }));
  await screen.findByText(/The list is empty/);
  expect(secondAttempts).toBe(2);
});
