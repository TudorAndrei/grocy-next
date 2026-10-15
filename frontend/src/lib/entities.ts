export type EntityRow = {
  id: number;
  name?: string;
  description?: string | null;
  [key: string]: unknown;
};
export type EntityField = {
  key: string;
  label: string;
  type?:
    | "number"
    | "date"
    | "datetime-local"
    | "textarea"
    | "checkbox"
    | "weekdays"
    | "multiple";
  when?: { key: string; values: string[] };
  required?: boolean;
  ref?: string;
  choices?: string[];
  min?: number;
  value?: string;
};
export type EntitySpec = {
  label: string;
  singular: string;
  fields: EntityField[];
};
const name: EntityField = { key: "name", label: "Name", required: true };
const description: EntityField = {
  key: "description",
  label: "Description",
  type: "textarea",
};
const named = [name, description];
const active: EntityField = {
  key: "active",
  label: "Active",
  type: "checkbox",
  value: "1",
};
const flag = (key: string, label: string): EntityField => ({
  key,
  label,
  type: "checkbox",
});
const numeric = (
  key: string,
  label: string,
  value = "0",
  min = 0,
): EntityField => ({ key, label, type: "number", value, min });
const ref = (
  key: string,
  label: string,
  entity: string,
  required = true,
): EntityField => ({ key, label, ref: entity, required });
const amount: EntityField = {
  key: "amount",
  label: "Amount",
  type: "number",
  required: true,
  min: 0.000001,
  value: "1",
};
export const entities: Record<string, EntitySpec> = {
  products: {
    label: "Products",
    singular: "product",
    fields: [
      ...named,
      ref("location_id", "Default location", "locations"),
      ref("qu_id_purchase", "Purchase unit", "quantity_units"),
      ref("qu_id_stock", "Stock unit", "quantity_units"),
      {
        key: "qu_factor_purchase_to_stock",
        label: "Stock units per purchase unit",
        type: "number",
        value: "1",
        min: 0.000001,
      },
      {
        key: "min_stock_amount",
        label: "Minimum stock",
        type: "number",
        value: "0",
        min: 0,
      },
      {
        key: "default_best_before_days",
        label: "Days before expiry",
        type: "number",
        value: "0",
        min: -1,
      },
      ref("product_group_id", "Group", "product_groups", false),
      active,
      ref("parent_product_id", "Parent product", "products", false),
      ref(
        "default_consume_location_id",
        "Default consume location",
        "locations",
        false,
      ),
      ref("shopping_location_id", "Default store", "shopping_locations", false),
      ref("qu_id_consume", "Consume unit", "quantity_units", false),
      ref("qu_id_price", "Price unit", "quantity_units", false),
      numeric("default_best_before_days_after_open", "Days after opening"),
      numeric(
        "default_best_before_days_after_freezing",
        "Days after freezing",
        "0",
        -1,
      ),
      numeric("default_best_before_days_after_thawing", "Days after thawing"),
      {
        key: "due_type",
        label: "Due date type",
        choices: ["1", "2"],
        value: "1",
      },
      numeric("quick_consume_amount", "Quick consume amount", "1"),
      numeric("quick_open_amount", "Quick open amount", "1"),
      numeric("calories", "Calories per stock unit"),
      numeric("tare_weight", "Container weight"),
      flag("enable_tare_weight_handling", "Use container weight"),
      flag("move_on_open", "Move opened stock to the consume location"),
      flag("disable_open", "Disable opening"),
      flag("no_own_stock", "Use child product stock only"),
      flag(
        "cumulate_min_stock_amount_of_sub_products",
        "Sum child product minimum stock",
      ),
      flag(
        "not_check_stock_fulfillment_for_recipes",
        "Skip recipe stock checks",
      ),
      flag("hide_on_stock_overview", "Hide on stock overview"),
    ],
  },
  shopping_locations: {
    label: "Stores",
    singular: "store",
    fields: [...named, active],
  },
  userfields: {
    label: "Custom fields",
    singular: "custom field",
    fields: [
      {
        key: "entity",
        label: "Record type",
        choices: [
          "products",
          "chores",
          "batteries",
          "locations",
          "equipment",
          "tasks",
          "userobjects",
        ],
        required: true,
      },
      name,
      { key: "caption", label: "Label", required: true },
      {
        key: "type",
        label: "Field type",
        choices: [
          "text-single-line",
          "text-multi-line",
          "number-integral",
          "number-decimal",
          "number-currency",
          "checkbox",
          "date",
          "datetime",
          "preset-list",
          "preset-checklist",
          "link",
          "link-with-title",
          "file",
          "image",
        ],
        value: "text-single-line",
        required: true,
      },
      flag("input_required", "Required input"),
      { key: "default_value", label: "Default value" },
      { key: "config", label: "List options, one per line", type: "textarea" },
      flag("show_as_column_in_tables", "Show as a table column"),
      numeric("sort_number", "Order"),
    ],
  },
  userentities: {
    label: "Custom record types",
    singular: "record type",
    fields: [
      name,
      { key: "caption", label: "Label", required: true },
      description,
    ],
  },
  userobjects: {
    label: "Custom records",
    singular: "record",
    fields: [ref("userentity_id", "Record type", "userentities")],
  },
  locations: {
    label: "Locations",
    singular: "location",
    fields: [
      ...named,
      { key: "is_freezer", label: "Freezer", type: "checkbox" },
      active,
    ],
  },
  quantity_units: {
    label: "Units",
    singular: "unit",
    fields: [...named, { key: "name_plural", label: "Plural name" }, active],
  },
  quantity_unit_conversions: {
    label: "Unit conversions",
    singular: "conversion",
    fields: [
      ref("from_qu_id", "From unit", "quantity_units"),
      ref("to_qu_id", "To unit", "quantity_units"),
      {
        key: "factor",
        label: "Conversion factor",
        type: "number",
        required: true,
        min: 0.000001,
      },
      ref("product_id", "Product", "products", false),
    ],
  },
  product_groups: {
    label: "Product groups",
    singular: "group",
    fields: [...named, active],
  },
  product_barcodes: {
    label: "Barcodes",
    singular: "barcode",
    fields: [
      ref("product_id", "Product", "products"),
      { key: "barcode", label: "Barcode", required: true },
      ref("qu_id", "Unit", "quantity_units", false),
      { ...amount, required: false },
      { key: "note", label: "Note" },
    ],
  },
  recipes: {
    label: "Recipes",
    singular: "recipe",
    fields: [
      ...named,
      {
        key: "base_servings",
        label: "Base servings",
        type: "number",
        min: 0.000001,
        value: "1",
        required: true,
      },
      {
        key: "desired_servings",
        label: "Desired servings",
        type: "number",
        min: 0.000001,
        value: "1",
        required: true,
      },
      ref("product_id", "Product produced by this recipe", "products", false),
      flag(
        "not_check_shoppinglist",
        "Ignore shopping list quantities in stock checks",
      ),
    ],
  },
  recipes_pos: {
    label: "Recipe ingredients",
    singular: "ingredient",
    fields: [
      ref("recipe_id", "Recipe", "recipes"),
      ref("product_id", "Product", "products"),
      amount,
      ref("qu_id", "Unit", "quantity_units"),
      { key: "note", label: "Note" },
      { key: "ingredient_group", label: "Ingredient group" },
      {
        key: "not_check_stock_fulfillment",
        label: "Skip stock check",
        type: "checkbox",
      },
      flag(
        "only_check_single_unit_in_stock",
        "Only check if any amount is in stock",
      ),
      flag("round_up", "Round ingredient amount up"),
      numeric("price_factor", "Price factor", "1"),
      { key: "variable_amount", label: "Variable amount description" },
    ],
  },
  recipes_nestings: {
    label: "Included recipes",
    singular: "included recipe",
    fields: [
      ref("recipe_id", "Parent recipe", "recipes"),
      ref("includes_recipe_id", "Included recipe", "recipes"),
      {
        key: "servings",
        label: "Servings",
        type: "number",
        min: 0.000001,
        value: "1",
        required: true,
      },
    ],
  },
  meal_plan: {
    label: "Meals",
    singular: "meal",
    fields: [
      { key: "day", label: "Date", type: "date", required: true },
      {
        key: "type",
        label: "Meal type",
        choices: ["recipe", "product", "note"],
        value: "recipe",
        required: true,
      },
      ref("recipe_id", "Recipe", "recipes", false),
      {
        key: "recipe_servings",
        label: "Recipe servings",
        type: "number",
        min: 0.000001,
      },
      ref("product_id", "Product", "products", false),
      {
        key: "product_amount",
        label: "Product amount",
        type: "number",
        min: 0.000001,
      },
      ref("product_qu_id", "Product unit", "quantity_units", false),
      { key: "note", label: "Note", type: "textarea" },
      ref("section_id", "Meal section", "meal_plan_sections", false),
      { key: "done", label: "Completed", type: "checkbox" },
    ],
  },
  meal_plan_sections: {
    label: "Meal sections",
    singular: "section",
    fields: [
      name,
      { key: "sort_number", label: "Order", type: "number", value: "0" },
      { key: "time_hms", label: "Time", value: "12:00:00" },
    ],
  },
  chores: {
    label: "Chores",
    singular: "chore",
    fields: [
      ...named,
      {
        key: "period_type",
        label: "Repeat",
        choices: [
          "manually",
          "hourly",
          "daily",
          "weekly",
          "monthly",
          "yearly",
          "adaptive",
        ],
        value: "manually",
      },
      {
        key: "period_interval",
        label: "Repeat interval",
        type: "number",
        min: 1,
        value: "1",
        required: true,
        when: {
          key: "period_type",
          values: ["hourly", "daily", "weekly", "monthly", "yearly"],
        },
      },
      {
        key: "period_days",
        label: "Day of month",
        type: "number",
        min: 1,
        value: "1",
        required: true,
        when: { key: "period_type", values: ["monthly"] },
      },
      {
        key: "period_config",
        label: "Weekdays",
        type: "weekdays",
        when: { key: "period_type", values: ["weekly"] },
      },
      {
        key: "start_date",
        label: "First scheduled date",
        type: "datetime-local",
      },
      {
        key: "track_date_only",
        label: "Track the date only",
        type: "checkbox",
      },
      {
        key: "rollover",
        label: "Move overdue chores to today",
        type: "checkbox",
      },
      {
        key: "assignment_type",
        label: "Assignment",
        choices: [
          "no-assignment",
          "in-alphabetical-order",
          "who-least-did-first",
          "random",
        ],
        value: "no-assignment",
      },
      {
        key: "assignment_config",
        label: "Assigned users",
        type: "multiple",
        ref: "users",
        when: {
          key: "assignment_type",
          values: ["in-alphabetical-order", "who-least-did-first", "random"],
        },
      },
      {
        key: "rescheduled_date",
        label: "Rescheduled date",
        type: "datetime-local",
      },
      ref(
        "rescheduled_next_execution_assigned_to_user_id",
        "Assign next execution to",
        "users",
        false,
      ),
      {
        key: "consume_product_on_execution",
        label: "Consume stock when recorded",
        type: "checkbox",
      },
      {
        ...ref("product_id", "Product to consume", "products"),
        when: { key: "consume_product_on_execution", values: ["1"] },
      },
      {
        key: "product_amount",
        label: "Stock amount to consume",
        type: "number",
        min: 0.000001,
        value: "1",
        required: true,
        when: { key: "consume_product_on_execution", values: ["1"] },
      },
      { key: "active", label: "Active", type: "checkbox", value: "1" },
    ],
  },
  tasks: {
    label: "Tasks",
    singular: "task",
    fields: [
      ...named,
      { key: "due_date", label: "Due date", type: "datetime-local" },
      ref("category_id", "Category", "task_categories", false),
      ref("assigned_to_user_id", "Assigned to", "users", false),
      { key: "done", label: "Completed", type: "checkbox" },
    ],
  },
  task_categories: {
    label: "Task categories",
    singular: "category",
    fields: [
      ...named,
      { key: "active", label: "Active", type: "checkbox", value: "1" },
    ],
  },
  batteries: {
    label: "Batteries",
    singular: "battery",
    fields: [
      ...named,
      { key: "used_in", label: "Used in" },
      { key: "active", label: "Active", type: "checkbox", value: "1" },
      {
        key: "charge_interval_days",
        label: "Days between charges",
        type: "number",
        min: 0,
        value: "0",
      },
    ],
  },
  equipment: {
    label: "Equipment",
    singular: "equipment item",
    fields: [
      ...named,
      { key: "instruction_manual_file_name", label: "Manual file name" },
    ],
  },
  shopping_lists: {
    label: "Shopping lists",
    singular: "shopping list",
    fields: named,
  },
};
