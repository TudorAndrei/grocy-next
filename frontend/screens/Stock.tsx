import { signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Api, positive, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import {
  Action,
  Choice,
  DateField,
  Due,
  Field,
  Heading,
  Note,
  Panel,
  Tabs,
  Toggle,
  addDays,
  dateISO,
  dueDays,
} from "../ui";
import { Nutrition, NutritionHistory } from "./Nutrition";
export function Stock(p: { api: Api }) {
  const state = remote(async (s) => {
    const [overview, products, locations, units] = await Promise.all([
      p.api.request<Row>("/api/v2/stock/overview", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/products", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/locations", "GET", undefined, s),
      p.api.request<Row[]>("/api/objects/quantity_units", "GET", undefined, s),
    ]);
    return { overview, products, locations, units };
  });
  const proposals = remote((s) =>
    p.api.request<Row[]>("/api/v2/nutrition/proposals", "GET", undefined, s),
  );
  const query = signal(""),
    filter = signal("Everything"),
    mode = signal(""),
    product = signal(""),
    amount = signal("1"),
    date = signal(""),
    location = signal(""),
    from = signal("");
  const newName = signal(""),
    newUnit = signal(""),
    keepOpen = signal(false),
    review = signal(false),
    editName = signal(""),
    minimum = signal("0"),
    days = signal("0");
  const entries = remote((s) =>
    product()
      ? p.api.request<Row[]>(
          `/api/stock/products/${product()}/entries`,
          "GET",
          undefined,
          s,
        )
      : Promise.resolve([]),
  );
  const undo = signal(""),
    notice = signal(""),
    op = operations(state.refresh);
  const selected = () =>
    state.data()?.products.find((r) => String(r.id) === product());
  const unit = (id: unknown) =>
    state.data()?.units.find((r) => String(r.id) === String(id))?.name ?? "";
  const rows = (): Row[] => {
    const data = state.data();
    if (!data) return [];
    return data.products
      .map((item) => {
        const stock = data.overview.rows.find(
          (r: Row) => Number(r.product_id) === Number(item.id),
        );
        return {
          ...item,
          product_id: item.id,
          product_name: item.name,
          amount: 0,
          unit_label: unit(item.qu_id_stock),
          ...stock,
          locationLabel:
            stock?.location_names?.filter(Boolean).join(", ") ||
            data.locations.find(
              (l) => Number(l.id) === Number(item.location_id),
            )?.name ||
            "",
        };
      })
      .filter((r) =>
        String(r.product_name).toLowerCase().includes(query().toLowerCase()),
      )
      .sort((a, b) => a.product_name.localeCompare(b.product_name));
  };
  const attention = (r: Row) =>
    Number(r.amount) < Number(r.min_stock_amount) ||
    (Number(r.amount) > 0 && (dueDays(r.best_before_date) ?? 99) <= 5);
  const attentionRows = () =>
    rows()
      .filter(attention)
      .sort(
        (a, b) =>
          (dueDays(a.best_before_date) ?? 999) -
          (dueDays(b.best_before_date) ?? 999),
      );
  const choose = (id: string) => {
    product.set(id);
    const item = state.data()?.products.find((r) => String(r.id) === id);
    location.set(String(item?.location_id ?? ""));
  };
  function purchase(id = "") {
    choose(id);
    newName.set("");
    newUnit.set(String(state.data()?.units[0]?.id ?? ""));
    location.set(
      String(selected()?.location_id ?? state.data()?.locations[0]?.id ?? ""),
    );
    amount.set("1");
    date.set("");
    mode.set("add");
  }
  function details(r: Row) {
    choose(String(r.product_id));
    amount.set("1");
    date.set("");
    mode.set("details");
    notice.set("");
    void entries.refresh();
  }
  async function book() {
    const action = mode();
    let transaction = "";
    const ok = await op.run(async () => {
      const quantity = positive(amount(), action === "inventory");
      let id = product();
      if (!id && action === "add") {
        if (!newName().trim())
          throw new Error("Choose a product or enter its name.");
        if (!newUnit() || !location())
          throw new Error("Choose a unit and a location for this product.");
        const result = await p.api.save("products", {
          name: newName().trim(),
          qu_id_stock: Number(newUnit()),
          qu_id_purchase: Number(newUnit()),
          location_id: Number(location()),
        });
        id = String(result.created_object_id);
        if (!op.alive()) return;
        product.set(id);
        await state.refresh();
      }
      if (!id) throw new Error("Choose a product.");
      const body: Row =
        action === "inventory"
          ? { new_amount: quantity }
          : { amount: quantity };
      if (date()) body.best_before_date = date();
      if (action === "add" && location()) body.location_id = Number(location());
      if (action === "transfer") {
        if (!from() || !location() || from() === location())
          throw new Error("Choose different source and destination locations.");
        body.location_id_from = Number(from());
        body.location_id_to = Number(location());
      }
      const result = await p.api.post(
        `/api/stock/products/${id}/${action}`,
        body,
      );
      transaction = result?.[0]?.transaction_id ?? "";
    }, "");
    if (ok) {
      undo.set(transaction);
      notice.set(action === "add" ? "Purchase added." : "Stock updated.");
      if (action === "add" && keepOpen()) {
        purchase();
      } else mode.set("");
    }
  }
  async function quick(r: Row) {
    const count = Number(r.quick_consume_amount) || 1;
    let transaction = "";
    const ok = await op.run(async () => {
      const result = await p.api.post(
        `/api/stock/products/${r.product_id}/consume`,
        { amount: count },
      );
      transaction = result?.[0]?.transaction_id ?? "";
    }, "");
    if (ok) {
      undo.set(transaction);
      notice.set(`Used ${count} ${r.unit_label} of ${r.product_name}.`);
    }
  }
  const row = (r: Row) => (
    <View class="flex-row gap-2 items-center border-b border-[#e4e4e0] min-h-16 md:min-h-[52px] py-1">
      <Button
        accessibilityLabel={`View ${r.product_name}`}
        onPress={() => details(r)}
        class="flex-1 min-w-0 min-h-11 flex-row items-center gap-3 hover:bg-[#f0f0ec] focus:outline-2 focus:outline-[#22603f] rounded-lg px-1"
      >
        <View class="flex-1 min-w-0 gap-1">
          <Text
            style={{ numberOfLines: 2 }}
            class="text-base font-medium text-[#1b1d1c]"
          >
            {r.product_name}
          </Text>
          <View class="flex-row flex-wrap gap-2 md:hidden">
            <Text class="text-[13px] text-[#5e625f]">{r.locationLabel}</Text>
            <Due value={Number(r.amount) > 0 ? r.best_before_date : null} />
          </View>
        </View>
        <View class="hidden md:flex w-24">
          <Text style={{ numberOfLines: 1 }} class="text-[13px] text-[#5e625f]">
            {r.locationLabel}
          </Text>
        </View>
        <View class="hidden md:flex w-32">
          <Due value={Number(r.amount) > 0 ? r.best_before_date : null} />
        </View>
        <Text class="shrink-0 text-sm font-semibold text-[#1b1d1c]">
          {Number(r.amount) > 0
            ? `${r.amount} ${r.unit_label}`
            : "Not in stock"}
        </Text>
      </Button>
      <View class="w-16 items-end">
        {Number(r.amount) >= (Number(r.quick_consume_amount) || 1) &&
        !Number(r.enable_tare_weight_handling) ? (
          <Action
            label={`Use ${Number(r.quick_consume_amount) || 1}`}
            accessibilityLabel={`Use ${Number(r.quick_consume_amount) || 1} ${r.product_name}`}
            quiet
            disabled={op.busy()}
            onPress={() => void quick(r)}
          />
        ) : null}
      </View>
    </View>
  );
  return (
    <View class="gap-4">
      <View class="flex-row justify-between items-center gap-3">
        <Heading title="Stock" />
        <Action label="Add purchase" primary onPress={() => purchase()} />
      </View>
      {proposals.data()?.length ? (
        <Action
          label={`${proposals.data()!.length} nutrition changes to review`}
          quiet
          onPress={() => review.set(true)}
        />
      ) : null}
      {state.data()?.products.length ? (
        <Field
          label="Search products"
          placeholder="Find anything in your household"
          value={query()}
          onChange={(v) => query.set(v)}
        />
      ) : null}
      {state.data()?.products.length ? (
        <Tabs
          items={[
            "Everything",
            ...(attentionRows().length ? ["Needs attention"] : []),
          ]}
          value={filter()}
          onChange={(v) => filter.set(v)}
        />
      ) : null}
      <LoadState
        loading={state.loading()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback error={op.error()} success={op.success()} />
      {notice() ? (
        <View class="flex-row flex-wrap items-center justify-between gap-2 bg-[#edf2ee] rounded-lg px-3 py-2">
          <Note>{notice()}</Note>
          {undo() ? (
            <Action
              label="Undo stock change"
              quiet
              disabled={op.busy()}
              onPress={() =>
                void op.run(async () => {
                  await p.api.post(`/api/stock/transactions/${undo()}/undo`);
                  if (op.alive()) {
                    undo.set("");
                    notice.set("");
                  }
                }, "Stock change undone.")
              }
            />
          ) : null}
        </View>
      ) : null}
      {!state.loading() && !state.error() && !state.data()?.products.length ? (
        <Note>Your stock starts with your first purchase.</Note>
      ) : null}
      {!state.loading() &&
      state.data()?.products.length &&
      rows().length === 0 ? (
        <View class="gap-3">
          <Note>No products match “{query()}”.</Note>
          <Action
            label={`Create ${query()}`}
            onPress={() => {
              purchase();
              newName.set(query());
            }}
          />
        </View>
      ) : null}
      {filter() === "Needs attention" ? (
        <View>
          {attentionRows().length === 0 ? (
            <Note>Nothing needs attention.</Note>
          ) : null}
          <Each of={attentionRows()}>{(r) => row(r())}</Each>
        </View>
      ) : (
        <View>
          {attentionRows().length ? (
            <View class="gap-1 mb-5">
              <Text class="text-sm font-semibold text-[#5e625f]">
                Needs attention
              </Text>
              <Each of={attentionRows()}>{(r) => row(r())}</Each>
            </View>
          ) : null}
          {attentionRows().length && rows().some((r) => !attention(r)) ? (
            <Text class="text-sm font-semibold text-[#5e625f]">
              Everything else
            </Text>
          ) : null}
          <Each of={rows().filter((r) => !attention(r))}>
            {(r) => row(r())}
          </Each>
        </View>
      )}
      <Panel
        open={Boolean(mode())}
        title={
          mode() === "add"
            ? "Add purchase"
            : mode() === "details"
              ? (selected()?.name ?? "Product")
              : ({
                  consume: "Use stock",
                  open: "Open stock",
                  inventory: "Count stock",
                  transfer: "Move stock",
                  edit: "Edit product",
                }[mode()] ?? "Product")
        }
        onClose={() => mode.set("")}
        busy={op.busy()}
        footer={
          mode() !== "details" ? (
            <View class="gap-2">
              <Feedback error={op.error()} success="" />
              <Action
                label={
                  mode() === "add"
                    ? "Add to stock"
                    : mode() === "edit"
                      ? "Save product"
                      : "Save stock change"
                }
                primary
                disabled={op.busy()}
                onPress={() => {
                  if (mode() === "edit")
                    void op
                      .run(
                        () =>
                          p.api.save(
                            "products",
                            {
                              name: editName(),
                              min_stock_amount: positive(minimum(), true),
                              default_best_before_days: positive(days(), true),
                              location_id: Number(location()),
                            },
                            Number(product()),
                          ),
                        "Product saved.",
                      )
                      .then((ok) => {
                        if (ok) mode.set("details");
                      });
                  else void book();
                }}
              />
            </View>
          ) : null
        }
      >
        {mode() === "details" ? (
          <View class="gap-5">
            <View class="gap-2">
              <Text class="text-2xl font-semibold text-[#1b1d1c]">
                {rows().find((r) => String(r.product_id) === product())
                  ?.amount ?? 0}{" "}
                {unit(selected()?.qu_id_stock)}
              </Text>
              <Note>
                {state
                  .data()
                  ?.locations.find((l) => String(l.id) === location())?.name ??
                  ""}
              </Note>
            </View>
            <LoadState
              loading={entries.loading()}
              error={entries.error()}
              retry={entries.refresh}
            />
            <Each of={entries.data() ?? []}>
              {(entry) => (
                <View class="flex-row flex-wrap gap-2">
                  <Note>
                    {entry().amount} {unit(selected()?.qu_id_stock)} ·{" "}
                    {state
                      .data()
                      ?.locations.find(
                        (l) => Number(l.id) === Number(entry().location_id),
                      )?.name ?? "Unknown location"}
                  </Note>
                  <Due value={entry().best_before_date} />
                </View>
              )}
            </Each>
            <Action
              label="Add purchase"
              primary
              onPress={() => purchase(product())}
            />
            <View class="flex-row flex-wrap gap-2">
              {Number(
                rows().find((r) => String(r.product_id) === product())?.amount,
              ) > 0 ? (
                <View class="flex-row gap-2">
                  <Action
                    label="Use amount"
                    onPress={() => {
                      amount.set("1");
                      mode.set("consume");
                    }}
                  />
                  {!Number(selected()?.disable_open) ? (
                    <Action
                      label="Open"
                      onPress={() => {
                        amount.set("1");
                        mode.set("open");
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
              <Action
                label="Count"
                onPress={() => {
                  amount.set(
                    String(
                      rows().find((r) => String(r.product_id) === product())
                        ?.amount ?? 0,
                    ),
                  );
                  mode.set("inventory");
                }}
              />
              {Number(
                rows().find((r) => String(r.product_id) === product())?.amount,
              ) > 0 && (state.data()?.locations.length ?? 0) > 1 ? (
                <Action
                  label="Move"
                  onPress={() => {
                    from.set(String(entries.data()?.[0]?.location_id ?? ""));
                    location.set("");
                    amount.set("1");
                    mode.set("transfer");
                  }}
                />
              ) : null}
            </View>
            <Action
              label="Add to shopping list"
              onPress={() =>
                void op.run(
                  () =>
                    p.api.post("/api/stock/shoppinglist/add-product", {
                      product_id: Number(product()),
                      product_amount: 1,
                    }),
                  "Added to the default shopping list.",
                )
              }
            />
            <Feedback error={op.error()} success={op.success()} />
            <Action
              label="Edit product details"
              quiet
              onPress={() => {
                editName.set(selected()?.name ?? "");
                minimum.set(String(selected()?.min_stock_amount ?? 0));
                days.set(String(selected()?.default_best_before_days ?? 0));
                mode.set("edit");
              }}
            />
            <NutritionHistory api={p.api} productId={Number(product())} />
          </View>
        ) : null}
        {mode() === "add" ? (
          <View class="gap-4">
            <Choice
              label="Product"
              value={product()}
              items={(state.data()?.products ?? []).map((r) => ({
                value: String(r.id),
                title: r.name,
              }))}
              onChange={choose}
            />
            {!product() ? (
              <View class="gap-4">
                <Field
                  label="New product name"
                  value={newName()}
                  onChange={(v) => newName.set(v)}
                  placeholder="Or create a product here"
                />
                <Choice
                  label="Unit"
                  value={newUnit()}
                  items={(state.data()?.units ?? []).map((r) => ({
                    value: String(r.id),
                    title: r.name,
                  }))}
                  onChange={(v) => newUnit.set(v)}
                />
              </View>
            ) : null}
            <Field
              label={`Quantity${unit(selected()?.qu_id_stock) ? ` (${unit(selected()?.qu_id_stock)})` : ""}`}
              numeric
              value={amount()}
              onChange={(v) => amount.set(v)}
              onSubmit={() => void book()}
            />
            <DateField
              label="Best before"
              emptyLabel="Use product default"
              value={date()}
              optional
              onChange={(v) => date.set(v)}
            />
            <View class="flex-row flex-wrap gap-1">
              <Each
                of={[
                  ["Default", ""],
                  ["Today", dateISO()],
                  ["+3 days", addDays(dateISO(), 3)],
                  ["+1 week", addDays(dateISO(), 7)],
                  ["Never", "2999-12-31"],
                ]}
              >
                {(d) => (
                  <Action
                    label={d()[0]}
                    quiet
                    onPress={() => date.set(d()[1])}
                  />
                )}
              </Each>
            </View>
            <Note>
              {date()
                ? date() === "2999-12-31"
                  ? "No due date."
                  : "Best-before date selected."
                : `Uses the product default${selected() ? `: ${selected()?.default_best_before_days ?? 0} days` : "."}`}
            </Note>
            <Toggle
              label="Add another after saving"
              checked={keepOpen()}
              onChange={(v) => keepOpen.set(v)}
            />
          </View>
        ) : null}
        {mode() === "edit" ? (
          <View class="gap-4">
            <Field
              label="Product name"
              value={editName()}
              onChange={(v) => editName.set(v)}
            />
            <Field
              label="Minimum stock"
              numeric
              value={minimum()}
              onChange={(v) => minimum.set(v)}
            />
            <Field
              label="Default best-before days"
              numeric
              value={days()}
              onChange={(v) => days.set(v)}
            />
          </View>
        ) : null}
        {mode() !== "details" && mode() !== "edit" && mode() !== "add" ? (
          <Field
            label={
              mode() === "inventory"
                ? "Actually have"
                : `Quantity${unit(selected()?.qu_id_stock) ? ` (${unit(selected()?.qu_id_stock)})` : ""}`
            }
            numeric
            value={amount()}
            onChange={(v) => amount.set(v)}
            onSubmit={() => void book()}
          />
        ) : null}
        {mode() === "transfer" ? (
          <Choice
            label="From location"
            value={from()}
            items={(state.data()?.locations ?? []).map((r) => ({
              value: String(r.id),
              title: r.name,
            }))}
            onChange={(v) => from.set(v)}
          />
        ) : null}
        {["add", "transfer", "edit"].includes(mode()) ? (
          <Choice
            label={mode() === "transfer" ? "To location" : "Location"}
            value={location()}
            items={(state.data()?.locations ?? []).map((r) => ({
              value: String(r.id),
              title: r.name,
            }))}
            onChange={(v) => location.set(v)}
          />
        ) : null}
      </Panel>
      <Panel
        open={review()}
        title="Nutrition changes"
        onClose={() => {
          review.set(false);
          void proposals.refresh();
        }}
      >
        <Nutrition api={p.api} onReviewed={() => void proposals.refresh()} />
      </Panel>
    </View>
  );
}
