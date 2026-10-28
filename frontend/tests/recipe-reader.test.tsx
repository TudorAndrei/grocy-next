import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { RecipeListItem, RecipeView } from "@/lib/recipe-view";
import { pictureBytes } from "./fixtures/picture";

afterEach(() => window.history.replaceState(null, "", "/"));

beforeEach(() => {
  for (const method of ["showModal", "close"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method);
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
    onTestFinished(() => {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    });
  }
});

function fixture(): RecipeView {
  return {
    recipe_id: 1,
    need_fulfilled: false,
    need_fulfilled_with_shopping_list: false,
    missing_products_count: 1,
    missing_ingredients: [{ product_id: 1, product_name: "Flour" }],
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
    mealPlanEnabled?: boolean;
    failMealOnce?: boolean;
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
  let copiedView: RecipeView | undefined;
  let failMeal = options.failMealOnce;

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

        if (path === "/api/objects/meal_plan") {
          if (failMeal) {
            failMeal = false;

            return Response.json({ error_message: "Meal save failed" }, { status: 400 });
          }

          return Response.json({ created_object_id: "99" });
        }

        if (path.endsWith("/copy")) {
          const source = view.cards.find((card) => path === `/api/recipes/${card.id}/copy`)!;
          copiedView = {
            ...view,
            recipe_id: 7,
            cards: [{ ...source, id: 7, name: `Copy of ${source.name}` }],
          };

          return Response.json({ created_object_id: "7" });
        }

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

      if (path === "/api/system/config")
        return Response.json(
          options.mealPlanEnabled === false ? { FEATURE_FLAG_RECIPES_MEALPLAN: false } : {},
        );

      if (path === "/api/objects/meal_plan_sections?order=sort_number:asc")
        return Response.json([
          { id: 2, name: "Breakfast" },
          { id: 1, name: "Dinner" },
        ]);

      if (path === "/api/user/settings")
        return Response.json({
          night_mode: "off",
          recipes_show_ingredient_checkbox: "on",
          recipe_ingredients_group_by_product_group: "1",
          recipes_show_list_side_by_side: options.sideBySide ?? true,
        });

      if (path === "/api/v2/recipes/overview")
        return Response.json(
          options.overviewRows ??
            (copiedView
              ? [...overview, { ...overview[1]!, id: 7, name: copiedView.cards[0].name }]
              : overview),
        );

      if (path === "/api/v2/recipes/1/view") {
        if (options.holdRecipeView)
          await new Promise<void>((resolve) => {
            finishView = resolve;
          });

        return Response.json(view);
      }

      if (path === "/api/v2/recipes/2/view")
        return Response.json({ ...view, recipe_id: 2, cards: [view.cards[1]] });

      if (path === "/api/v2/recipes/7/view") return Response.json(copiedView);

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

test.each([true, false])(
  "copying an included recipe selects its returned ID with side-by-side %s",
  async (sideBySide) => {
    const writes: Array<{ path: string; body: string }> = [];
    const app = mount(fixture(), writes, false, { path: "/recipes?search=Main", sideBySide });
    const user = userEvent.setup();

    if (!sideBySide) await user.click(await screen.findByRole("link", { name: "Main dish" }));
    await user.click(await screen.findByRole("tab", { name: "Sauce" }));
    await user.click(screen.getByRole("button", { name: "Copy recipe" }));

    if (sideBySide)
      expect(await screen.findByRole("heading", { level: 1, name: "Copy of Sauce" })).toBeTruthy();
    const copy = await screen.findByRole("link", { name: "Copy of Sauce" });
    await waitFor(() => expect(copy.getAttribute("aria-current")).toBe("true"));
    expect(app.router.history.location.pathname).toBe("/recipes");
    expect(new URLSearchParams(app.router.history.location.search).get("recipe")).toBe("7");
    expect(new URLSearchParams(app.router.history.location.search).has("search")).toBe(false);
    expect(writes).toEqual([{ path: "/api/recipes/2/copy", body: "{}" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    app.unmount();
    app.client.clear();
  },
);

test("recipe printing leaves full-screen mode before it calls the browser printer", async () => {
  const app = mount(fixture(), []);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Expand to fullscreen" }));
  expect(document.body.classList.contains("fullscreen-card")).toBe(true);

  const print = vi.spyOn(window, "print").mockImplementation(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("navigation", { name: "Primary" }).closest("[inert]")).toBeNull();
  });

  await user.click(screen.getByRole("button", { name: "Print" }));
  expect(print).toHaveBeenCalledTimes(1);
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
  const confirmation = await screen.findByRole("dialog", { name: "Cook and consume" });
  expect(within(confirmation).getByText(/only partially in stock/)).toBeTruthy();
  expect(writes).toHaveLength(2);
  await user.click(within(confirmation).getByRole("button", { name: "No" }));
  expect(writes).toHaveLength(2);
  await user.click(cook);
  await user.click(
    within(await screen.findByRole("dialog", { name: "Cook and consume" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(writes.at(-1)?.path).toBe("/api/recipes/1/consume"));
  app.unmount();
  app.client.clear();
});

test("recipe shopping confirmation preserves row choices and sends excluded product IDs", async () => {
  const writes: Array<{ path: string; body: string }> = [];
  const view = fixture();
  view.missing_products_count = 2;
  view.missing_ingredients.push(
    { product_id: 2, product_name: "Salt" },
    { product_id: 1, product_name: "Flour" },
  );
  view.cards[0].ingredients.push({
    ...view.cards[0].ingredients[0]!,
    id: 102,
    amount: 5,
    missing_amount: 3,
  });
  view.cards[1]!.need_fulfilled_with_shopping_list = false;
  Object.assign(view.cards[1]!.ingredients[0]!, {
    amount: 3,
    stock_amount: 0,
    missing_amount: 3,
    fulfilled: false,
    fulfilled_with_shopping_list: false,
    variable_amount: null,
  });
  const app = mount(view, writes);
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: "Add missing to list" });
  await user.click(button);
  const dialog = await screen.findByRole("dialog", { name: "Add missing to list" });
  const rows = within(dialog).getAllByRole<HTMLInputElement>("checkbox");
  expect(rows.map((row) => row.checked)).toEqual([true, true, true]);
  expect(rows.map((row) => row.labels?.[0]?.textContent)).toEqual(["Flour", "Salt", "Flour"]);
  expect(writes).toEqual([]);
  await user.click(rows[2]!);
  expect(rows.map((row) => row.checked)).toEqual([true, true, false]);
  await user.click(within(dialog).getByRole("button", { name: "No" }));
  expect(writes).toEqual([]);
  await user.click(button);
  const reopened = await screen.findByRole("dialog", { name: "Add missing to list" });
  expect(
    within(reopened)
      .getAllByRole<HTMLInputElement>("checkbox")
      .every((row) => row.checked),
  ).toBe(true);
  await user.click(within(reopened).getAllByRole("checkbox")[2]!);
  await user.click(within(reopened).getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(writes).toEqual([
      {
        path: "/api/recipes/1/add-not-fulfilled-products-to-shoppinglist",
        body: '{"excludedProductIds":[1]}',
      },
    ]),
  );
  app.unmount();
  app.client.clear();
});

test("recipe meal planning uses local today, retains choices, and saves changed recipe fields", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2027, 3, 4, 0, 15));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const writes: Array<{ path: string; body: string }> = [];
  const app = mount(fixture(), writes, false, { path: "/recipes" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add Main dish to meal plan" }));
  let dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });
  await waitFor(() =>
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Section").value).toBe("2"),
  );
  const day = within(dialog).getByLabelText<HTMLInputElement>("Day");
  expect(day.value).toBe("2027-04-04");
  expect(within(dialog).getByLabelText<HTMLSelectElement>("Recipe").value).toBe("1");
  const servings = within(dialog).getByLabelText<HTMLInputElement>("Servings");
  expect(servings.value).toBe("1");
  expect(document.activeElement).toBe(servings);
  expect(new URLSearchParams(app.router.history.location.search).has("recipe")).toBe(false);
  await user.clear(servings);
  await user.type(servings, "0.5");
  await user.selectOptions(within(dialog).getByLabelText("Section"), "1");
  await user.selectOptions(within(dialog).getByLabelText("Recipe"), "2");
  fireEvent.change(day, { target: { value: "2027-04-07" } });
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(writes).toEqual([]);
  await user.click(screen.getByRole("tab", { name: "Gallery" }));
  const card = (await screen.findByRole("link", { name: "Main dish" })).closest("li")!;
  await user.click(within(card).getByRole("button", { name: "Add to meal plan" }));
  dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });
  expect(within(dialog).getByLabelText<HTMLInputElement>("Day").value).toBe("2027-04-04");
  expect(within(dialog).getByLabelText<HTMLSelectElement>("Recipe").value).toBe("1");
  expect(within(dialog).getByLabelText<HTMLInputElement>("Servings").value).toBe("0.5");
  expect(within(dialog).getByLabelText<HTMLSelectElement>("Section").value).toBe("1");
  fireEvent.change(within(dialog).getByLabelText("Day"), { target: { value: "" } });
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(writes).toEqual([]);
  fireEvent.change(within(dialog).getByLabelText("Day"), { target: { value: "2027-04-07" } });
  await user.selectOptions(within(dialog).getByLabelText("Recipe"), "2");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull(),
  );
  expect(writes.map((write) => ({ path: write.path, body: JSON.parse(write.body) }))).toEqual([
    {
      path: "/api/objects/meal_plan",
      body: {
        day: "2027-04-07",
        recipe_id: "2",
        recipe_servings: "0.5",
        section_id: "1",
        type: "recipe",
      },
    },
  ]);
  expect(await screen.findByText("Successfully added the recipe to the meal plan")).toBeTruthy();
  app.unmount();
  app.client.clear();
});

test("recipe meal planning retains failed input and releases full-screen locks on removal", async () => {
  const writes: Array<{ path: string; body: string }> = [];
  const app = mount(fixture(), writes, false, { failMealOnce: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Expand to fullscreen" }));
  const button = screen.getByRole("button", { name: "Add to meal plan" });
  await user.click(button);
  let dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });
  await waitFor(() =>
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(
      false,
    ),
  );
  const input = within(dialog).getByLabelText<HTMLInputElement>("Servings");
  await user.clear(input);
  await user.type(input, "3");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByText("Meal save failed")).toBeTruthy();
  expect(input.value).toBe("3");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Add meal plan entry" })).toBeNull(),
  );
  expect(writes).toHaveLength(2);
  expect(
    writes.map((write) => {
      const body: { recipe_servings: string } = JSON.parse(write.body);

      return body.recipe_servings;
    }),
  ).toEqual(["3", "3"]);
  expect(screen.getByRole("dialog", { name: "Main dish" })).toBeTruthy();
  expect(document.activeElement).toBe(button);
  await user.click(button);
  dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });
  expect(within(dialog).getByLabelText<HTMLInputElement>("Servings").value).toBe("3");
  app.unmount();
  app.client.clear();
  expect(document.body.style.overflow).toBe("");
  expect(document.body.classList.contains("fullscreen-card")).toBe(false);
});

test("the meal-plan feature flag controls recipe planning actions", async () => {
  const app = mount(fixture(), [], false, { path: "/recipes", mealPlanEnabled: false });
  await screen.findByRole("heading", { level: 1, name: "Main dish" });
  expect(screen.queryByRole("button", { name: "Add to meal plan" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add Main dish to meal plan" })).toBeNull();
  app.unmount();
  app.client.clear();
});
