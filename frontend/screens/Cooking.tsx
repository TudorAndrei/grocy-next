import { signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Api, plain, positive, type Row } from "../api";
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
  Tabs,
  addDays,
  dateISO,
  shortDate,
} from "../ui";
function monday(day: string) {
  const date = new Date(day + "T12:00:00");
  return addDays(day, -((date.getDay() + 6) % 7));
}
export function Meals(p: { api: Api }) {
  const start = signal(monday(dateISO())),
    tab = signal("This week"),
    query = signal(""),
    plan = signal(false),
    day = signal(dateISO()),
    recipe = signal(""),
    servings = signal("1");
  const detail = signal<Row | null>(null),
    detailOpen = signal(false),
    confirm = signal(false),
    cookServings = signal("1"),
    meal = signal<Row | null>(null);
  const state = remote(async (s) => {
    const [calendar, recipes] = await Promise.all([
      p.api.request<Row>(`/api/v2/meal-plan/calendar?start=${start()}`, "GET", undefined, s),
      p.api.request<Row[]>("/api/v2/recipes/overview", "GET", undefined, s),
    ]);
    return { calendar, recipes };
  });
  const op = operations(state.refresh);
  function add(dayValue: string) {
    day.set(dayValue);
    recipe.set("");
    servings.set("1");
    plan.set(true);
  }
  async function view(id: number, entry: Row | null = null) {
    await op.run(async () => {
      const value = await p.api.request<Row>(`/api/v2/recipes/${id}/view`);
      if (op.alive()) {
        detail.set(value);
        meal.set(entry);
        cookServings.set(
          String(entry?.entry?.recipe_servings ?? value.cards?.[0]?.desired_servings ?? 1),
        );
        confirm.set(false);
        detailOpen.set(true);
      }
    }, "");
  }
  const recipes = () =>
    state
      .data()
      ?.recipes.filter((r) => r.name.toLowerCase().includes(query().toLowerCase()))
      .slice()
      .toSorted(
        (a, b) =>
          Number(a.missing_products_count) - Number(b.missing_products_count) ||
          a.name.localeCompare(b.name),
      ) ?? [];
  const events = (value: string): Row[] =>
    state.data()?.calendar.events.filter((r: Row) => r.start === value) ?? [];
  return (
    <View class="gap-4">
      <View class="flex-row justify-between items-center">
        <Heading title="Meals" />
        <Action label="Plan a meal" primary onPress={() => add(dateISO())} />
      </View>
      <Tabs items={["This week", "Recipes"]} value={tab()} onChange={(v) => tab.set(v)} />
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      <Feedback error={op.error()} success={op.success()} />
      {tab() === "This week" ? (
        <View class="gap-3">
          <View class="flex-row flex-wrap justify-between items-center gap-2">
            <Action
              label="Previous week"
              quiet
              onPress={() => {
                start.set(addDays(start(), -7));
                void state.refresh();
              }}
            />
            <Text class="text-sm font-semibold text-[#1b1d1c]">
              {shortDate(start())} – {shortDate(addDays(start(), 6))}
            </Text>
            <Action
              label="Next week"
              quiet
              onPress={() => {
                start.set(addDays(start(), 7));
                void state.refresh();
              }}
            />
          </View>
          <Each of={Array.from({ length: 7 }, (_, i) => addDays(start(), i))}>
            {(value) => (
              <View class="border-b border-[#e4e4e0] py-2 gap-1">
                <View class="flex-row justify-between items-center">
                  <Text class="text-sm font-semibold text-[#1b1d1c]">
                    {new Date(value() + "T12:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                    {value() === dateISO() ? " · Today" : ""}
                  </Text>
                  <Action
                    label="Add"
                    accessibilityLabel={`Plan ${value()}`}
                    quiet
                    onPress={() => add(value())}
                  />
                </View>
                {events(value()).length === 0 ? <Note>No meal planned</Note> : null}
                <Each of={events(value())}>
                  {(entry) => (
                    <View class="flex-row justify-between gap-2 items-center py-1">
                      <Button
                        class="flex-1 min-h-11 justify-center min-w-0 focus:outline-2 focus:outline-[#22603f]"
                        onPress={() => {
                          if (entry().entry.recipe_id)
                            void view(Number(entry().entry.recipe_id), entry());
                        }}
                      >
                        <Text class="text-base text-[#1b1d1c]">
                          {entry().title ||
                            entry().product_details?.product?.name ||
                            plain(entry().note_html) ||
                            "Meal"}
                          {Number(entry().entry.done) ? " · Cooked" : ""}
                        </Text>
                      </Button>
                      <Action
                        label="Remove"
                        quiet
                        disabled={op.busy()}
                        onPress={() =>
                          void op.run(
                            () => p.api.request(`/api/objects/meal_plan/${entry().id}`, "DELETE"),
                            "Meal removed.",
                          )
                        }
                      />
                    </View>
                  )}
                </Each>
              </View>
            )}
          </Each>
        </View>
      ) : (
        <View class="gap-3">
          <Field label="Search recipes" value={query()} onChange={(v) => query.set(v)} />
          {recipes().length === 0 && !state.loading() ? (
            <Note>No recipes match. Add a recipe in Settings.</Note>
          ) : null}
          <Each of={recipes()}>
            {(r) => (
              <Button
                onPress={() => void view(r().id)}
                class="flex-row items-center gap-3 min-h-16 py-2 border-b border-[#e4e4e0] focus:outline-2 focus:outline-[#22603f]"
              >
                <View class="flex-1 min-w-0 gap-1">
                  <Text class="text-base font-medium text-[#1b1d1c]">{r().name}</Text>
                  <Note>{r().desired_servings} servings</Note>
                </View>
                <Text class="text-sm text-[#5e625f]">
                  {r().missing_products_count
                    ? `${r().missing_products_count} missing`
                    : "Ready to cook"}
                </Text>
              </Button>
            )}
          </Each>
        </View>
      )}
      <Panel
        open={plan()}
        title="Plan a meal"
        onClose={() => plan.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success="" />
            <Action
              label="Add meal"
              primary
              disabled={op.busy() || !recipe() || !day()}
              onPress={() =>
                void op
                  .run(async () => {
                    if (!recipe()) throw new Error("Choose a recipe.");
                    await p.api.save("meal_plan", {
                      day: day(),
                      recipe_id: Number(recipe()),
                      recipe_servings: positive(servings()),
                      type: "recipe",
                    });
                    if (op.alive()) start.set(monday(day()));
                  }, "Meal planned.")
                  .then((ok) => {
                    if (ok) plan.set(false);
                  })
              }
            />
          </View>
        }
      >
        <DateField label="Meal date" value={day()} onChange={(v) => day.set(v)} />
        <Choice
          label="Recipe"
          value={recipe()}
          items={(state.data()?.recipes ?? []).map((r) => ({
            value: String(r.id),
            title: r.name,
          }))}
          onChange={(v) => {
            recipe.set(v);
            servings.set(
              String(state.data()?.recipes.find((r) => String(r.id) === v)?.desired_servings ?? 1),
            );
          }}
        />
        <Field label="Servings" numeric value={servings()} onChange={(v) => servings.set(v)} />
      </Panel>
      <Panel
        open={detailOpen()}
        title={detail()?.cards?.[0]?.name ?? "Recipe"}
        onClose={() => detailOpen.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success={op.success()} />
            {Number(meal()?.entry.done) ? (
              <Note>This meal is already marked cooked.</Note>
            ) : (
              <Action
                label={confirm() ? "Confirm cooking" : "Cook"}
                primary
                disabled={op.busy()}
                onPress={() => {
                  if (!confirm()) {
                    confirm.set(true);
                    return;
                  }
                  void op
                    .run(
                      () =>
                        meal()
                          ? p.api.post(`/api/v2/meal-plan/${meal()!.id}/consume`)
                          : p.api.post(
                              `/api/v2/recipes/${detail()!.recipe_id}/consume?servings=${positive(cookServings())}`,
                            ),
                      "Ingredients consumed.",
                    )
                    .then((ok) => {
                      if (ok) detailOpen.set(false);
                    });
                }}
              />
            )}
            <Action
              label="Shop for missing ingredients"
              disabled={op.busy()}
              onPress={() =>
                void op.run(
                  () =>
                    p.api.post(
                      `/api/v2/recipes/${detail()!.recipe_id}/add-not-fulfilled-products-to-shoppinglist?servings=${positive(cookServings())}`,
                    ),
                  "Missing ingredients added to shopping.",
                )
              }
            />
          </View>
        }
      >
        {confirm() ? (
          <Note>
            Cooking will deduct these ingredients from stock. Check the amounts, then confirm.
          </Note>
        ) : null}
        {!meal() ? (
          <Field
            label="Servings to cook"
            numeric
            value={cookServings()}
            onChange={(v) => {
              cookServings.set(v);
              confirm.set(false);
            }}
          />
        ) : null}
        <Each of={(detail()?.cards ?? []) as Row[]}>
          {(card) => (
            <View class="gap-3">
              <Each of={card().ingredients as Row[]}>
                {(i) => (
                  <Line>
                    <View class="flex-row justify-between gap-2">
                      <Text class="flex-1 text-sm text-[#1b1d1c]">{i().product_name}</Text>
                      <Text class="text-sm text-[#1b1d1c]">
                        {Number(
                          (
                            (Number(i().amount) * (Number(cookServings()) || 1)) /
                            (Number(card().desired_servings) || 1)
                          ).toFixed(3),
                        )}
                      </Text>
                    </View>
                    <Note>{i().fulfilled ? "In stock" : "Check stock for this ingredient"}</Note>
                  </Line>
                )}
              </Each>
              <Text class="text-base text-[#1b1d1c]">{plain(card().preparation_html)}</Text>
            </View>
          )}
        </Each>
      </Panel>
    </View>
  );
}
