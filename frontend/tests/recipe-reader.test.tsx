import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { RecipeView } from "@/lib/recipe-view";

function fixture(): RecipeView {
  return {
    recipe_id: 1,
    need_fulfilled: false,
    need_fulfilled_with_shopping_list: false,
    missing_products_count: 1,
    cards: [
      {
        id: 1,
        name: "Main dish",
        desired_servings: 4,
        picture_file_name: null,
        preparation_html: "<p>Assemble the dish.</p>",
        costs: 2,
        calories: 200,
        prices_incomplete: false,
        need_fulfilled_with_shopping_list: false,
        ingredients: [
          {
            id: 101,
            product_id: 1,
            product_name: "Flour",
            product_id_effective: 1,
            active: true,
            due_score: 0,
            amount: 8,
            qu_id: 1,
            stock_amount: 2,
            missing_amount: 6,
            shopping_amount: 1,
            fulfilled: false,
            fulfilled_with_shopping_list: false,
            ingredient_group: "Base",
            product_group: "Dry goods",
            variable_amount: null,
            note_html: "Mix gently<br>Then rest",
            costs: 2,
            calories: 200,
          },
        ],
      },
      {
        id: 2,
        name: "Sauce",
        desired_servings: 3,
        picture_file_name: null,
        preparation_html: "<p><strong>Whisk</strong> until smooth.</p>",
        costs: 1,
        calories: 50,
        prices_incomplete: false,
        need_fulfilled_with_shopping_list: true,
        ingredients: [
          {
            id: 201,
            product_id: 2,
            product_name: "Salt",
            product_id_effective: 2,
            active: true,
            due_score: 0,
            amount: 1,
            qu_id: 1,
            stock_amount: 5,
            missing_amount: 0,
            shopping_amount: 0,
            fulfilled: true,
            fulfilled_with_shopping_list: true,
            ingredient_group: null,
            product_group: "Dry goods",
            variable_amount: "to taste",
            note_html: "",
            costs: 1,
            calories: 50,
          },
        ],
      },
    ],
  };
}

function mount(
  view: RecipeView,
  writes: Array<{ path: string; body: string }>,
  holdFirstSave = false,
) {
  vi.stubGlobal("scrollTo", vi.fn());
  let finish: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (init?.method === "PUT" || init?.method === "POST") {
        const body = String(init.body ?? "");
        writes.push({ path, body });

        if (path === "/api/objects/recipes/1") {
          const value: { desired_servings: number } = JSON.parse(body);

          if (holdFirstSave && !finish)
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          view.cards[0].desired_servings = value.desired_servings;
          view.cards[0].ingredients[0]!.amount = value.desired_servings * 2;
        }

        return new Response(null, { status: 204 });
      }

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "tester" }]);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/user/settings")
        return Response.json({
          night_mode: "off",
          recipes_show_ingredient_checkbox: "on",
          recipe_ingredients_group_by_product_group: "1",
        });

      if (path === "/api/v2/recipes/1/view") return Response.json(view);

      if (path === "/api/objects/products")
        return Response.json([
          { id: 1, name: "Flour", qu_id_stock: 1 },
          { id: 2, name: "Salt", qu_id_stock: 1 },
        ]);

      if (path === "/api/objects/quantity_units")
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

      if (path === "/api/objects/recipes")
        return Response.json(
          view.cards.map((card) => ({
            id: card.id,
            name: card.name,
            desired_servings: card.desired_servings,
            base_servings: 1,
          })),
        );

      if (path.startsWith("/api/v2/recipes/1/fulfillment"))
        return Response.json({
          recipe_id: 1,
          need_fulfilled: false,
          need_fulfilled_with_shopping_list: false,
          missing_products_count: 1,
          positions: [{ product_id: 1, amount_needed: 8, amount_available: 2, fulfilled: false }],
        });

      if (path.includes("nutrition/proposals") || path.startsWith("/api/v2/shopping-lists/"))
        return Response.json({ items: [] });

      return Response.json([]);
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/recipes/1"] }),
  });

  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { ...rendered, client, finishSave: () => finish?.() };
}

test("recipe reader uses saved servings, included cards, groups, and temporary ingredient marks", async () => {
  const writes: Array<{ path: string; body: string }> = [];
  const view = fixture();
  const app = mount(view, writes);
  const user = userEvent.setup();
  expect((await screen.findByRole<HTMLInputElement>("spinbutton")).value).toBe("4");
  const root = screen.getByRole("tab", { name: "Main dish" });
  expect(screen.getByRole("heading", { name: "Dry goods" })).toBeTruthy();
  expect(await screen.findByRole("link", { name: "8 Pieces Flour" })).toBeTruthy();

  const marked = screen.getByRole<HTMLInputElement>("checkbox", {
    name: "Mark this item as done: Flour",
  });

  await user.click(marked);
  expect(marked.checked).toBe(true);
  expect(marked.closest("li")?.dataset.done).toBe("true");
  root.focus();
  await user.keyboard("{ArrowRight}");
  const sauce = screen.getByRole("tab", { name: "Sauce" });
  expect(document.activeElement).toBe(sauce);
  expect(sauce.getAttribute("aria-selected")).toBe("true");
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByText("Whisk").tagName).toBe("STRONG");
  expect(within(panel).getByRole("link", { name: "to taste Salt" })).toBeTruthy();
  await user.keyboard("{Home}");
  expect(marked.checked).toBe(true);
  await user.click(screen.getByRole("button", { name: "Expand to fullscreen" }));
  expect(screen.getByRole("dialog", { name: "Main dish" })).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(marked.checked).toBe(true);
  expect(writes).toEqual([]);
  app.unmount();
  app.client.clear();
  const reloaded = mount(view, writes);
  expect(
    (
      await screen.findByRole<HTMLInputElement>("checkbox", {
        name: "Mark this item as done: Flour",
      })
    ).checked,
  ).toBe(false);
  reloaded.unmount();
  reloaded.client.clear();
});

test("serving changes are saved in order before native partial consumption", async () => {
  const writes: Array<{ path: string; body: string }> = [];
  const app = mount(fixture(), writes, true);
  const user = userEvent.setup();
  const servings = await screen.findByRole<HTMLInputElement>("spinbutton");
  const cook = screen.getByRole<HTMLButtonElement>("button", { name: "Cook and consume" });
  expect(cook.disabled).toBe(false);
  await user.clear(servings);
  await user.type(servings, "2");
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(cook.disabled).toBe(true);
  await user.clear(servings);
  await user.type(servings, "5");
  // Let the debounce queue the second value while the first request is pending.
  await act(() => new Promise((resolve) => window.setTimeout(resolve, 350)));
  expect(writes).toHaveLength(1);
  await act(async () => app.finishSave());
  await waitFor(() => expect(cook.disabled).toBe(false));
  expect(servings.value).toBe("5");
  expect(writes.slice(0, 2)).toEqual([
    { path: "/api/objects/recipes/1", body: '{"desired_servings":2}' },
    { path: "/api/objects/recipes/1", body: '{"desired_servings":5}' },
  ]);
  await user.click(cook);
  await waitFor(() => expect(writes.at(-1)?.path).toBe("/api/recipes/1/consume"));
  app.unmount();
  app.client.clear();
});
