import type { MealPlanCalendar, MealPlanEntry, MealPlanRecipe } from "@/lib/mealplan-calendar";

/** Independent saved-calendar data; aggregate values are explicit persisted read-model rows. */
export function mealPlanCalendarFixture(): MealPlanCalendar {
  const stockUnit = {
    id: 1,
    name: "g",
    name_plural: "g",
    plural_forms: null,
    active: 1,
  };

  const purchaseUnit = {
    id: 2,
    name: "kg",
    name_plural: "kg",
    plural_forms: null,
    active: 1,
  };

  const rice = {
    id: 11,
    name: "Rice",
    active: 1,
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 2,
    qu_id_consume: 1,
    qu_id_price: 2,
    not_check_stock_fulfillment_for_recipes: 0,
    picture_file_name: null,
    calories: 1.3,
  };

  const herbs = {
    ...rice,
    id: 12,
    name: "Herbs",
    qu_id_purchase: 1,
    qu_id_price: 1,
    calories: 0,
  };

  const recipe: MealPlanRecipe = {
    id: 7,
    name: "Rice dinner",
    description: "<p>Steam the rice.</p>",
    picture_file_name: null,
    base_servings: 2,
    desired_servings: 2,
    not_check_shoppinglist: 0,
    product_id: null,
    type: "normal",
    row_created_timestamp: "2026-11-01 10:00:00",
  };

  const week: MealPlanRecipe = {
    ...recipe,
    id: -144,
    name: "2026-44",
    type: "mealplan-week",
    base_servings: 1,
    desired_servings: 1,
    description: null,
  };

  const monday: MealPlanRecipe = {
    ...week,
    id: -102,
    name: "2026-11-02",
    type: "mealplan-day",
  };

  const tuesday: MealPlanRecipe = { ...monday, id: -103, name: "2026-11-03" };
  const wednesday: MealPlanRecipe = { ...monday, id: -104, name: "2026-11-04" };

  const shadow: MealPlanRecipe = {
    ...week,
    id: -201,
    name: "2026-11-02#101",
    type: "mealplan-shadow",
  };

  const recipeEntry: MealPlanEntry = {
    id: 101,
    day: "2026-11-02",
    type: "recipe",
    recipe_id: 7,
    recipe_servings: 3,
    product_id: null,
    product_amount: 0,
    product_qu_id: null,
    note: null,
    section_id: 1,
    done: 0,
    row_created_timestamp: "2026-11-01 10:05:00",
  };

  const productEntry: MealPlanEntry = {
    id: 102,
    day: "2026-11-03",
    type: "product",
    recipe_id: null,
    recipe_servings: 1,
    product_id: 11,
    product_amount: 250,
    product_qu_id: 1,
    note: null,
    section_id: 2,
    done: 0,
    row_created_timestamp: "2026-11-01 10:06:00",
  };

  const noteEntry: MealPlanEntry = {
    id: 103,
    day: "2026-11-04",
    type: "note",
    recipe_id: null,
    recipe_servings: 1,
    product_id: null,
    product_amount: 0,
    product_qu_id: null,
    note: "<strong>Leftovers</strong>",
    section_id: 0,
    done: 0,
    row_created_timestamp: "2026-11-01 10:07:00",
  };

  const sections = [
    { id: -1, name: null, sort_number: -1, time_info: null },
    { id: 0, name: "Notes", sort_number: 0, time_info: null },
    { id: 1, name: "Breakfast", sort_number: 1, time_info: "08:00" },
    { id: 2, name: "Dinner", sort_number: 2, time_info: "18:00" },
  ];

  return {
    start: "2026-11-02",
    days: 6,
    events: [
      {
        id: 101,
        title: "Rice dinner",
        start: "2026-11-02",
        date_format: "date",
        type: "recipe",
        recipe: { ...recipe },
        entry: recipeEntry,
        product_details: null,
      },
      {
        id: 102,
        title: "",
        start: "2026-11-03",
        date_format: "date",
        type: "product",
        recipe: null,
        entry: productEntry,
        product_details: {
          product: { ...rice },
          quantity_unit_stock: { ...stockUnit },
          stock_amount: 1000,
          stock_amount_aggregated: 1000,
          stock_amount_opened: 0,
          last_price: 0.002,
          current_price: 0.002,
          quantity_unit_price: { ...purchaseUnit },
          default_quantity_unit_purchase: { ...purchaseUnit },
          default_quantity_unit_consume: { ...stockUnit },
          product_barcodes: [
            { id: 51, product_id: 11, barcode: "rice-code", qu_id: 1, amount: 250 },
          ],
        },
      },
      {
        id: 103,
        title: "",
        start: "2026-11-04",
        date_format: "date",
        type: "note",
        recipe: null,
        entry: noteEntry,
        product_details: null,
        note_html: "<strong>Leftovers</strong>",
      },
    ],
    recipes: [recipe],
    internal_recipes: [week, monday, tuesday, wednesday, shadow],
    recipes_resolved: [
      {
        recipe_id: -144,
        costs: 1.25,
        calories: 812.5,
        need_fulfilled: 1,
        need_fulfilled_with_shopping_list: 1,
      },
      {
        recipe_id: -102,
        costs: 0.75,
        calories: 487.5,
        need_fulfilled: 1,
        need_fulfilled_with_shopping_list: 1,
      },
      {
        recipe_id: -103,
        costs: 0.5,
        calories: 325,
        need_fulfilled: 1,
        need_fulfilled_with_shopping_list: 1,
      },
      {
        recipe_id: -104,
        costs: 0,
        calories: 0,
        need_fulfilled: 1,
        need_fulfilled_with_shopping_list: 1,
      },
      {
        recipe_id: -201,
        costs: 0.75,
        calories: 487.5,
        need_fulfilled: 1,
        need_fulfilled_with_shopping_list: 1,
      },
    ],
    products: [herbs, rice],
    units: [stockUnit, purchaseUnit],
    conversions: [
      {
        id: 1,
        product_id: 11,
        from_qu_id: 1,
        to_qu_id: 1,
        from_qu_name: "g",
        from_qu_name_plural: "g",
        to_qu_name: "g",
        to_qu_name_plural: "g",
        factor: "1",
        path: "1",
      },
      {
        id: 2,
        product_id: 11,
        from_qu_id: 1,
        to_qu_id: 2,
        from_qu_name: "g",
        from_qu_name_plural: "g",
        to_qu_name: "kg",
        to_qu_name_plural: "kg",
        factor: "0.001",
        path: "1/2",
      },
      {
        id: 3,
        product_id: 11,
        from_qu_id: 2,
        to_qu_id: 1,
        from_qu_name: "kg",
        from_qu_name_plural: "kg",
        to_qu_name: "g",
        to_qu_name_plural: "g",
        factor: "1000",
        path: "2/1",
      },
      {
        id: 4,
        product_id: 12,
        from_qu_id: 1,
        to_qu_id: 1,
        from_qu_name: "g",
        from_qu_name_plural: "g",
        to_qu_name: "g",
        to_qu_name_plural: "g",
        factor: "1",
        path: "1",
      },
    ],
    sections,
    used_sections: sections.slice(1).map((section) => ({ ...section })),
    week_recipe: { ...week },
  };
}
