import { signal, Text, View } from "nsh";
import { Api, positive, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import { Action, Choice, DateField, Field, Heading, Note, Toggle } from "../ui";

type Booking = {
  id: number;
  name: string;
  amount: number;
  operation: string;
  transaction: string;
};
const modes: Record<string, string> = {
  Purchase: "add",
  Consume: "consume",
  Open: "open",
  Inventory: "inventory",
};
/** Every submission is an explicit booking; a failed booking leaves its draft intact. */
export function Batch(p: { api: Api; initialMode?: string }) {
  const mode = signal(p.initialMode ?? "Purchase"),
    product = signal(""),
    barcode = signal(""),
    amount = signal("1"),
    date = signal(""),
    location = signal(""),
    spoiled = signal(false),
    history = signal<Booking[]>([]),
    lookup = signal(false);
  const state = remote(async (s) => {
    const [products, units, locations] = await Promise.all([
      p.api.request<Row[]>("/api/objects/products", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/quantity_units", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/locations", "GET", undefined, s),
    ]);
    return { products, units, locations };
  });
  const op = operations(async () => {});
  const selected = () => state.data()?.products.find((r) => String(r.id) === product());
  function choose(id: string) {
    product.set(id);
    location.set(String(selected()?.location_id ?? ""));
    amount.set("1");
  }
  async function findBarcode() {
    if (!barcode().trim() || op.busy()) return;
    lookup.set(true);
    await op.run(async () => {
      const result = await p.api.request<Row>(
        `/api/stock/products/by-barcode/${encodeURIComponent(barcode().trim())}`,
      );
      const id = result.product?.id ?? result.id;
      if (!id || !state.data()?.products.some((r) => String(r.id) === String(id)))
        throw new Error("No matching product. Add its barcode in the product catalog first.");
      if (op.alive()) {
        choose(String(id));
        barcode.set("");
      }
    }, "Product found. Review the quantity before booking.");
    if (op.alive()) lookup.set(false);
  }
  async function book() {
    if (op.busy()) return;
    await op.run(async () => {
      const item = selected();
      if (!item) throw new Error("Choose a product or look up its barcode.");
      const quantity = positive(amount(), mode() === "Inventory");
      const operation = mode();
      const action = modes[operation];
      const body: Row = action === "inventory" ? { new_amount: quantity } : { amount: quantity };
      if (action === "add") {
        if (date()) body.best_before_date = date();
        if (location()) body.location_id = Number(location());
      }
      if (action === "consume") body.spoiled = spoiled();
      const result = await p.api.post(`/api/stock/products/${item.id}/${action}`, body);
      if (!op.alive()) return;
      history.set([
        {
          id: Date.now(),
          name: item.name,
          amount: quantity,
          operation,
          transaction: result?.[0]?.transaction_id ?? "",
        },
        ...history(),
      ]);
      product.set("");
      barcode.set("");
      amount.set("1");
    }, "Stock booked. Ready for the next product.");
  }
  return (
    <View class="gap-5">
      <Heading title="Batch processing" />
      <Note>
        Work through your groceries one product at a time. Each booking saves immediately and
        appears below.
      </Note>
      <View class="flex-row flex-wrap gap-2">
        <Each of={Object.keys(modes)}>
          {(name) => (
            <Action
              label={name()}
              primary={mode() === name()}
              disabled={op.busy()}
              onPress={() => {
                mode.set(name());
                amount.set("1");
              }}
            />
          )}
        </Each>
      </View>
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      <View class="bg-white rounded-xl border border-[#e4e4e0] p-4 md:p-6 gap-5">
        <View class="gap-3">
          <Field
            label="Scan or enter barcode"
            value={barcode()}
            onChange={(v) => barcode.set(v)}
            onSubmit={() => void findBarcode()}
            placeholder="Scan with a connected barcode reader"
          />
          <Action
            label={lookup() ? "Looking up…" : "Look up barcode"}
            disabled={op.busy() || !barcode().trim() || state.loading()}
            onPress={() => void findBarcode()}
          />
        </View>
        <Choice
          label="Batch product"
          value={product()}
          items={(state.data()?.products ?? []).map((r) => ({
            value: String(r.id),
            title: r.name,
          }))}
          onChange={choose}
        />
        {selected() ? (
          <Note>
            {selected()!.name} ·{" "}
            {state.data()?.units.find((r) => String(r.id) === String(selected()!.qu_id_stock))
              ?.name ?? "stock units"}
          </Note>
        ) : null}
        <Field
          label={mode() === "Inventory" ? "Counted quantity" : "Booking quantity"}
          numeric
          value={amount()}
          onChange={(v) => amount.set(v)}
        />
        {mode() === "Purchase" ? (
          <View class="gap-5">
            <DateField
              label="Best-before date"
              value={date()}
              onChange={(v) => date.set(v)}
              optional
              emptyLabel="Product default"
            />
            <Choice
              label="Purchase location"
              value={location()}
              items={(state.data()?.locations ?? []).map((r) => ({
                value: String(r.id),
                title: r.name,
              }))}
              onChange={(v) => location.set(v)}
            />
          </View>
        ) : null}
        {mode() === "Consume" ? (
          <Toggle label="Spoiled / wasted" checked={spoiled()} onChange={(v) => spoiled.set(v)} />
        ) : null}
        {mode() === "Inventory" ? (
          <Note>
            This replaces the total stock quantity. Enter zero to record an empty product.
          </Note>
        ) : null}
        <Feedback error={op.error()} success={op.success()} />
        <Action
          label={
            op.busy() && !lookup()
              ? "Booking…"
              : mode() === "Inventory"
                ? "Save count and continue"
                : `${mode()} and continue`
          }
          primary
          disabled={op.busy() || !product()}
          onPress={() => void book()}
        />
      </View>
      <View class="gap-2">
        <Heading title="This session" />
        {!history().length ? (
          <Note>Your bookings will appear here, with undo when the server provides it.</Note>
        ) : null}
        <Each of={history()}>
          {(entry) => (
            <View class="flex-row items-center gap-3 py-3 border-b border-[#e4e4e0]">
              <View class="flex-1 min-w-0 gap-1">
                <Text class="text-base font-medium text-[#1b1d1c]">{entry().name}</Text>
                <Note>
                  {entry().operation} · {entry().amount}
                </Note>
              </View>
              {entry().transaction ? (
                <Action
                  label={`Undo ${entry().name}`}
                  quiet
                  disabled={op.busy()}
                  onPress={() =>
                    void op.run(async () => {
                      await p.api.post(`/api/stock/transactions/${entry().transaction}/undo`);
                      if (op.alive()) history.set(history().filter((r) => r.id !== entry().id));
                    }, "Booking undone.")
                  }
                />
              ) : null}
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}
