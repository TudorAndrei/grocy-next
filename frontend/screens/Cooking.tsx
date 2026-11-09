import { signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Api, plain, positive, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import {
  Action,
  Choice,
  DateField,
  Empty,
  Field,
  Heading,
  Icon,
  Note,
  Panel,
  Search,
  Subheading,
  Tabs,
  addDays,
  dateISO,
  type IconName,
} from "../ui";

const focusRing = "focus:outline-2 focus:outline-offset-2 focus:outline-ring";

function monday(day: string) {
  const date = new Date(day + "T12:00:00");
  return addDays(day, -((date.getDay() + 6) % 7));
}
function at(value: string) {
  return new Date(value.slice(0, 10) + "T12:00:00");
}
function dayMonth(value: string) {
  return at(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
/** "9–15 Nov", or "30 Nov – 6 Dec" when the week crosses a month. */
function weekRange(start: string) {
  const end = addDays(start, 6);
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${at(start).getDate()}–${dayMonth(end)}`
    : `${dayMonth(start)} – ${dayMonth(end)}`;
}
function count(n: number, one: string, many = one + "s") {
  return `${Number(n.toFixed(3))} ${n === 1 ? one : many}`;
}

/** A quiet square icon button; the label is for assistive tech. */
function IconButton(p: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      accessibilityLabel={p.label}
      onPress={p.onPress}
      disabled={p.disabled}
      class={`w-11 h-11 md:w-9 md:h-9 rounded-lg items-center justify-center hover:bg-accent active:bg-accent ${focusRing} disabled:opacity-40`}
    >
      <Icon name={p.icon} size={16} />
    </Button>
  );
}

export function Meals(p: { api: Api }) {
  const start = signal(monday(dateISO())),
    tab = signal("Week"),
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
      p.api.request<Row>(
        `/api/v2/meal-plan/calendar?start=${start()}`,
        "GET",
        undefined,
        s,
      ),
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
  function go(value: string) {
    start.set(value);
    void state.refresh();
  }
  async function view(id: number, entry: Row | null = null) {
    await op.run(async () => {
      const value = await p.api.request<Row>(`/api/v2/recipes/${id}/view`);
      if (op.alive()) {
        detail.set(value);
        meal.set(entry);
        cookServings.set(
          String(
            entry?.entry?.recipe_servings ??
              value.cards?.[0]?.desired_servings ??
              1,
          ),
        );
        confirm.set(false);
        detailOpen.set(true);
      }
    }, "");
  }
  const recipes = () =>
    state
      .data()
      ?.recipes.filter((r) =>
        r.name.toLowerCase().includes(query().toLowerCase()),
      )
      .slice()
      .sort(
        (a, b) =>
          Number(a.missing_products_count) - Number(b.missing_products_count) ||
          a.name.localeCompare(b.name),
      ) ?? [];
  const events = (value: string): Row[] =>
    state.data()?.calendar.events.filter((r: Row) => r.start === value) ?? [];
  const unitName = (id: unknown, amount: number) => {
    const u = (state.data()?.calendar.units ?? []).find(
      (r: Row) => String(r.id) === String(id),
    );
    if (!u) return "";
    return String(
      (amount === 1 ? u.name : u.name_plural || u.name) ?? "",
    ).toLowerCase();
  };
  const sectionName = (entry: Row) =>
    String(
      (state.data()?.calendar.sections ?? []).find(
        (r: Row) => String(r.id) === String(entry.entry?.section_id),
      )?.name ?? "",
    );
  const week = () => Array.from({ length: 7 }, (_, i) => addDays(start(), i));
  // Only show a section column when this week actually uses named sections.
  const hasSections = () =>
    week().some((d) => events(d).some((e) => sectionName(e) !== ""));
  const title = (entry: Row) =>
    entry.title ||
    entry.product_details?.product?.name ||
    plain(entry.note_html) ||
    "Meal";
  const amount = (entry: Row) => {
    if (entry.entry?.recipe_id)
      return count(Number(entry.entry.recipe_servings) || 1, "serving");
    if (entry.product_details) {
      const n = Number(entry.entry?.product_amount) || 0;
      return `${Number(n.toFixed(3))} ${unitName(entry.entry?.product_qu_id, n)}`.trim();
    }
    return "Note";
  };
  const products = (r: Row) =>
    String(r.product_names ?? "")
      .split(",")
      .filter(Boolean)
      .join(", ");
  const thisWeek = () => start() === monday(dateISO());
  const recipeTotal = () => state.data()?.recipes.length ?? 0;

  // Components run once (no re-rendering): every changing value is read
  // inside JSX through a function call or a prop access so it stays live.
  function Entry(e: { entry: Row }) {
    const cooked = () => Number(e.entry.entry?.done) > 0;
    const body = () => (
      <View class="flex-1 min-w-0 md:flex-row md:items-center gap-0.5 md:gap-4">
        {hasSections() ? (
          <View class="hidden md:flex md:w-24 shrink-0">
            <Text class="text-[13px] text-muted-foreground">
              {sectionName(e.entry)}
            </Text>
          </View>
        ) : null}
        <View class="flex-row items-center gap-2 md:flex-1 min-w-0">
          {cooked() ? <Icon name="check" size={15} /> : null}
          <Text
            style={{ numberOfLines: 1 }}
            class={`flex-1 min-w-0 text-[15px] ${cooked() ? "text-muted-foreground" : "text-foreground"}`}
          >
            {`${title(e.entry)}${cooked() ? " · Cooked" : ""}`}
          </Text>
        </View>
        <Text class="md:hidden text-[13px] text-muted-foreground tabular-nums">
          {[sectionName(e.entry), amount(e.entry)].filter(Boolean).join(" · ")}
        </Text>
        <Text class="hidden md:flex md:w-28 justify-end text-right text-[13px] text-muted-foreground tabular-nums">
          {amount(e.entry)}
        </Text>
      </View>
    );
    return (
      <View class="flex-row items-center gap-1 min-h-[60px] md:min-h-11 border-t border-border first:border-t-0">
        {e.entry.entry?.recipe_id ? (
          <Button
            onPress={() => void view(Number(e.entry.entry.recipe_id), e.entry)}
            class={`flex-1 min-w-0 self-stretch flex-row items-center py-2 md:py-0 md:px-2 md:-ml-2 rounded-md hover:bg-accent ${focusRing}`}
          >
            {body()}
          </Button>
        ) : (
          <View class="flex-1 min-w-0 self-stretch flex-row items-center py-2 md:py-0 md:px-2 md:-ml-2">
            {body()}
          </View>
        )}
        <IconButton
          icon="trash"
          label={`Remove ${title(e.entry)}`}
          disabled={op.busy()}
          onPress={() =>
            void op.run(
              () =>
                p.api.request(`/api/objects/meal_plan/${e.entry.id}`, "DELETE"),
              "Meal removed.",
            )
          }
        />
      </View>
    );
  }

  function Day(d: { value: string }) {
    const today = () => d.value === dateISO();
    const add_ = () => (
      <Action
        label="Add"
        icon="plus"
        compact
        quiet
        accessibilityLabel={`Plan ${d.value}`}
        onPress={() => add(d.value)}
      />
    );
    return (
      <View class="border-b border-border py-1.5 md:py-1 md:flex-row md:items-start md:gap-4">
        <View class="flex-row items-center justify-between min-h-11 md:w-44 md:shrink-0">
          <View class="flex-row items-center gap-2 min-w-0">
            <View
              class={`w-1.5 h-1.5 rounded-full ${today() ? "bg-primary" : "bg-transparent"}`}
            />
            <Text
              class={`text-[15px] ${today() ? "font-semibold text-foreground" : d.value < dateISO() ? "text-muted-foreground" : "font-medium text-ink-soft"}`}
            >
              {at(d.value).toLocaleDateString("en-GB", { weekday: "long" })}
            </Text>
            <Text
              class={`text-[13px] tabular-nums ${today() ? "text-foreground" : "text-muted-foreground"}`}
            >
              {dayMonth(d.value)}
            </Text>
          </View>
          <View class="md:hidden">{add_()}</View>
        </View>
        <View class="flex-1 min-w-0 pl-3.5 md:pl-0">
          {events(d.value).length === 0 ? (
            <View class="min-h-9 md:min-h-11 justify-center pb-1.5 md:pb-0">
              <Text class="text-sm text-muted-foreground">Nothing planned</Text>
            </View>
          ) : (
            <Each of={events(d.value)} key={(r: Row) => r.id}>
              {(entry) => <Entry entry={entry()} />}
            </Each>
          )}
        </View>
        <View class="hidden md:flex h-11 justify-center">{add_()}</View>
      </View>
    );
  }

  function Recipes() {
    return (
      <View>
        <View class="hidden md:flex flex-row items-center gap-4 py-2 px-2 -mx-2 border-b border-border">
          <Text class="flex-1 text-[13px] text-muted-foreground">Name</Text>
          <Text class="w-24 text-right text-[13px] text-muted-foreground">
            Servings
          </Text>
          <Text class="w-32 text-right text-[13px] text-muted-foreground">
            Stock
          </Text>
        </View>
        {recipes().length === 0 && !state.loading() ? (
          recipeTotal() === 0 ? (
            <Empty
              title="No recipes yet"
              detail="Recipes you add in Settings appear here, sorted by what you can cook now."
            />
          ) : (
            <Empty
              title={`No recipes match “${query()}”`}
              detail="Try a shorter name."
            >
              <Action label="Clear search" quiet onPress={() => query.set("")} />
            </Empty>
          )
        ) : null}
        <Each of={recipes()} key={(r: Row) => r.id}>
          {(r) => (
            <Button
              onPress={() => void view(r().id)}
              class={`flex-row items-center gap-4 min-h-16 md:min-h-[52px] py-2 md:px-2 md:-mx-2 rounded-md border-b border-border hover:bg-accent ${focusRing}`}
            >
              <View class="flex-1 min-w-0 gap-0.5">
                <Text
                  style={{ numberOfLines: 1 }}
                  class="text-[15px] font-medium text-foreground"
                >
                  {r().name}
                </Text>
                <Text
                  style={{ numberOfLines: 1 }}
                  class="md:hidden text-[13px] text-muted-foreground"
                >
                  {[
                    count(Number(r().desired_servings) || 1, "serving"),
                    products(r()),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {products(r()) ? (
                  <Text
                    style={{ numberOfLines: 1 }}
                    class="hidden md:flex text-[13px] text-muted-foreground"
                  >
                    {products(r())}
                  </Text>
                ) : null}
              </View>
              <Text class="hidden md:flex w-24 justify-end text-right text-[13px] tabular-nums text-muted-foreground">
                {String(Number(r().desired_servings) || 1)}
              </Text>
              <View class="md:w-32 items-end">
                {Number(r().missing_products_count) ? (
                  <Text class="text-[13px] tabular-nums text-destructive">
                    {`${r().missing_products_count} missing`}
                  </Text>
                ) : (
                  <Text class="text-[13px] text-muted-foreground">
                    Ready to cook
                  </Text>
                )}
              </View>
            </Button>
          )}
        </Each>
      </View>
    );
  }

  function Ingredients(c: { card: Row }) {
    const items = (): Row[] => c.card.ingredients ?? [];
    const missing = () => items().filter((i) => !i.fulfilled).length;
    const scaled = (i: Row) =>
      (Number(i.amount) * (Number(cookServings()) || 1)) /
      (Number(c.card.desired_servings) || 1);
    return (
      <View class="gap-6">
        <View class="gap-1">
          <Subheading
            title="Ingredients"
            detail={missing() ? `${missing()} missing` : String(items().length)}
          />
          <View>
            <Each of={items()}>
              {(i) => (
                <View class="flex-row items-center gap-3 min-h-14 py-2 border-b border-border">
                  <View class="flex-1 min-w-0 gap-0.5">
                    <Text class="text-[15px] text-foreground">
                      {i().product_name}
                    </Text>
                    <Text
                      class={`text-[13px] ${i().fulfilled ? "text-muted-foreground" : "text-destructive"}`}
                    >
                      {i().fulfilled ? "In stock" : "Not enough in stock"}
                    </Text>
                  </View>
                  <Text class="text-[15px] tabular-nums text-foreground">
                    {`${Number(scaled(i()).toFixed(3))} ${unitName(i().qu_id, scaled(i()))}`.trim()}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </View>
        {plain(c.card.preparation_html) ? (
          <View class="gap-2">
            <Subheading title="Preparation" />
            <Text class="text-[15px] leading-6 text-ink-soft">
              {plain(c.card.preparation_html)}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View class="gap-5">
      <View class="flex-row justify-between items-center gap-3 min-h-11">
        <Heading
          title="Meals"
          detail={
            tab() === "Week"
              ? weekRange(start())
              : state.data()
                ? count(recipeTotal(), "recipe")
                : undefined
          }
        />
        <Action
          label="Plan a meal"
          icon="plus"
          primary
          onPress={() => add(thisWeek() ? dateISO() : start())}
        />
      </View>
      <View class="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Tabs
          items={["Week", "Recipes"]}
          value={tab()}
          onChange={(v) => tab.set(v)}
        />
        {tab() === "Week" ? (
          <View class="flex-row items-center gap-1">
            <IconButton
              icon="chevron-left"
              label="Previous week"
              onPress={() => go(addDays(start(), -7))}
            />
            <IconButton
              icon="chevron-right"
              label="Next week"
              onPress={() => go(addDays(start(), 7))}
            />
            <Action
              label="This week"
              quiet
              compact
              disabled={thisWeek()}
              onPress={() => go(monday(dateISO()))}
            />
          </View>
        ) : (
          <View class="w-full md:w-72 flex-row">
            <Search
              label="Search recipes"
              value={query()}
              onChange={(v) => query.set(v)}
            />
          </View>
        )}
      </View>
      <LoadState
        loading={state.loading() && !state.data()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback error={op.error()} success={op.success()} />
      {!state.data() ? null : tab() === "Week" ? (
        <View class={`border-t border-border ${state.loading() ? "opacity-60" : ""}`}>
          <Each of={week()}>{(value) => <Day value={value()} />}</Each>
        </View>
      ) : (
        <Recipes />
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
        <DateField
          label="Meal date"
          value={day()}
          onChange={(v) => day.set(v)}
        />
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
              String(
                state.data()?.recipes.find((r) => String(r.id) === v)
                  ?.desired_servings ?? 1,
              ),
            );
          }}
        />
        <Field
          label="Servings"
          numeric
          value={servings()}
          onChange={(v) => servings.set(v)}
        />
        {(state.data()?.recipes.length ?? 1) === 0 ? (
          <Note>No recipes yet. Add one in Settings, then plan it here.</Note>
        ) : null}
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
              <View class="flex-row items-center gap-2 min-h-11">
                <Icon name="check" size={15} />
                <Note>This meal is already marked cooked.</Note>
              </View>
            ) : (
              <Action
                label={confirm() ? "Confirm cooking" : "Cook"}
                icon={confirm() ? "check" : "utensils"}
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
                          ? p.api.post(
                              `/api/v2/meal-plan/${meal()!.id}/consume`,
                            )
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
              icon="cart"
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
          <View class="flex-row gap-2.5 rounded-lg bg-saffron-soft px-3 py-2.5">
            <Icon name="alert" size={15} tint="foreground" />
            <Text class="flex-1 min-w-0 text-sm leading-5 text-foreground">
              Cooking will deduct these ingredients from stock. Check the
              amounts, then confirm.
            </Text>
          </View>
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
        ) : (
          <Note>
            {`Planned for ${at(meal()!.start).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })} · ${count(Number(cookServings()) || 1, "serving")}`}
          </Note>
        )}
        <Each of={(detail()?.cards ?? []) as Row[]}>
          {(card) => <Ingredients card={card()} />}
        </Each>
      </Panel>
    </View>
  );
}
