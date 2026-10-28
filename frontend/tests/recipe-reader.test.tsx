import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { RecipeListItem, RecipeView } from "@/lib/recipe-view";
import { pictureBytes } from "./fixtures/picture";

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
  options: {
    path?: string;
    sideBySide?: boolean;
    holdRecipeView?: boolean;
    overviewRows?: RecipeListItem[];
  } = {},
) {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:gallery";
      static revokeObjectURL = () => undefined;
    },
  );
  let finish: (() => void) | undefined;
  let finishView: (() => void) | undefined;

  const overview: RecipeListItem[] = [
    {
      id: 1,
      name: "Main dish",
      picture_file_name: "main.png",
      desired_servings: 4,
      due_score: 20,
      missing_products_count: 1,
      product_names: "Flour, Salt",
      stock_status: "notenoughinstock",
    },
    {
      id: 2,
      name: "Sauce",
      picture_file_name: null,
      desired_servings: 3,
      due_score: 0,
      missing_products_count: 0,
      product_names: "Salt",
      stock_status: "Xenoughinstock",
    },
    {
      id: 3,
      name: "Zucchini 23 stew",
      picture_file_name: null,
      desired_servings: 1,
      due_score: 1,
      missing_products_count: 1,
      product_names: "Flour",
      stock_status: "enoughinstockwithshoppinglist",
    },
  ];

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
          recipes_show_list_side_by_side: options.sideBySide ?? true,
        });

      if (path === "/api/v2/recipes/overview")
        return Response.json(options.overviewRows ?? overview);

      if (path === "/api/v2/recipes/1/view") {
        if (options.holdRecipeView)
          await new Promise<void>((resolve) => {
            finishView = resolve;
          });

        return Response.json(view);
      }

      if (path === "/api/v2/recipes/2/view")
        return Response.json({ ...view, recipe_id: 2, cards: [view.cards[1]] });

      if (path.startsWith("/api/files/recipepictures/"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

      if (path === "/api/objects/products")
        return Response.json([
          { id: 1, name: "Flour", qu_id_stock: 1 },
          { id: 2, name: "Salt", qu_id_stock: 1 },
        ]);

      if (path === "/api/objects/quantity_units")
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

      if (path === "/api/objects/recipes")
        return Response.json(
          [...view.cards, { id: 3, name: "Zucchini 23 stew", desired_servings: 1 }].map((card) => ({
            id: card.id,
            name: card.name,
            desired_servings: card.desired_servings,
            base_servings: 1,
            type: "normal",
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
    history: createMemoryHistory({ initialEntries: [options.path ?? "/recipes/1"] }),
  });

  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    ...rendered,
    client,
    router,
    finishSave: () => finish?.(),
    finishView: () => finishView?.(),
  };
}

test("recipe overview searches ingredient names, filters three stock states, and selects inline cards", async () => {
  const app = mount(fixture(), [], false, { path: "/recipes" });
  const user = userEvent.setup();
  expect(await screen.findByRole("heading", { level: 1, name: "Main dish" })).toBeTruthy();
  const catalog = screen.getByRole("region", { name: "Recipe list" });
  await within(catalog).findByRole("link", { name: "Zucchini 23 stew" });

  const names = () =>
    within(catalog)
      .getAllByRole("link")
      .map((link) => link.textContent);

  expect(names()).toEqual(["Main dish", "Sauce", "Zucchini 23 stew"]);
  await user.selectOptions(
    within(catalog).getByRole("combobox", { name: "Status" }),
    "enoughinstockwithshoppinglist",
  );
  await waitFor(() => expect(names()).toEqual(["Zucchini 23 stew"]));
  expect(new URLSearchParams(app.router.history.location.search).get("status")).toBe(
    "enoughinstockwithshoppinglist",
  );
  await user.click(within(catalog).getByRole("button", { name: "Clear filter" }));
  await user.type(
    within(catalog).getByRole("searchbox", { name: "Search recipes" }),
    '"Main dish" Salt',
  );
  await waitFor(() => expect(names()).toEqual(["Main dish"]));
  await user.click(within(catalog).getByRole("button", { name: "Clear filter" }));
  await user.click(within(catalog).getByRole("button", { name: "Due score: Sort" }));
  expect(names()).toEqual(["Sauce", "Zucchini 23 stew", "Main dish"]);
  await user.click(within(catalog).getByRole("link", { name: "Sauce" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Sauce" })).toBeTruthy();
  expect(new URLSearchParams(app.router.history.location.search).get("recipe")).toBe("2");
  await user.click(within(catalog).getByRole("tab", { name: "Gallery" }));
  expect(await within(catalog).findByRole("img", { name: "Main dish picture" })).toBeTruthy();
  expect(localStorage.getItem("recipes_last_tab_id")).toBe("gallery-tab");
  app.unmount();
  app.client.clear();
});

test("the saved gallery opens a full-screen card when side-by-side display is disabled", async () => {
  localStorage.setItem("recipes_last_tab_id", "gallery-tab");
  const app = mount(fixture(), [], false, { path: "/recipes?search=Main", sideBySide: false });
  const user = userEvent.setup();
  const link = await screen.findByRole("link", { name: "Main dish" });
  await user.click(link);
  const dialog = await screen.findByRole("dialog", { name: "Main dish" });
  await user.click(within(dialog).getByRole("link", { name: "Recipes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.classList.contains("fullscreen-card")).toBe(false);
  expect(document.activeElement).toBe(link);
  expect(new URLSearchParams(app.router.history.location.search).get("search")).toBe("Main");
  expect(screen.getByRole("tab", { name: "Gallery" }).getAttribute("aria-selected")).toBe("true");
  app.unmount();
  app.client.clear();
});

test("closing a loading recipe card prevents a late response from opening it again", async () => {
  const app = mount(fixture(), [], false, {
    path: "/recipes",
    sideBySide: false,
    holdRecipeView: true,
  });

  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Main dish" }));
  expect(await screen.findByRole("dialog", { name: "Recipe" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(async () => app.finishView());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("");
  app.unmount();
  app.client.clear();
});

test("legacy recipe query parameters restore gallery, selected recipe, status, and numeric search", async () => {
  const app = mount(fixture(), [], false, {
    path: "/recipes?tab=gallery&recipe=2&search=Salt&status=Xenoughinstock",
  });

  const catalog = await screen.findByRole("region", { name: "Recipe list" });
  await within(catalog).findByRole("link", { name: "Sauce" });
  expect(
    within(catalog)
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label")),
  ).toEqual(["Sauce"]);
  expect(await screen.findByRole("heading", { level: 1, name: "Sauce" })).toBeTruthy();
  await act(async () => app.router.history.push("/recipes?search=23"));
  await waitFor(() =>
    expect(
      within(catalog)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Zucchini 23 stew"]),
  );
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search recipes" }).value).toBe(
    "23",
  );
  await act(async () => app.router.history.push("/recipes?embedded=0&recipe=2"));
  expect(await screen.findByRole("dialog", { name: "Sauce" })).toBeTruthy();
  app.unmount();
  app.client.clear();
});

test("an empty embedded recipe view shows the empty message", async () => {
  const app = mount(fixture(), [], false, { path: "/recipes?embedded", overviewRows: [] });
  expect(await screen.findByText("No recipes yet.")).toBeTruthy();
  app.unmount();
  app.client.clear();
});

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
