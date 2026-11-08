import { Text, View } from "nsh";
import { Api, type Row } from "../api";
import { remote, LoadState } from "../data";
import { Action, Heading, Note, dueDays } from "../ui";
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
  return (
    <View class="gap-6">
      <Heading title="Your household" />
      <Note>A quick look at your groceries and what needs doing.</Note>
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      {state.data() ? (
        <View class="gap-6">
          <View class="gap-4 py-5 border-b border-[#e4e4e0]">
            <Action label="Stock overview" quiet onPress={() => p.navigate("Stock")} />
            <Text class="text-base text-[#1b1d1c]">
              {state.data()!.rows.filter((r) => Number(r.amount) > 0).length} products in stock
            </Text>
            <Note>
              {
                state
                  .data()!
                  .rows.filter(
                    (r) => Number(r.amount) > 0 && (dueDays(r.best_before_date) ?? 99) < 0,
                  ).length
              }{" "}
              overdue ·{" "}
              {
                state
                  .data()!
                  .rows.filter(
                    (r) =>
                      Number(r.amount) > 0 &&
                      (dueDays(r.best_before_date) ?? 99) >= 0 &&
                      (dueDays(r.best_before_date) ?? 99) <= 5,
                  ).length
              }{" "}
              due within five days
            </Note>
            <View class="flex-row flex-wrap gap-2">
              <Action label="Purchase" primary onPress={() => p.batch("Purchase")} />
              <Action label="Consume" onPress={() => p.batch("Consume")} />
              <Action label="Open stock" onPress={() => p.batch("Open")} />
              <Action label="Inventory" onPress={() => p.batch("Inventory")} />
            </View>
          </View>
          <View class="gap-3 pb-5 border-b border-[#e4e4e0]">
            <Heading title="Shopping lists" />
            <Note>
              {state.data()!.lists.length} {state.data()!.lists.length === 1 ? "list" : "lists"} for
              your next trip. Open a list to add items or start in-store mode.
            </Note>
            <Action label="Open shopping lists" onPress={() => p.navigate("Shopping")} />
          </View>
          <View class="gap-3 pb-5 border-b border-[#e4e4e0]">
            <Heading title="Recipes and meals" />
            <Note>
              {state.data()!.recipes.length} recipes. Plan your week, check ingredients, and cook
              from stock.
            </Note>
            <Action label="Plan meals" onPress={() => p.navigate("Meals")} />
          </View>
          <View class="gap-3">
            <Heading title="Household routines" />
            <Note>Keep up with tasks, recurring chores, and batteries.</Note>
            <Action label="View chores" onPress={() => p.navigate("Chores")} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
