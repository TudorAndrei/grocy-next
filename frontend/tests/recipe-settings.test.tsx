import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { UserSettings } from "@/lib/types";
import type { RecipeView } from "@/lib/recipe-view";

const labels = {
  side: "Show the recipe list and the recipe side by side",
  checkbox: "Show a little checkbox next to each ingredient to mark it as done",
  group: "Group ingredients by their product group",
};

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function mountSettings({
  values = {},
  enabled = true,
  fail = false,
  holdFirst = false,
  failRead = false,
}: {
  values?: UserSettings;
  enabled?: boolean;
  fail?: boolean;
  holdFirst?: boolean;
  failRead?: boolean;
} = {}) {
  const settings: UserSettings = {
    recipes_show_list_side_by_side: true,
    recipes_show_ingredient_checkbox: false,
    recipe_ingredients_group_by_product_group: false,
    stock_decimal_places_amounts: 2,
    ...values,
  };

  const writes: Array<{ key: string; value: boolean }> = [];
  const hold = deferred();
  let readFailure = failRead;

  const view: RecipeView = {
    recipe_id: 1,
    need_fulfilled: true,
    need_fulfilled_with_shopping_list: true,
    missing_products_count: 0,
    missing_ingredients: [],
    cards: [
      {
        id: 1,
        name: "Bread",
        desired_servings: 1,
        picture_file_name: null,
        preparation_html: "<p>Mix.</p>",
        costs: 1,
        calories: 120,
        prices_incomplete: false,
        need_fulfilled_with_shopping_list: true,
        ingredients: [
          {
            id: 11,
            product_id: 2,
            product_name: "Flour",
            product_id_effective: 2,
            active: true,
            due_score: 0,
            amount: 2,
            qu_id: 1,
            stock_amount: 3,
            missing_amount: 0,
            shopping_amount: 0,
            fulfilled: true,
            fulfilled_with_shopping_list: true,
            ingredient_group: "Base",
            product_group: "Dry goods",
            variable_amount: null,
            note_html: "",
            costs: 1,
            calories: 120,
          },
        ],
      },
    ],
  };

  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());

  const app = mountNativeEditor(
    "/recipessettings",
    async (url, init) => {
      if (url === "/api/user/settings") {
        if (readFailure) {
          readFailure = false;

          return Response.json({ error_message: "Settings unavailable" }, { status: 503 });
        }

        return Response.json(settings);
      }

      if (url.startsWith("/api/user/settings/") && init?.method === "PUT") {
        const key = decodeURIComponent(url.slice("/api/user/settings/".length));
        const value = JSON.parse(String(init.body)).value;

        if (key.startsWith("datatables_")) {
          settings[key] = value;

          return new Response(null, { status: 204 });
        }

        writes.push({ key, value });

        if (holdFirst && writes.length === 1) await hold.promise;

        if (fail) return Response.json({ error_message: "Setting save failed" }, { status: 503 });
        settings[key] = value;

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/recipes/overview")
        return Response.json([
          {
            id: 1,
            name: "Bread",
            picture_file_name: null,
            desired_servings: 1,
            due_score: 0,
            missing_products_count: 0,
            product_names: "Flour",
            stock_status: "Xenoughinstock",
            userfields: {},
          },
        ]);

      if (url === "/api/v2/recipes/1/view") return Response.json(view);

      if (url === "/api/objects/products")
        return Response.json([{ id: 2, name: "Flour", qu_id_stock: 1 }]);

      if (url === "/api/objects/quantity_units")
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

      if (url === "/api/objects/recipes")
        return Response.json([
          { id: 1, name: "Bread", desired_servings: 1, base_servings: 1, type: "normal" },
        ]);

      if (url === "/api/v2/custom-data/fields") return Response.json([]);

      return undefined;
    },
    {
      FEATURE_FLAG_RECIPES: enabled,
      FEATURE_FLAG_STOCK: false,
      FEATURE_FLAG_RECIPES_MEALPLAN: false,
      FEATURE_FLAG_LABEL_PRINTER: false,
    },
  );

  return { ...app, settings, writes, hold, logger };
}

async function ready() {
  await screen.findByRole("checkbox", { name: labels.side });
}

test("native recipe settings route exposes its three controls", async () => {
  const app = mountSettings();
  await ready();
  expect(screen.getByRole("heading", { name: "Recipes settings" })).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.side }).checked).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.checkbox }).checked).toBe(
    false,
  );
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.group }).checked).toBe(
    false,
  );
  expect(screen.getByRole("heading", { name: "Recipe card" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "OK" }).getAttribute("href")).toBe("/recipes");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(app.writes).toHaveLength(0);
});

test("settings initialize with native BoolVal rather than PHP string truthiness", async () => {
  const app = mountSettings({
    values: {
      recipes_show_list_side_by_side: "false",
      recipes_show_ingredient_checkbox: "oN",
      recipe_ingredients_group_by_product_group: "0",
    },
  });

  await ready();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.side }).checked).toBe(false);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.checkbox }).checked).toBe(
    true,
  );
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.group }).checked).toBe(
    false,
  );
  expect(app.writes).toHaveLength(0);
});

test("saved checkbox and grouping controls affect the returned reader and page departure resets ingredient marks", async () => {
  const app = mountSettings({ values: { recipes_show_list_side_by_side: false } });
  await ready();
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: labels.side }));
  await user.click(screen.getByRole("checkbox", { name: labels.checkbox }));
  await user.click(screen.getByRole("checkbox", { name: labels.group }));
  expect(app.writes).toEqual([
    { key: "recipes_show_list_side_by_side", value: true },
    { key: "recipes_show_ingredient_checkbox", value: true },
    { key: "recipe_ingredients_group_by_product_group", value: true },
  ]);
  await user.click(screen.getByRole("link", { name: "OK" }));

  const mark = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: "Mark this item as done: Flour",
  });

  expect(screen.getByRole("heading", { name: "Dry goods" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Base" })).toBeTruthy();
  expect(document.querySelector(".recipes-layout")?.getAttribute("data-split")).toBe("true");
  await user.click(mark);
  expect(mark.closest("li")?.dataset.done).toBe("true");
  await act(async () => app.router.navigate({ to: "/recipessettings" }));
  await ready();
  await user.click(screen.getByRole("link", { name: "OK" }));

  const fresh = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: "Mark this item as done: Flour",
  });

  expect(fresh.checked).toBe(false);
  expect(fresh.closest("li")?.dataset.done).toBeUndefined();
  expect(app.writes).toHaveLength(3);
});

test("stored false strings leave settings unchecked but native PHP reader flags enabled", async () => {
  const app = mountSettings({
    values: {
      recipes_show_ingredient_checkbox: "false",
      recipe_ingredients_group_by_product_group: "false",
    },
  });

  await ready();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.checkbox }).checked).toBe(
    false,
  );
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.group }).checked).toBe(
    false,
  );
  await userEvent.click(screen.getByRole("link", { name: "OK" }));
  expect(
    await screen.findByRole("checkbox", { name: "Mark this item as done: Flour" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Dry goods" })).toBeTruthy();
  expect(app.writes).toHaveLength(0);
  await act(async () => app.router.navigate({ to: "/recipessettings" }));
  await ready();

  for (const label of [labels.checkbox, labels.group]) {
    await userEvent.click(screen.getByRole("checkbox", { name: label }));
    await userEvent.click(screen.getByRole("checkbox", { name: label }));
  }

  await userEvent.click(screen.getByRole("link", { name: "OK" }));
  await screen.findByRole("heading", { name: "Base" });
  expect(screen.queryByRole("checkbox", { name: "Mark this item as done: Flour" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Dry goods" })).toBeNull();
  expect(app.settings.recipes_show_ingredient_checkbox).toBe(false);
  expect(app.settings.recipe_ingredients_group_by_product_group).toBe(false);
});

test("failed autosave logs only and keeps the changed native control usable without rollback", async () => {
  const app = mountSettings({ fail: true });
  await ready();
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: labels.checkbox });
  await userEvent.click(checkbox);
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(checkbox.checked).toBe(true);
  expect(checkbox.disabled).toBe(false);
  expect(screen.queryByText("Setting save failed")).toBeNull();
  expect(screen.getByRole("link", { name: "OK" })).toBeTruthy();
  await userEvent.click(checkbox);
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes.map((row) => row.value)).toEqual([true, false]);
});

test("overlapping autosaves do not block OK and a later page read uses persisted completion order", async () => {
  const app = mountSettings({ holdFirst: true });
  await ready();
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: labels.checkbox });
  await userEvent.click(checkbox);
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(checkbox.disabled).toBe(false);
  await userEvent.click(checkbox);
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(checkbox.checked).toBe(false);
  await userEvent.click(screen.getByRole("link", { name: "OK" }));
  await screen.findByRole("heading", { name: "Base" });
  expect(app.router.state.location.pathname).toBe("/recipes");
  expect(screen.queryByRole("checkbox", { name: "Mark this item as done: Flour" })).toBeNull();
  await act(async () => app.hold.release());
  await waitFor(() => expect(app.settings.recipes_show_ingredient_checkbox).toBe(true));
  expect(screen.queryByRole("checkbox", { name: "Mark this item as done: Flour" })).toBeNull();
  await act(async () => app.router.navigate({ to: "/recipessettings" }));
  await ready();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.checkbox }).checked).toBe(
    true,
  );
  await userEvent.click(screen.getByRole("link", { name: "OK" }));
  expect(
    await screen.findByRole("checkbox", { name: "Mark this item as done: Flour" }),
  ).toBeTruthy();
  expect(app.writes.map((row) => row.value)).toEqual([true, false]);
});

test("native recipe settings controls remain readable when Recipes navigation is disabled", async () => {
  const app = mountSettings({ enabled: false });
  await ready();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: labels.side }).checked).toBe(true);
  expect(app.writes).toHaveLength(0);
});

test("a failed settings read offers Retry before mounting controls", async () => {
  mountSettings({ failRead: true });
  await screen.findByText("Settings unavailable");
  expect(screen.queryByRole("checkbox", { name: labels.side })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
});
