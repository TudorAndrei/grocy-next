import { signal, Text, View } from "nsh";
import { Api, plain, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import {
  Action,
  Choice,
  DateField,
  Field,
  Heading,
  Line,
  Note,
  Panel,
  Toggle,
} from "../ui";

type Definition = {
  title: string;
  fields: {
    key: string;
    label: string;
    relation?: string;
    number?: boolean;
    required?: boolean;
    initial?: string;
  }[];
};
const text = (
  key: string,
  label: string,
  required = false,
  initial?: string,
) => ({ key, label, required, initial });
const number = (key: string, label: string, initial?: string) => ({
  key,
  label,
  number: true,
  initial,
});
const relation = (
  key: string,
  label: string,
  entity: string,
  required = false,
) => ({ key, label, relation: entity, required });
const definitions: Record<string, Definition> = {
  products: {
    title: "Products",
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
    fields: [
      text("name", "Location name", true),
      text("description", "Description"),
      number("is_freezer", "Freezer", "0"),
    ],
  },
  quantity_units: {
    title: "Quantity units",
    fields: [
      text("name", "Singular name", true),
      text("name_plural", "Plural name", true),
    ],
  },
  quantity_unit_conversions: {
    title: "Unit conversions",
    fields: [
      relation("from_qu_id", "From unit", "quantity_units", true),
      relation("to_qu_id", "To unit", "quantity_units", true),
      number("factor", "Conversion factor", "1"),
      relation("product_id", "Product (optional)", "products"),
    ],
  },
  product_groups: {
    title: "Product groups",
    fields: [
      text("name", "Group name", true),
      text("description", "Description"),
    ],
  },
  shopping_locations: {
    title: "Stores",
    fields: [
      text("name", "Store name", true),
      text("description", "Description"),
    ],
  },
  product_barcodes: {
    title: "Barcodes",
    fields: [
      relation("product_id", "Product", "products", true),
      text("barcode", "Barcode", true),
      relation("qu_id", "Unit", "quantity_units"),
      number("amount", "Quantity", "1"),
    ],
  },
  recipes: {
    title: "Recipes",
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
    fields: [
      relation("recipe_id", "Recipe", "recipes", true),
      relation("includes_recipe_id", "Included recipe", "recipes", true),
      number("servings", "Servings", "1"),
    ],
  },
  shopping_lists: {
    title: "Shopping lists",
    fields: [text("name", "List name", true), text("description", "Notes")],
  },
  tasks: {
    title: "Tasks",
    fields: [
      text("name", "Task name", true),
      text("description", "Description"),
      text("due_date", "Due date"),
      relation("category_id", "Category", "task_categories"),
    ],
  },
  task_categories: {
    title: "Task categories",
    fields: [
      text("name", "Category name", true),
      text("description", "Description"),
    ],
  },
  chores: {
    title: "Chores",
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
    fields: [
      text("name", "Battery name", true),
      text("description", "Description"),
      text("used_in", "Used in"),
      number("charge_interval_days", "Charge interval (days)", "0"),
    ],
  },
  equipment: {
    title: "Equipment",
    fields: [
      text("name", "Equipment name", true),
      text("description", "Description"),
    ],
  },
};
export function Catalog(p: { api: Api }) {
  const entity = signal("products");
  return (
    <View class="gap-4">
      <Heading
        title="Manage household records"
        detail="Maintain the products, recipes, places, and recurring work behind your household."
      />
      <Choice
        label="Record type"
        value={entity()}
        items={Object.entries(definitions).map(([value, d]) => ({
          value,
          title: d.title,
        }))}
        onChange={(v) => entity.set(v)}
      />
      <Each of={[entity()]}>{(e) => <Records api={p.api} entity={e()} />}</Each>
    </View>
  );
}
function Records(p: { api: Api; entity: string }) {
  const definition = definitions[p.entity];
  const state = remote((s) =>
    p.api.request<Row[]>(`/api/objects/${p.entity}`, "GET", undefined, s),
  );
  const options = remote(async (s) => {
    const tables = [
      ...new Set(
        definition.fields
          .map((f) => f.relation)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const entries = await Promise.all(
      tables.map(
        async (name) =>
          [
            name,
            await p.api.request<Row[]>(
              `/api/objects/${name}`,
              "GET",
              undefined,
              s,
            ),
          ] as const,
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
  const title = (r: Row) =>
    r.name ||
    r.barcode ||
    (r.product_id ? `Product ${r.product_id}` : `${definition.title} ${r.id}`);
  return (
    <View class="gap-4">
      <View class="flex-row flex-wrap gap-2">
        <Action
          label={`Add ${definition.title.toLowerCase()}`}
          primary
          onPress={() => edit()}
        />
      </View>
      <Field
        label="Search records"
        value={query()}
        onChange={(v) => query.set(v)}
      />
      <Feedback error={op.error()} success={op.success()} />
      <Panel
        open={editing()}
        title={id() == null ? "New record" : "Edit record"}
        onClose={() => editing.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success="" />
            <Action
              label="Save record"
              primary
              disabled={
                op.busy() || options.loading() || Boolean(options.error())
              }
              onPress={() => void save()}
            />
          </View>
        }
      >
        <LoadState
          loading={options.loading()}
          error={options.error()}
          retry={options.refresh}
        />
        <Each of={definition.fields}>
          {(f) => (
            <View>
              {f().key === "is_freezer" ? (
                <Toggle
                  label="Freezer"
                  checked={draft()[f().key] === "1"}
                  onChange={(v) =>
                    draft.set({ ...draft(), [f().key]: v ? "1" : "0" })
                  }
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
      <LoadState
        loading={state.loading()}
        error={state.error()}
        retry={state.refresh}
      />
      {!state.loading() && !state.error() && !state.data()?.length ? (
        <Note>No records yet. Add the first one above.</Note>
      ) : null}
      <Each
        of={(state.data() ?? []).filter((r) =>
          [title(r), plain(r.description)]
            .join(" ")
            .toLowerCase()
            .includes(query().toLowerCase()),
        )}
      >
        {(r) => (
          <Line>
            <Text class="text-base font-medium text-[#1b1d1c]">
              {title(r())}
            </Text>
            {r().description ? (
              <Text class="text-sm text-[#5e625f]">
                {plain(r().description)}
              </Text>
            ) : null}
            <View class="flex-row flex-wrap gap-2">
              <Action
                label="Edit"
                accessibilityLabel={`Edit ${title(r())}`}
                quiet
                disabled={op.busy()}
                onPress={() => edit(r())}
              />
              <Action
                label="Delete"
                accessibilityLabel={`Delete ${title(r())}`}
                quiet
                danger
                disabled={op.busy()}
                onPress={() => deleting.set(Number(r().id))}
              />
            </View>
            {deleting() === Number(r().id) ? (
              <View class="gap-3">
                <Note error>Delete this record? This cannot be undone.</Note>
                <View class="flex-row gap-2">
                  <Action
                    label="Confirm delete"
                    danger
                    disabled={op.busy()}
                    onPress={() =>
                      void op.run(async () => {
                        await p.api.request(
                          `/api/objects/${p.entity}/${r().id}`,
                          "DELETE",
                        );
                        deleting.set(null);
                      }, "Record deleted.")
                    }
                  />
                  <Action
                    label="Keep record"
                    onPress={() => deleting.set(null)}
                  />
                </View>
              </View>
            ) : null}
          </Line>
        )}
      </Each>
    </View>
  );
}
