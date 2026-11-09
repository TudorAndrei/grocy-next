import { signal, Text, View } from "nsh";
import { Checkbox } from "nsh/base";
import { Api, message, positive, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import {
  Action,
  Choice,
  Empty,
  Field,
  Heading,
  Icon,
  Note,
  Panel,
  Segments,
  Subheading,
} from "../ui";

/** "6", "0.5", "1.25": amounts without trailing zeros. */
function figure(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

/**
 * One item on the list. The whole row is the checkbox, so a thumb anywhere on
 * it ticks the item off; checked items are struck through like a pen mark.
 */
function Item(p: {
  title: string;
  amount: string;
  note: string;
  done: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const meta = [p.amount, p.note].filter(Boolean).join(" · ");
  return (
    <Checkbox
      accessibilityLabel={p.title}
      checked={p.done}
      disabled={p.disabled}
      onChange={(e) => p.onChange(e.checked)}
      class="flex-row items-center gap-3.5 min-h-[60px] md:min-h-[52px] py-2 md:py-1.5 md:px-3 border-b border-border md:hover:bg-card focus:outline-2 focus:outline-ring disabled:opacity-40"
      indicatorClass="w-[22px] h-[22px] md:w-[18px] md:h-[18px] items-center justify-center border-[1.5px] border-input bg-card rounded-md md:rounded-[5px] checked:bg-secondary checked:border-input"
      indicator={
        p.done ? (
          <Icon name="check" size={14} tint="foreground" />
        ) : null
      }
    >
      <View class="flex-1 min-w-0 gap-0.5">
        <Text
          style={{ numberOfLines: 2 }}
          class={`text-[15px] font-medium ${p.done ? "text-muted-foreground line-through decoration-faint" : "text-foreground"}`}
        >
          {p.title}
        </Text>
        {meta ? (
          <Text
            style={{ numberOfLines: 1 }}
            class={`md:hidden text-[13px] tabular-nums text-muted-foreground`}
          >
            {meta}
          </Text>
        ) : null}
      </View>
      <Text
        style={{ numberOfLines: 1 }}
        class={`hidden md:flex w-64 text-[13px] text-muted-foreground`}
      >
        {p.note}
      </Text>
      <Text
        class={`hidden md:flex w-32 text-right text-sm tabular-nums ${p.done ? "text-muted-foreground" : "text-foreground"}`}
      >
        {p.amount}
      </Text>
    </Checkbox>
  );
}

export function Shopping(p: { api: Api }) {
  const list = signal(""),
    adding = signal(false),
    product = signal(""),
    amount = signal("1"),
    note = signal(""),
    receipt = signal(""),
    receiptFailed = signal(false),
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
  const items = () => state.data()?.items ?? [];
  const open = () => items().filter((r) => !r.done);
  const checked = () => items().filter((r) => r.done);
  const title = (r: Row) =>
    state.data()?.products.find((i) => Number(i.id) === Number(r.product_id))
      ?.name ??
    r.note ??
    "Shopping item";
  const unitRow = (id: unknown) =>
    state.data()?.units.find((i) => String(i.id) === String(id));
  const unit = (id: unknown) => unitRow(id)?.name ?? "";
  const quantity = (r: Row) => {
    const n = figure(r.amount);
    const u = unitRow(r.qu_id);
    const name = u
      ? Number(r.amount) === 1
        ? u.name
        : (u.name_plural ?? u.name)
      : "";
    return [n, name].filter(Boolean).join(" ");
  };
  const itemNote = (r: Row) => (r.note && r.product_id ? String(r.note) : "");
  const detail = () => {
    if (!state.data() || !items().length) return undefined;
    return open().length ? `${open().length} left` : "All in the basket";
  };
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
      receiptFailed.set(failed.length > 0);
      receipt.set(
        `${count} ${count === 1 ? "item" : "items"} put away.${failed.length ? ` ${failed.length} failed — ${failed.join("; ")}` : ""}`,
      );
    }
  }
  const row = (r: () => Row) => (
    <Item
      title={title(r())}
      amount={quantity(r())}
      note={itemNote(r())}
      done={Boolean(r().done)}
      disabled={op.busy() || checking().has(r().id)}
      onChange={(v) => void toggle(r(), v)}
    />
  );
  return (
    <View class="gap-5">
      <View class="flex-row items-center justify-between gap-3 min-h-11">
        <Heading title="Shopping" detail={detail()} />
        {checked().length ? (
          <Action
            label={`Put away ${checked().length} ${checked().length === 1 ? "item" : "items"}`}
            icon="check"
            primary
            disabled={op.busy() || checking().size > 0}
            onPress={() => void receive()}
          />
        ) : null}
      </View>
      {(state.data()?.lists.length ?? 0) > 1 ? (
        <Segments
          label="Shopping list"
          value={list()}
          items={state.data()!.lists.map((r) => ({
            value: String(r.id),
            label: String(r.name),
            count: r.item_count == null ? undefined : Number(r.item_count),
          }))}
          onChange={(v) => {
            if (v === list()) return;
            list.set(v);
            void state.refresh();
          }}
        />
      ) : null}
      <LoadState
        loading={state.loading() && !state.data()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback error={op.error() || checkError()} success={op.success()} />
      {receipt() ? (
        <View class="flex-row items-start gap-3 rounded-lg border border-border bg-card pl-3 pr-1.5 py-1.5">
          <View class="pt-2.5">
            <Icon
              name={receiptFailed() ? "alert" : "check"}
              size={15}
              tint={receiptFailed() ? "destructive" : "foreground"}
            />
          </View>
          <View class="flex-1 min-w-0 gap-0.5 py-2">
            <Text class="text-sm text-foreground">{receipt()}</Text>
            {transactions().length ? (
              <Note>
                Undo restores stock only, not the removed shopping items.
              </Note>
            ) : null}
          </View>
          {transactions().length ? (
            <Action
              label="Undo stock changes"
              icon="undo"
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
                  if (op.alive()) {
                    receiptFailed.set(false);
                    receipt.set(
                      "Stock changes undone. Shopping items have not been restored.",
                    );
                  }
                }, "")
              }
            />
          ) : (
            <Action
              label="Dismiss"
              accessibilityLabel="Dismiss summary"
              icon="x"
              quiet
              compact
              onPress={() => receipt.set("")}
            />
          )}
        </View>
      ) : null}
      <View class="gap-2">
        {list() ? (
          <View class="flex-row flex-wrap items-center gap-1 -ml-3">
            <Action
              label="Add item"
              icon="plus"
              quiet
              disabled={op.busy()}
              onPress={() => {
                product.set("");
                amount.set("1");
                note.set("");
                op.error.set("");
                adding.set(true);
              }}
            />
            <Action
              label="Add below-minimum products"
              icon="package"
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
          </View>
        ) : null}
        {state.data() && !state.error() ? (
          items().length ? (
            <View class="gap-8">
              {open().length ? (
                <View>
                  <View class="hidden md:flex flex-row items-center gap-3.5 h-9 px-3 border-b border-border">
                    <View class="w-[18px]" />
                    <Text class="flex-1 text-[13px] text-muted-foreground">
                      Item
                    </Text>
                    <Text class="w-64 text-[13px] text-muted-foreground">
                      Note
                    </Text>
                    <Text class="w-32 text-right text-[13px] text-muted-foreground">
                      Amount
                    </Text>
                  </View>
                  <Each of={open()}>{row}</Each>
                </View>
              ) : null}
              {checked().length ? (
                <View>
                  <View class="gap-1 pb-2 border-b border-border">
                    <Subheading
                      title="In the basket"
                      detail={String(checked().length)}
                    />
                    <Text class="text-[13px] text-muted-foreground">
                      Put away uses each product's default date and location,
                      then removes the item from this list.
                    </Text>
                  </View>
                  <Each of={checked()}>{row}</Each>
                </View>
              ) : null}
            </View>
          ) : (
            <Empty
              title="Nothing on the list"
              detail={
                list()
                  ? "Use Add item for anything you need, or Add below-minimum products to bring across everything running low in stock."
                  : "There is no shopping list yet. Create one in Settings under Shopping lists, then add items here."
              }
            />
          )
        ) : null}
      </View>
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
