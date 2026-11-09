import { signal, Text, View } from "nsh";
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
  Search,
  Segments,
  Subheading,
} from "../ui";
import { Item, Progress } from "./ShoppingItem";

/** "6", "0.5", "1.25": amounts without trailing zeros. */
function figure(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

const isDone = (r: Row) => Number(r.done) === 1;
/** A product item's note; a free-text item already shows its note as the title. */
const itemNote = (r: Row) => (r.note && r.product_id ? String(r.note) : "");

export function Shopping(p: { api: Api }) {
  const list = signal(""),
    adding = signal(false),
    editing = signal<Row | null>(null),
    inStore = signal(false),
    search = signal(""),
    managing = signal(false),
    listName = signal(""),
    newList = signal(false),
    deleting = signal(false),
    removing = signal(false),
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
    const id = lists.some((r) => String(r.id) === list()) ? list() : String(lists[0]?.id ?? "");
    if (!s.aborted) list.set(id);
    const result = id
      ? await p.api.request<Row>(`/api/v2/shopping-lists/${id}`, "GET", undefined, s)
      : { items: [] };
    return { lists, products, units, items: result.items as Row[] };
  });
  const checking = signal<Set<number>>(new Set());
  const checkError = signal("");
  const op = operations(state.refresh);
  const items = () => state.data()?.items ?? [];
  const open = () => items().filter((r) => !isDone(r));
  const checked = () => items().filter(isDone);
  const listTitle = () =>
    state.data()?.lists.find((r) => String(r.id) === list())?.name ?? "Shopping list";
  const title = (r: Row) =>
    state.data()?.products.find((i) => Number(i.id) === Number(r.product_id))?.name ??
    r.note ??
    "Shopping item";
  const unitRow = (id: unknown) => state.data()?.units.find((i) => String(i.id) === String(id));
  const unit = (id: unknown) => unitRow(id)?.name ?? "";
  const quantity = (r: Row) => {
    const n = figure(r.amount);
    const u = unitRow(r.qu_id);
    const name = u ? (Number(r.amount) === 1 ? u.name : (u.name_plural ?? u.name)) : "";
    return [n, name].filter(Boolean).join(" ");
  };
  const matches = (r: Row) =>
    `${title(r)} ${r.note ?? ""}`.toLowerCase().includes(search().toLowerCase().trim());
  const shownOpen = () => open().filter(matches);
  const shownChecked = () => checked().filter(matches);
  const busy = () => op.busy() || checking().size > 0 || state.loading();
  const detail = () => {
    if (!state.data() || !items().length) return undefined;
    return open().length ? `${open().length} left` : "All in the basket";
  };
  async function toggle(row: Row, value: boolean) {
    if (checking().has(row.id) || op.busy() || state.loading()) return;
    checking.set(new Set([...checking(), row.id]));
    checkError.set("");
    state.data.update((data) =>
      data
        ? {
            ...data,
            items: data.items.map((r) => (r.id === row.id ? { ...r, done: value } : r)),
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
                items: data.items.map((r) => (r.id === row.id ? { ...r, done: !value } : r)),
              }
            : data,
        );
      }
    } finally {
      if (op.alive()) checking.set(new Set([...checking()].filter((id) => id !== row.id)));
    }
  }
  async function receive() {
    const basket = checked().slice();
    let count = 0;
    const failed: string[] = [],
      ids: string[] = [];
    const ok = await op.run(async () => {
      for (const item of basket) {
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
  function edit(r: Row) {
    editing.set(r);
    product.set(String(r.product_id ?? ""));
    amount.set(String(r.amount));
    note.set(r.note ?? "");
    removing.set(false);
    op.error.set("");
    adding.set(true);
  }
  function manage(create: boolean) {
    newList.set(create);
    listName.set(create ? "" : String(listTitle()));
    deleting.set(false);
    op.error.set("");
    managing.set(true);
  }
  const row = (r: () => Row) => (
    <Item
      title={title(r())}
      amount={quantity(r())}
      note={itemNote(r())}
      done={isDone(r())}
      disabled={op.busy() || checking().has(r().id)}
      onChange={(v) => void toggle(r(), v)}
      large={inStore()}
      onEdit={inStore() ? undefined : () => edit(r())}
      editDisabled={busy()}
    />
  );
  return (
    <View class="gap-5">
      {inStore() ? (
        <View class="flex-row items-center justify-between gap-3 min-h-11">
          <View class="flex-1 min-w-0">
            <Heading title={String(listTitle())} />
          </View>
          <Action
            label="Finish in-store mode"
            icon="check"
            primary
            onPress={() => {
              inStore.set(false);
              search.set("");
            }}
          />
        </View>
      ) : (
        <View class="flex-row items-center justify-between gap-3 min-h-11">
          <Heading title="Shopping" detail={detail()} />
          {checked().length ? (
            <Action
              label={`Put away ${checked().length} ${checked().length === 1 ? "item" : "items"}`}
              icon="check"
              primary
              disabled={busy()}
              onPress={() => void receive()}
            />
          ) : null}
        </View>
      )}
      {inStore() ? (
        <View class="gap-3">
          <Progress done={checked().length} total={items().length} />
          <Text class="text-[13px] text-muted-foreground">
            Checks sync with your server. Keep this connection open while shopping.
          </Text>
        </View>
      ) : (
        <View
          class={`flex-row flex-wrap items-center gap-x-1 gap-y-2 ${(state.data()?.lists.length ?? 0) > 1 ? "" : "-ml-3"}`}
        >
          {(state.data()?.lists.length ?? 0) > 1 ? (
            <View class="mr-2 max-w-full">
              <Segments
                label="Shopping list"
                value={list()}
                items={state.data()!.lists.map((r) => ({
                  value: String(r.id),
                  label: String(r.name),
                  count: r.item_count == null ? undefined : Number(r.item_count),
                }))}
                onChange={(v) => {
                  if (v === list() || op.busy() || checking().size > 0) return;
                  list.set(v);
                  void state.refresh();
                }}
              />
            </View>
          ) : null}
          <Action label="New list" quiet disabled={busy()} onPress={() => manage(true)} />
          {list() ? (
            <Action label="Manage list" quiet disabled={busy()} onPress={() => manage(false)} />
          ) : null}
        </View>
      )}
      <View class="flex-row items-center gap-2">
        <Search
          label="Search shopping items"
          placeholder="Product or note"
          value={search()}
          onChange={(v) => search.set(v)}
        />
        {inStore() ? null : (
          <Action
            label="In-store mode"
            icon="cart"
            disabled={!list() || state.loading()}
            onPress={() => {
              inStore.set(true);
              search.set("");
            }}
          />
        )}
      </View>
      <LoadState
        loading={state.loading() && !state.data()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback
        error={adding() || managing() ? checkError() : op.error() || checkError()}
        success={op.success()}
      />
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
              <Note>Undo restores stock only, not the removed shopping items.</Note>
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
                    await p.api.post(`/api/stock/transactions/${pending[0]}/undo`);
                    pending.shift();
                    if (op.alive()) transactions.set(pending.slice());
                  }
                  if (op.alive()) {
                    receiptFailed.set(false);
                    receipt.set("Stock changes undone. Shopping items have not been restored.");
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
              disabled={busy()}
              onPress={() => {
                editing.set(null);
                removing.set(false);
                product.set("");
                amount.set("1");
                note.set("");
                op.error.set("");
                adding.set(true);
              }}
            />
            {inStore() ? null : (
              <Action
                label="Add below-minimum products"
                icon="package"
                quiet
                disabled={busy()}
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
            )}
          </View>
        ) : null}
        {state.data() && !state.error() ? (
          items().length ? (
            shownOpen().length || shownChecked().length ? (
              <View class="gap-8">
                {shownOpen().length ? (
                  <View>
                    {inStore() ? null : (
                      <View class="hidden md:flex flex-row items-center gap-3.5 h-9 pl-3 pr-14 border-b border-border">
                        <View class="w-[18px]" />
                        <Text class="flex-1 text-[13px] text-muted-foreground">Item</Text>
                        <Text class="w-64 text-[13px] text-muted-foreground">Note</Text>
                        <Text class="w-32 text-right text-[13px] text-muted-foreground">
                          Amount
                        </Text>
                      </View>
                    )}
                    <Each of={shownOpen()}>{row}</Each>
                  </View>
                ) : null}
                {shownChecked().length ? (
                  <View>
                    <View class="gap-1 pb-2 border-b border-border">
                      <Subheading title="In the basket" detail={String(checked().length)} />
                      {inStore() ? null : (
                        <Text class="text-[13px] text-muted-foreground">
                          Put away uses each product's default date and location, then removes the
                          item from this list.
                        </Text>
                      )}
                    </View>
                    <Each of={shownChecked()}>{row}</Each>
                  </View>
                ) : null}
              </View>
            ) : (
              <Empty
                title="No shopping items match your search."
                detail="Try a product name or a word from the note."
              />
            )
          ) : (
            <Empty
              title={list() ? "Your list is clear." : "No shopping list yet"}
              detail={
                list()
                  ? "Use Add item for anything you need, or Add below-minimum products to bring across everything running low in stock."
                  : "Use New list to start one, then add items here."
              }
            />
          )
        ) : null}
      </View>
      <Panel
        open={adding()}
        title={editing() ? "Edit shopping item" : "Add shopping item"}
        onClose={() => adding.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success="" />
            <Action
              label={editing() ? "Save item" : "Add to list"}
              primary
              disabled={op.busy() || (!editing() && !product())}
              onPress={() =>
                void op
                  .run(
                    () =>
                      editing()
                        ? p.api.save(
                            "shopping_list",
                            {
                              amount: positive(amount()),
                              note: note(),
                            },
                            editing()!.id,
                          )
                        : p.api.post("/api/v2/shopping-lists/items", {
                            product_id: Number(product()),
                            amount: positive(amount()),
                            note: note(),
                            shopping_list_id: Number(list()),
                          }),
                    editing() ? "Item saved." : "Item added.",
                  )
                  .then((ok) => {
                    if (ok) adding.set(false);
                  })
              }
            />
          </View>
        }
      >
        {editing() ? (
          <View class="gap-1.5">
            <Text class="text-[13px] font-medium text-muted-foreground">Product</Text>
            <Text class="text-[15px] font-medium text-foreground">{title(editing()!)}</Text>
          </View>
        ) : (
          <Choice
            label="Product to add"
            value={product()}
            items={(state.data()?.products ?? []).map((r) => ({
              value: String(r.id),
              title: r.name,
            }))}
            onChange={(v) => product.set(v)}
          />
        )}
        <Field
          label={`Quantity${product() ? ` (${unit(editing() ? editing()!.qu_id : state.data()?.products.find((r) => String(r.id) === product())?.qu_id_purchase)})` : ""}`}
          numeric
          value={amount()}
          onChange={(v) => amount.set(v)}
        />
        <Field label="Note (optional)" value={note()} onChange={(v) => note.set(v)} />
        {editing() ? (
          <View class="gap-3 pt-5 border-t border-border">
            {removing() ? (
              <View class="gap-3">
                <Text class="text-sm text-foreground">
                  {`Remove ${title(editing()!)} from this list? Stock will stay the same.`}
                </Text>
                <View class="flex-row flex-wrap gap-2">
                  <Action
                    label="Confirm remove item"
                    icon="trash"
                    danger
                    disabled={op.busy()}
                    onPress={() =>
                      void op
                        .run(
                          () =>
                            p.api.request(`/api/objects/shopping_list/${editing()!.id}`, "DELETE"),
                          "Item removed.",
                        )
                        .then((ok) => {
                          if (ok) adding.set(false);
                        })
                    }
                  />
                  <Action
                    label="Keep item"
                    quiet
                    disabled={op.busy()}
                    onPress={() => removing.set(false)}
                  />
                </View>
              </View>
            ) : (
              <View class="flex-row -ml-3">
                <Action
                  label="Remove item"
                  icon="trash"
                  danger
                  quiet
                  disabled={op.busy()}
                  onPress={() => removing.set(true)}
                />
              </View>
            )}
          </View>
        ) : null}
      </Panel>
      <Panel
        open={managing()}
        title={newList() ? "New shopping list" : "Manage shopping list"}
        onClose={() => managing.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success="" />
            {!deleting() ? (
              <Action
                label={newList() ? "Create list" : "Save list"}
                primary
                disabled={op.busy() || !listName().trim()}
                onPress={() =>
                  void op
                    .run(
                      async () => {
                        const result = await p.api.save(
                          "shopping_lists",
                          { name: listName().trim() },
                          newList() ? undefined : Number(list()),
                        );
                        if (newList() && result?.created_object_id && op.alive())
                          list.set(String(result.created_object_id));
                      },
                      newList() ? "List created." : "List saved.",
                    )
                    .then((ok) => {
                      if (ok) managing.set(false);
                    })
                }
              />
            ) : null}
          </View>
        }
      >
        <Field label="List name" value={listName()} onChange={(v) => listName.set(v)} />
        {!newList() ? (
          <View class="gap-3 pt-5 border-t border-border">
            {deleting() ? (
              <View class="gap-3">
                <Text class="text-sm text-foreground">
                  {`Delete ${listTitle()}? This cannot be undone.`}
                </Text>
                <View class="flex-row flex-wrap gap-2">
                  <Action
                    label="Confirm delete list"
                    icon="trash"
                    danger
                    disabled={op.busy()}
                    onPress={() =>
                      void op
                        .run(async () => {
                          await p.api.request(`/api/objects/shopping_lists/${list()}`, "DELETE");
                          if (op.alive()) list.set("");
                        }, "List deleted.")
                        .then((ok) => {
                          if (ok) managing.set(false);
                        })
                    }
                  />
                  <Action
                    label="Keep list"
                    quiet
                    disabled={op.busy()}
                    onPress={() => deleting.set(false)}
                  />
                </View>
              </View>
            ) : (
              <View class="gap-1 items-start">
                <View class="-ml-3">
                  <Action
                    label="Delete list"
                    icon="trash"
                    danger
                    quiet
                    disabled={op.busy() || items().length > 0}
                    onPress={() => deleting.set(true)}
                  />
                </View>
                {items().length ? <Note>Empty this list before deleting it.</Note> : null}
              </View>
            )}
          </View>
        ) : null}
      </Panel>
    </View>
  );
}
