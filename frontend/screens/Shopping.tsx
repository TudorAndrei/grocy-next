import { signal, Text, View } from "nsh";
import { Api, message, positive, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import { Action, Choice, Field, Heading, Note, Panel, Toggle } from "../ui";
export function Shopping(p: { api: Api }) {
  const list = signal(""),
    adding = signal(false),
    product = signal(""),
    amount = signal("1"),
    note = signal(""),
    receipt = signal(""),
    transactions = signal<string[]>([]);
  const state = remote(async (s) => {
    const [lists, products, units] = await Promise.all([
      p.api.request<Row[]>("/api/v2/shopping-lists", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/products", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/quantity_units", "GET", undefined, s),
    ]);
    const id = list() || String(lists[0]?.id ?? "");
    if (!s.aborted) list.set(id);
    const result = id
      ? await p.api.request<Row>(
          `/api/v2/shopping-lists/${id}`,
          "GET",
          undefined,
          s,
        )
      : { items: [] };
    return { lists, products, units, items: result.items as Row[] };
  });
  const checking = signal<Set<number>>(new Set());
  const checkError = signal("");
  const op = operations(state.refresh);
  const checked = () => state.data()?.items.filter((r) => r.done) ?? [];
  const title = (r: Row) =>
    state.data()?.products.find((i) => Number(i.id) === Number(r.product_id))
      ?.name ??
    r.note ??
    "Shopping item";
  const unit = (id: unknown) =>
    state.data()?.units.find((i) => String(i.id) === String(id))?.name ?? "";
  async function toggle(row: Row, value: boolean) {
    if (checking().has(row.id) || op.busy()) return;
    checking.set(new Set([...checking(), row.id]));
    checkError.set("");
    state.data.update((data) =>
      data
        ? {
            ...data,
            items: data.items.map((r) =>
              r.id === row.id ? { ...r, done: value } : r,
            ),
          }
        : data,
    );
    try {
      await p.api.save("shopping_list", { done: value ? 1 : 0 }, row.id);
    } catch (error) {
      if (op.alive()) {
        checkError.set(message(error));
        state.data.update((data) =>
          data
            ? {
                ...data,
                items: data.items.map((r) =>
                  r.id === row.id ? { ...r, done: !value } : r,
                ),
              }
            : data,
        );
      }
    } finally {
      if (op.alive())
        checking.set(new Set([...checking()].filter((id) => id !== row.id)));
    }
  }
  async function receive() {
    const items = checked().slice();
    let count = 0;
    const failed: string[] = [],
      ids: string[] = [];
    const ok = await op.run(async () => {
      for (const item of items) {
        if (!op.alive()) break;
        try {
          const result = await p.api.post(
            `/api/v2/shopping-lists/${list()}/items/${item.id}/purchase`,
          );
          count++;
          for (const booking of result.bookings ?? [])
            if (booking.transaction_id && !ids.includes(booking.transaction_id))
              ids.push(booking.transaction_id);
        } catch (e) {
          failed.push(`${title(item)}: ${message(e)}`);
        }
      }
    }, "");
    if (ok) {
      transactions.set(ids);
      receipt.set(
        `${count} ${count === 1 ? "item" : "items"} put away.${failed.length ? ` ${failed.length} failed — ${failed.join("; ")}` : ""}`,
      );
    }
  }
  return (
    <View class="gap-4">
      <View class="flex-row justify-between items-center">
        <Heading title="Shopping" />
        <Action
          label="Add item"
          primary
          disabled={!list()}
          onPress={() => {
            product.set("");
            amount.set("1");
            note.set("");
            adding.set(true);
          }}
        />
      </View>
      {(state.data()?.lists.length ?? 0) > 1 ? (
        <Choice
          label="Shopping list"
          value={list()}
          items={state
            .data()!
            .lists.map((r) => ({ value: String(r.id), title: r.name }))}
          onChange={(v) => {
            list.set(v);
            void state.refresh();
          }}
        />
      ) : null}
      <LoadState
        loading={state.loading()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback error={op.error() || checkError()} success={op.success()} />
      <View>
        <Each
          of={(state.data()?.items ?? [])
            .slice()
            .sort((a, b) => Number(a.done) - Number(b.done))}
        >
          {(r) => (
            <View class="min-h-16 flex-row items-center gap-3 border-b border-[#e4e4e0] py-2">
              <View class="flex-1 min-w-0">
                <Toggle
                  label={title(r())}
                  checked={Boolean(r().done)}
                  disabled={op.busy() || checking().has(r().id)}
                  onChange={(v) => void toggle(r(), v)}
                />
                {r().note && r().product_id ? <Note>{r().note}</Note> : null}
              </View>
              <Text class="text-sm text-[#5e625f]">
                {r().amount} {unit(r().qu_id)}
              </Text>
            </View>
          )}
        </Each>
      </View>
      {!state.loading() && !state.error() && !state.data()?.items.length ? (
        <View class="py-6 gap-2">
          <Text class="text-base font-medium text-[#1b1d1c]">
            Your list is clear.
          </Text>
          <Note>
            Add an item, or bring across products below their minimum stock.
          </Note>
        </View>
      ) : null}
      {list() ? (
        <Action
          label="Add below-minimum products"
          quiet
          disabled={op.busy()}
          onPress={() =>
            void op.run(
              () =>
                p.api.post("/api/stock/shoppinglist/add-missing-products", {
                  list_id: Number(list()),
                }),
              "Missing products added.",
            )
          }
        />
      ) : null}
      {checked().length ? (
        <View class="bg-white border border-[#e4e4e0] rounded-xl p-4 gap-3">
          <Action
            label={`Put away ${checked().length} ${checked().length === 1 ? "item" : "items"}`}
            primary
            disabled={op.busy() || checking().size > 0}
            onPress={() => void receive()}
          />
          <Note>
            Dates and locations use product defaults. Items are removed from
            this list.
          </Note>
        </View>
      ) : null}
      {receipt() ? (
        <View class="bg-[#edf2ee] rounded-lg p-3 gap-2">
          <Note>{receipt()}</Note>
          {transactions().length ? (
            <View class="gap-2">
              <Action
                label="Undo stock changes"
                quiet
                disabled={op.busy()}
                onPress={() =>
                  void op.run(async () => {
                    const pending = transactions().slice();
                    while (pending.length) {
                      await p.api.post(
                        `/api/stock/transactions/${pending[0]}/undo`,
                      );
                      pending.shift();
                      if (op.alive()) transactions.set(pending.slice());
                    }
                    if (op.alive())
                      receipt.set(
                        "Stock changes undone. Shopping items have not been restored.",
                      );
                  }, "")
                }
              />
              <Note>
                Undo restores stock only, not the removed shopping items.
              </Note>
            </View>
          ) : null}
        </View>
      ) : null}
      <Panel
        open={adding()}
        title="Add shopping item"
        onClose={() => adding.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success="" />
            <Action
              label="Add to list"
              primary
              disabled={op.busy() || !product()}
              onPress={() =>
                void op
                  .run(
                    () =>
                      p.api.post("/api/v2/shopping-lists/items", {
                        product_id: Number(product()),
                        amount: positive(amount()),
                        note: note(),
                        shopping_list_id: Number(list()),
                      }),
                    "Item added.",
                  )
                  .then((ok) => {
                    if (ok) adding.set(false);
                  })
              }
            />
          </View>
        }
      >
        <Choice
          label="Product to add"
          value={product()}
          items={(state.data()?.products ?? []).map((r) => ({
            value: String(r.id),
            title: r.name,
          }))}
          onChange={(v) => product.set(v)}
        />
        <Field
          label={`Quantity${product() ? ` (${unit(state.data()?.products.find((r) => String(r.id) === product())?.qu_id_purchase)})` : ""}`}
          numeric
          value={amount()}
          onChange={(v) => amount.set(v)}
        />
        <Field
          label="Note (optional)"
          value={note()}
          onChange={(v) => note.set(v)}
        />
      </Panel>
    </View>
  );
}
