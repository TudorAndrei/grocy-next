import { signal, Text, View, windowSize } from "nsh";
import { Button } from "nsh/base";
import { Api, plain, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import {
  Action,
  Choice,
  DateField,
  Empty,
  Field,
  Icon,
  Panel,
  Search,
  Subheading,
  Toggle,
} from "../ui";

type Definition = {
  title: string;
  /** Singular, lower case: "Add location", "New location". */
  one: string;
  fields: {
    key: string;
    label: string;
    relation?: string;
    number?: boolean;
    required?: boolean;
    initial?: string;
  }[];
};
const text = (key: string, label: string, required = false, initial?: string) => ({
  key,
  label,
  required,
  initial,
});
const number = (key: string, label: string, initial?: string) => ({
  key,
  label,
  number: true,
  initial,
});
const relation = (key: string, label: string, entity: string, required = false) => ({
  key,
  label,
  relation: entity,
  required,
});
const definitions: Record<string, Definition> = {
  products: {
    title: "Products",
    one: "product",
    fields: [
      text("name", "Product name", true),
      text("description", "Description"),
      relation("location_id", "Default location", "locations", true),
      relation("qu_id_stock", "Stock unit", "quantity_units", true),
      relation("qu_id_purchase", "Purchase unit", "quantity_units", true),
      relation("product_group_id", "Product group", "product_groups"),
      number("min_stock_amount", "Minimum stock", "0"),
      number("default_best_before_days", "Default best-before days", "0"),
    ],
  },
  locations: {
    title: "Locations",
    one: "location",
    fields: [
      text("name", "Location name", true),
      text("description", "Description"),
      number("is_freezer", "Freezer", "0"),
    ],
  },
  quantity_units: {
    title: "Quantity units",
    one: "quantity unit",
    fields: [text("name", "Singular name", true), text("name_plural", "Plural name", true)],
  },
  quantity_unit_conversions: {
    title: "Unit conversions",
    one: "unit conversion",
    fields: [
      relation("from_qu_id", "From unit", "quantity_units", true),
      relation("to_qu_id", "To unit", "quantity_units", true),
      number("factor", "Conversion factor", "1"),
      relation("product_id", "Product (optional)", "products"),
    ],
  },
  product_groups: {
    title: "Product groups",
    one: "product group",
    fields: [text("name", "Group name", true), text("description", "Description")],
  },
  shopping_locations: {
    title: "Stores",
    one: "store",
    fields: [text("name", "Store name", true), text("description", "Description")],
  },
  product_barcodes: {
    title: "Barcodes",
    one: "barcode",
    fields: [
      relation("product_id", "Product", "products", true),
      text("barcode", "Barcode", true),
      relation("qu_id", "Unit", "quantity_units"),
      number("amount", "Quantity", "1"),
    ],
  },
  recipes: {
    title: "Recipes",
    one: "recipe",
    fields: [
      text("name", "Recipe name", true),
      text("description", "Preparation"),
      number("base_servings", "Base servings", "1"),
      number("desired_servings", "Desired servings", "1"),
      text("type", "Type", true, "normal"),
    ],
  },
  recipes_pos: {
    title: "Recipe ingredients",
    one: "recipe ingredient",
    fields: [
      relation("recipe_id", "Recipe", "recipes", true),
      relation("product_id", "Product", "products", true),
      number("amount", "Quantity", "1"),
      relation("qu_id", "Unit", "quantity_units"),
      text("ingredient_group", "Ingredient group"),
      text("note", "Note"),
    ],
  },
  recipes_nestings: {
    title: "Included recipes",
    one: "included recipe",
    fields: [
      relation("recipe_id", "Recipe", "recipes", true),
      relation("includes_recipe_id", "Included recipe", "recipes", true),
      number("servings", "Servings", "1"),
    ],
  },
  shopping_lists: {
    title: "Shopping lists",
    one: "shopping list",
    fields: [text("name", "List name", true), text("description", "Notes")],
  },
  tasks: {
    title: "Tasks",
    one: "task",
    fields: [
      text("name", "Task name", true),
      text("description", "Description"),
      text("due_date", "Due date"),
      relation("category_id", "Category", "task_categories"),
    ],
  },
  task_categories: {
    title: "Task categories",
    one: "task category",
    fields: [text("name", "Category name", true), text("description", "Description")],
  },
  chores: {
    title: "Chores",
    one: "chore",
    fields: [
      text("name", "Chore name", true),
      text("description", "Description"),
      text("period_type", "Period type", true, "manually"),
      number("period_days", "Period days"),
      number("period_interval", "Period interval", "1"),
    ],
  },
  batteries: {
    title: "Batteries",
    one: "battery",
    fields: [
      text("name", "Battery name", true),
      text("description", "Description"),
      text("used_in", "Used in"),
      number("charge_interval_days", "Charge interval (days)", "0"),
    ],
  },
  equipment: {
    title: "Equipment",
    one: "equipment",
    fields: [text("name", "Equipment name", true), text("description", "Description")],
  },
};
/** Record types grouped the way the household thinks about them. */
const groups: { title: string; entities: string[] }[] = [
  {
    title: "Stock",
    entities: [
      "products",
      "locations",
      "quantity_units",
      "quantity_unit_conversions",
      "product_groups",
      "product_barcodes",
      "shopping_locations",
    ],
  },
  {
    title: "Meals",
    entities: ["recipes", "recipes_pos", "recipes_nestings", "shopping_lists"],
  },
  {
    title: "Household",
    entities: ["tasks", "task_categories", "chores", "batteries", "equipment"],
  },
];
const focusRing = "focus:outline-2 focus:outline-offset-2 focus:outline-ring";

const wide = () => windowSize().width >= 768;
export function Catalog(p: { api: Api }) {
  const entity = signal("products"),
    picking = signal(false);
  return (
    <View class="gap-5 md:flex-row md:items-start md:gap-10">
      {wide() ? (
        /* Desktop: the grouped record types sit beside the records. */
        <View class="w-48 shrink-0">
          <TypeList value={entity()} onChange={(v) => entity.set(v)} />
        </View>
      ) : (
        /* Phone: one row names the current type and opens the same list. */
        <View class="gap-2">
          <Button
            accessibilityLabel="Record type"
            selected={picking()}
            onPress={() => picking.set(!picking())}
            class={`min-h-12 px-3 flex-row items-center gap-3 rounded-lg border border-input bg-card active:bg-accent ${focusRing}`}
          >
            <Text class="text-[13px] text-muted-foreground">Record type</Text>
            <Text class="flex-1 text-[15px] font-medium text-foreground">
              {definitions[entity()].title}
            </Text>
            <Icon name={picking() ? "chevron-down" : "chevron-right"} size={15} />
          </Button>
          {picking() ? (
            <View class="rounded-lg border border-border bg-card py-2">
              <TypeList
                value={entity()}
                checked
                onChange={(v) => {
                  entity.set(v);
                  picking.set(false);
                }}
              />
            </View>
          ) : null}
        </View>
      )}
      <View class="flex-1 min-w-0">
        <Each of={[entity()]}>{(e) => <Records api={p.api} entity={e()} />}</Each>
      </View>
    </View>
  );
}

function TypeList(p: {
  value: string;
  onChange: (entity: string) => void;
  /** Mark the chosen type with a check (the phone list). */
  checked?: boolean;
}) {
  return (
    <View class="gap-4 md:gap-5">
      <Each of={groups}>
        {(g) => (
          <View class="gap-0.5 px-1 md:px-0">
            <Text class="px-2.5 pb-1 text-[13px] text-muted-foreground">{g().title}</Text>
            <Each of={g().entities}>
              {(e) => (
                <Button
                  selected={p.value === e()}
                  onPress={() => p.onChange(e())}
                  class={`min-h-11 md:min-h-8 px-2.5 flex-row items-center justify-between rounded-md ${p.value === e() ? "bg-selected" : "bg-transparent hover:bg-accent"} ${focusRing}`}
                >
                  <Text
                    class={`text-[15px] md:text-sm ${p.value === e() ? "font-medium text-foreground" : "text-ink-soft"}`}
                  >
                    {definitions[e()].title}
                  </Text>
                  {p.checked && p.value === e() ? (
                    <Icon name="check" size={15} tint="foreground" />
                  ) : null}
                </Button>
              )}
            </Each>
          </View>
        )}
      </Each>
    </View>
  );
}

/** A square icon button for quiet row actions; 44pt on phones. */
function RowAction(p: {
  icon: "pencil" | "trash";
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      accessibilityLabel={p.label}
      disabled={p.disabled}
      onPress={p.onPress}
      class={`w-11 h-11 md:w-8 md:h-8 rounded-md items-center justify-center hover:bg-accent active:bg-accent ${focusRing} disabled:opacity-40`}
    >
      <Icon name={p.icon} size={15} />
    </Button>
  );
}

function Records(p: { api: Api; entity: string }) {
  const definition = definitions[p.entity];
  const state = remote((s) =>
    p.api.request<Row[]>(`/api/objects/${p.entity}`, "GET", undefined, s),
  );
  const options = remote(async (s) => {
    const tables = [
      ...new Set(definition.fields.map((f) => f.relation).filter((v): v is string => Boolean(v))),
    ];
    const entries = await Promise.all(
      tables.map(
        async (name) =>
          [name, await p.api.request<Row[]>(`/api/objects/${name}`, "GET", undefined, s)] as const,
      ),
    );
    return Object.fromEntries(entries);
  });
  const editing = signal(false);
  const draft = signal<Row>({}),
    id = signal<number | undefined>(undefined),
    query = signal(""),
    deleting = signal<number | null>(null);
  const op = operations(state.refresh);
  function edit(row?: Row) {
    editing.set(true);
    id.set(row ? Number(row.id) : undefined);
    deleting.set(null);
    draft.set(
      Object.fromEntries(
        definition.fields.map((f) => [
          f.key,
          row?.[f.key] == null ? (f.initial ?? "") : String(row[f.key]),
        ]),
      ),
    );
  }
  async function save() {
    const ok = await op.run(async () => {
      const body: Row = {};
      for (const f of definition.fields) {
        const value = String(draft()![f.key] ?? "").trim();
        if (f.required && !value) throw new Error(`${f.label} is required.`);
        if (!value) {
          if (id() != null) body[f.key] = null;
          continue;
        }
        if ((f.number || f.relation) && !Number.isFinite(Number(value)))
          throw new Error(`${f.label} must be a number.`);
        body[f.key] = f.number || f.relation ? Number(value) : value;
      }
      await p.api.save(p.entity, body, id());
    }, "Record saved.");
    if (ok) editing.set(false);
  }
  /** The name of a related record, once the related tables have loaded. */
  const related = (table: string, value: unknown) =>
    value == null || value === ""
      ? ""
      : (options.data()?.[table]?.find((r) => String(r.id) === String(value))?.name ?? "");
  const title = (r: Row): string => {
    if (p.entity === "quantity_unit_conversions") {
      const from = related("quantity_units", r.from_qu_id),
        to = related("quantity_units", r.to_qu_id);
      if (from && to) return `${from} to ${to}`;
    }
    if (p.entity === "recipes_pos")
      return related("products", r.product_id) || `Ingredient ${r.id}`;
    if (p.entity === "recipes_nestings")
      return related("recipes", r.includes_recipe_id) || `Included recipe ${r.id}`;
    return (
      r.name ||
      r.barcode ||
      (r.product_id ? `Product ${r.product_id}` : `${definition.title} ${r.id}`)
    );
  };
  /** One muted line of what tells records apart, from their own fields. */
  const meta = (r: Row): string => {
    const parts: string[] = [];
    if (p.entity === "products")
      parts.push(
        related("locations", r.location_id),
        related("quantity_units", r.qu_id_stock),
        related("product_groups", r.product_group_id),
      );
    if (p.entity === "locations" && Number(r.is_freezer) === 1) parts.push("Freezer");
    if (p.entity === "quantity_units" && r.name_plural) parts.push(`Plural ${r.name_plural}`);
    if (p.entity === "quantity_unit_conversions")
      parts.push(`× ${r.factor}`, related("products", r.product_id) || "All products");
    if (p.entity === "product_barcodes") parts.push(related("products", r.product_id));
    if (p.entity === "recipes_pos")
      parts.push(
        [r.amount, related("quantity_units", r.qu_id)].filter(Boolean).join(" "),
        related("recipes", r.recipe_id),
      );
    if (p.entity === "recipes_nestings")
      parts.push(
        `In ${related("recipes", r.recipe_id) || "recipe"}`,
        r.servings ? `${r.servings} servings` : "",
      );
    if (p.entity === "batteries" && r.used_in) parts.push(String(r.used_in));
    if (r.description) parts.push(plain(r.description));
    return parts.filter(Boolean).join(" · ");
  };
  const visible = () =>
    (state.data() ?? []).filter((r) =>
      [title(r), meta(r)].join(" ").toLowerCase().includes(query().trim().toLowerCase()),
    );
  const loaded = () => !state.loading() && !state.error();
  return (
    <View class="gap-4">
      <View class="gap-3 md:flex-row md:items-center md:justify-between">
        <Subheading
          title={definition.title}
          detail={loaded() ? String(state.data()?.length ?? 0) : undefined}
        />
        <View class="flex-row items-center gap-2">
          <Search
            label="Search records"
            placeholder={`Search ${definition.title.toLowerCase()}`}
            value={query()}
            onChange={(v) => query.set(v)}
          />
          <Action label={`Add ${definition.one}`} icon="plus" primary onPress={() => edit()} />
        </View>
      </View>
      <Feedback error={op.error()} success={op.success()} />
      <Panel
        open={editing()}
        title={id() == null ? `New ${definition.one}` : `Edit ${definition.one}`}
        onClose={() => editing.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success="" />
            <Action
              label="Save record"
              primary
              disabled={op.busy() || options.loading() || Boolean(options.error())}
              onPress={() => void save()}
            />
          </View>
        }
      >
        <LoadState loading={options.loading()} error={options.error()} retry={options.refresh} />
        <Each of={definition.fields}>
          {(f) => (
            <View>
              {f().key === "is_freezer" ? (
                <Toggle
                  label="Freezer"
                  checked={draft()[f().key] === "1"}
                  onChange={(v) => draft.set({ ...draft(), [f().key]: v ? "1" : "0" })}
                />
              ) : f().key === "due_date" ? (
                <DateField
                  label="Due date"
                  value={draft()[f().key] ?? ""}
                  onChange={(v) => draft.set({ ...draft(), [f().key]: v })}
                />
              ) : f().key === "period_type" ? (
                <Choice
                  label="Repeats"
                  value={draft()[f().key]}
                  items={[
                    { value: "manually", title: "When needed" },
                    {
                      value: "dynamic-regular",
                      title: "Days after last completion",
                    },
                    { value: "daily", title: "Daily" },
                    { value: "weekly", title: "Weekly" },
                    { value: "monthly", title: "Monthly" },
                  ]}
                  onChange={(v) => draft.set({ ...draft(), [f().key]: v })}
                />
              ) : f().key === "type" ? null : f().relation ? (
                <Choice
                  label={f().label}
                  value={draft()[f().key] ?? ""}
                  onChange={(v) => draft.set({ ...draft(), [f().key]: v })}
                  items={(options.data()?.[f().relation!] ?? []).map((r) => ({
                    value: String(r.id),
                    title: r.name || String(r.id),
                  }))}
                />
              ) : (
                <Field
                  label={f().label}
                  value={draft()[f().key] ?? ""}
                  numeric={f().number}
                  onChange={(v) => draft.set({ ...draft(), [f().key]: v })}
                  multiline={f().key === "description"}
                />
              )}
            </View>
          )}
        </Each>
      </Panel>
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      {loaded() && !state.data()?.length ? (
        <Empty
          title={`No ${definition.title.toLowerCase()} yet`}
          detail={`Add the first ${definition.one} and it will be listed here.`}
        />
      ) : loaded() && !visible().length ? (
        <Empty
          title="No matches"
          detail={`Nothing in ${definition.title.toLowerCase()} matches “${query().trim()}”.`}
        >
          <Action label="Clear search" quiet onPress={() => query.set("")} />
        </Empty>
      ) : null}
      <View class="border-t border-border">
        <Each of={loaded() ? visible() : []}>
          {(r) => (
            <View class="border-b border-border">
              <View class="flex-row items-center gap-3 min-h-[60px] md:min-h-[52px] py-2 md:pl-3">
                <View class="flex-1 min-w-0 gap-0.5 md:flex-row md:items-center md:gap-6">
                  <Text
                    style={{ numberOfLines: 1 }}
                    class="text-[15px] md:text-sm font-medium text-foreground md:w-2/5 md:shrink-0"
                  >
                    {title(r())}
                  </Text>
                  {meta(r()) ? (
                    <Text
                      style={{ numberOfLines: 1 }}
                      class="text-[13px] text-muted-foreground tabular-nums flex-1 min-w-0"
                    >
                      {meta(r())}
                    </Text>
                  ) : null}
                </View>
                <View class="flex-row items-center md:gap-0.5">
                  <RowAction
                    icon="pencil"
                    label={`Edit ${title(r())}`}
                    disabled={op.busy()}
                    onPress={() => edit(r())}
                  />
                  <RowAction
                    icon="trash"
                    label={`Delete ${title(r())}`}
                    disabled={op.busy()}
                    onPress={() => deleting.set(Number(r().id))}
                  />
                </View>
              </View>
              {deleting() === Number(r().id) ? (
                <View class="mb-3 md:mx-3 rounded-lg bg-danger-soft px-3 py-2.5 gap-2 md:flex-row md:items-center md:justify-between">
                  <View class="flex-row items-center gap-2 flex-1 min-w-0">
                    <Icon name="alert" size={15} tint="destructive" />
                    <Text role="alert" class="text-sm text-foreground flex-1">
                      {`Delete ${title(r())}? This cannot be undone.`}
                    </Text>
                  </View>
                  <View class="flex-row gap-2 justify-end">
                    <Action label="Keep record" quiet onPress={() => deleting.set(null)} />
                    <Action
                      label="Confirm delete"
                      danger
                      icon="trash"
                      disabled={op.busy()}
                      onPress={() =>
                        void op.run(async () => {
                          await p.api.request(`/api/objects/${p.entity}/${r().id}`, "DELETE");
                          deleting.set(null);
                        }, "Record deleted.")
                      }
                    />
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}
