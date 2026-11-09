import { Text, View, type JSX } from "nsh";
import { Api, type Row } from "../api";
import { remote, LoadState } from "../data";
import { Action, Heading, Note, Subheading, dueDays } from "../ui";

/** A large tabular figure over a short muted label; tone only when the figure means trouble. */
function Figure(p: { value: number; label: string; tone?: "destructive" | "due" }) {
  return (
    <View class="gap-0.5 min-w-[96px]">
      <Text
        class={`text-[28px] leading-9 font-semibold tracking-tight tabular-nums ${p.value && p.tone === "destructive" ? "text-destructive" : p.value && p.tone === "due" ? "text-due" : "text-foreground"}`}
      >
        {String(p.value)}
      </Text>
      <Text class="text-[13px] text-muted-foreground">{p.label}</Text>
    </View>
  );
}

/** A hairline section: title and summary on the left, its way in on the right. */
function Section(p: {
  title: string;
  detail?: string;
  action: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <View class="py-5 border-b border-border gap-4">
      <View class="flex-row items-center justify-between gap-3 min-h-11">
        <Subheading title={p.title} detail={p.detail} />
        {p.action}
      </View>
      {p.children}
    </View>
  );
}

export function Overview(p: {
  api: Api;
  navigate: (page: string) => void;
  batch: (mode: string) => void;
}) {
  const state = remote(async (s) => {
    const [stock, lists, recipes] = await Promise.all([
      p.api.request<Row>("/api/v2/stock/overview", "GET", undefined, s),
      p.api.request<Row[]>("/api/v2/shopping-lists", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/recipes", "GET", undefined, s),
    ]);
    return { rows: stock.rows as Row[], lists, recipes };
  });
  const inStock = () => (state.data()?.rows ?? []).filter((r) => Number(r.amount) > 0);
  const overdue = () => inStock().filter((r) => (dueDays(r.best_before_date) ?? 99) < 0).length;
  const due = () =>
    inStock().filter((r) => {
      const days = dueDays(r.best_before_date) ?? 99;
      return days >= 0 && days <= 5;
    }).length;
  return (
    <View class="gap-5">
      <View class="gap-1">
        <View class="flex-row items-center min-h-11">
          <Heading
            title="Your household"
            detail={state.data() ? `${inStock().length} products in stock` : undefined}
          />
        </View>
        <Note>A quick look at your groceries and what needs doing.</Note>
      </View>
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      {state.data() ? (
        <View class="border-t border-border">
          <Section
            title="Stock"
            action={<Action label="Stock overview" quiet onPress={() => p.navigate("Stock")} />}
          >
            <View class="flex-row flex-wrap gap-x-10 gap-y-4">
              <Figure value={overdue()} label="overdue" tone="destructive" />
              <Figure value={due()} label="due within five days" tone="due" />
            </View>
            <View class="flex-row flex-wrap gap-2">
              <Action label="Purchase" icon="plus" primary onPress={() => p.batch("Purchase")} />
              <Action label="Consume" onPress={() => p.batch("Consume")} />
              <Action label="Open stock" onPress={() => p.batch("Open")} />
              <Action label="Inventory" onPress={() => p.batch("Inventory")} />
            </View>
          </Section>
          <Section
            title="Shopping lists"
            action={
              <Action label="Open shopping lists" quiet onPress={() => p.navigate("Shopping")} />
            }
          >
            <Note>
              {`${state.data()!.lists.length} ${state.data()!.lists.length === 1 ? "list" : "lists"} for your next trip. Open a list to add items or start in-store mode.`}
            </Note>
          </Section>
          <Section
            title="Recipes and meals"
            action={<Action label="Plan meals" quiet onPress={() => p.navigate("Meals")} />}
          >
            <Note>
              {`${state.data()!.recipes.length} recipes. Plan your week, check ingredients, and cook from stock.`}
            </Note>
          </Section>
          <Section
            title="Household routines"
            action={<Action label="View chores" quiet onPress={() => p.navigate("Chores")} />}
          >
            <Note>Keep up with tasks, recurring chores, and batteries.</Note>
          </Section>
        </View>
      ) : null}
    </View>
  );
}
