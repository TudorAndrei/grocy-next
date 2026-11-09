import { signal, Text, View, windowSize } from "nsh";
import { Button } from "nsh/base";
import { Api, positive, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import {
  Action,
  Choice,
  Count,
  DateField,
  Due,
  Empty,
  Field,
  Heading,
  Icon,
  Note,
  Panel,
  Search,
  Segments,
  Subheading,
  Toggle,
  addDays,
  dateISO,
  dueDays,
} from "../ui";
import { Nutrition, NutritionHistory } from "./Nutrition";
import { Ruler, relativeDays, type RulerItem } from "./Ruler";

const focusRing = "focus:outline-2 focus:outline-offset-2 focus:outline-ring";

/** "6 Nov" this year, "12 Jan 2027" otherwise. */
function calendarDate(value: string): string {
  const date = new Date(value.slice(0, 10) + "T12:00:00");
  return date.toLocaleDateString(
    undefined,
    date.getFullYear() === new Date().getFullYear()
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
  );
}

const inStock = (r: Row) => Number(r.amount) > 0;
const belowMin = (r: Row) =>
  Number(r.min_stock_amount) > 0 &&
  Number(r.amount) < Number(r.min_stock_amount);
/** Days to best before for products in stock; null when undated or never due. */
const daysLeft = (r: Row) => (inStock(r) ? dueDays(r.best_before_date) : null);
const urgency = (a: Row, b: Row) =>
  (daysLeft(a) ?? 999) - (daysLeft(b) ?? 999) ||
  String(a.product_name).localeCompare(String(b.product_name));

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
    filter = signal("all"),
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
  const wide = () => windowSize().width >= 768;
  const selected = () =>
    state.data()?.products.find((r) => String(r.id) === product());
  const unit = (id: unknown) =>
    state.data()?.units.find((r) => String(r.id) === String(id))?.name ?? "";
  /** Every product joined with its stock row, by name. */
  const allRows = (): Row[] => {
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
      .sort((a, b) => a.product_name.localeCompare(b.product_name));
  };
  const rows = (): Row[] =>
    allRows().filter((r) =>
      String(r.product_name).toLowerCase().includes(query().toLowerCase()),
    );
  const attention = (r: Row) =>
    Number(r.amount) < Number(r.min_stock_amount) ||
    (Number(r.amount) > 0 && (dueDays(r.best_before_date) ?? 99) <= 5);
  const attentionRows = () => rows().filter(attention).sort(urgency);
  const expiredRows = () => rows().filter((r) => (daysLeft(r) ?? 0) < 0);
  const dueRows = () =>
    rows().filter((r) => {
      const d = daysLeft(r);
      return d != null && d >= 0 && d <= 5;
    });
  const lowRows = () => rows().filter(belowMin);
  const filters = () =>
    [
      { value: "all", label: "All", count: rows().length },
      {
        value: "attention",
        label: "Needs attention",
        count: attentionRows().length,
      },
      { value: "expired", label: "Expired", count: expiredRows().length },
      { value: "due", label: "Due soon", count: dueRows().length },
      { value: "low", label: "Below min", count: lowRows().length },
    ].filter((f) => f.value === "all" || f.count > 0);
  /** The chosen filter, or All once nothing is left in it. */
  const view = () =>
    filters().some((f) => f.value === filter()) ? filter() : "all";
  const filtered = (): Row[] =>
    view() === "attention"
      ? attentionRows()
      : view() === "expired"
        ? expiredRows().sort(urgency)
        : view() === "due"
          ? dueRows().sort(urgency)
          : view() === "low"
            ? lowRows()
            : [];
  const rulerItems = (): RulerItem[] =>
    allRows()
      .filter((r) => daysLeft(r) != null)
      .map((r) => ({
        id: String(r.product_id),
        name: String(r.product_name),
        days: daysLeft(r)!,
        row: r,
      }));
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
  const current = () => rows().find((r) => String(r.product_id) === product());
  const locationName = (id: unknown) =>
    state.data()?.locations.find((l) => Number(l.id) === Number(id))?.name ??
    "Unknown location";

  /** Best-before date cell: red when overdue, "Never" for never-due dates. */
  const dateText = (r: Row) => {
    if (!inStock(r)) return "";
    const value = r.best_before_date as string | undefined;
    if (!value) return "No date";
    if (value.slice(0, 4) >= "2888") return "Never";
    return calendarDate(value);
  };
  const relTone = (d: number | null) =>
    d == null
      ? "text-muted-foreground"
      : d < 0
        ? "text-destructive font-medium"
        : d <= 5
          ? "text-due font-medium"
          : "text-muted-foreground";
  /** Phone meta: urgent dates as relative words, others as the date. */
  const phoneDue = (r: Row) => {
    const d = daysLeft(r);
    if (!inStock(r)) return "";
    if (d == null) return dateText(r) === "Never" ? "" : "no date";
    if (d < 0) return `expired ${relativeDays(d)}`;
    if (d <= 5) return relativeDays(d);
    return calendarDate(r.best_before_date);
  };

  const MinNote = (q: { r: Row }) => (
    <View class="flex-row items-center gap-1.5">
      <Text class="text-xs text-muted-foreground tabular-nums">
        {`min ${Number(q.r.min_stock_amount)} ${q.r.unit_label}`.trim()}
      </Text>
      <View class="hidden md:flex w-11 h-[3px] rounded-full bg-border overflow-hidden">
        <View
          class="h-full rounded-full bg-ink-soft"
          style={{
            width: `${Math.max(0, Math.min(100, (Number(q.r.amount) / Number(q.r.min_stock_amount)) * 100))}%`,
          }}
        />
      </View>
    </View>
  );

  const row = (r: Row) => {
    const d = daysLeft(r);
    const use = Number(r.quick_consume_amount) || 1;
    return (
      <View class="flex-row items-center gap-3 md:gap-2 border-b border-border min-h-16 md:min-h-[52px] hover:bg-card">
        <Button
          accessibilityLabel={`View ${r.product_name}`}
          onPress={() => details(r)}
          class={`flex-1 min-w-0 self-stretch flex-row items-center gap-3 md:gap-4 md:pl-3 py-2 rounded-md ${focusRing}`}
        >
          <View class="flex-1 md:flex-[2] min-w-0 gap-0.5">
            <Text
              style={{ numberOfLines: 2 }}
              class="text-[15px] font-medium text-foreground"
            >
              {r.product_name}
            </Text>
            <View class="flex-row flex-wrap items-baseline md:hidden">
              <Text class="text-[13px] text-muted-foreground">
                {r.locationLabel}
              </Text>
              {phoneDue(r) ? (
                <Text
                  class={`text-[13px] tabular-nums ${relTone(d).replace(" font-medium", "")}`}
                >
                  {`${r.locationLabel ? " · " : ""}${phoneDue(r)}`}
                </Text>
              ) : null}
            </View>
          </View>
          <View class="hidden md:flex flex-1 min-w-0">
            <Text
              style={{ numberOfLines: 1 }}
              class="text-[13px] text-muted-foreground"
            >
              {r.locationLabel}
            </Text>
          </View>
          <View class="shrink-0 md:w-[176px] items-end gap-1 md:pr-6">
            {inStock(r) ? (
              <View>
                {/* Phone: one quantity, read as written ("2 packs"). */}
                <Text class="md:hidden text-[15px] tabular-nums font-medium text-foreground">
                  {String(r.amount)}
                  <Text class="font-normal text-muted-foreground">
                    {r.unit_label ? ` ${r.unit_label}` : ""}
                  </Text>
                </Text>
                {/* Desktop: figure in a fixed right-aligned slot, unit after it, so numerals form a true column. */}
                <View class="hidden md:flex flex-row items-baseline gap-1.5">
                  <Text class="w-14 text-right text-[15px] tabular-nums font-medium text-foreground">
                    {String(r.amount)}
                  </Text>
                  <Text
                    style={{ numberOfLines: 1 }}
                    class="w-[90px] text-[15px] text-muted-foreground"
                  >
                    {r.unit_label ?? ""}
                  </Text>
                </View>
              </View>
            ) : (
              <Text class="text-[15px] text-muted-foreground">Not in stock</Text>
            )}
            {belowMin(r) ? <MinNote r={r} /> : null}
          </View>
          <View class="hidden md:flex w-[112px]">
            <Text
              class={`text-sm tabular-nums ${d != null && d < 0 ? "text-destructive" : dateText(r) === "No date" || dateText(r) === "Never" ? "text-muted-foreground" : "text-ink-soft"}`}
            >
              {dateText(r)}
            </Text>
          </View>
          <View class="hidden md:flex w-[112px]">
            <Text class={`text-[13px] tabular-nums ${relTone(d)}`}>
              {d == null ? "" : relativeDays(d)}
            </Text>
          </View>
        </Button>
        <View class="w-16 md:w-[68px] shrink-0 items-end md:pr-1">
          {Number(r.amount) >= use && !Number(r.enable_tare_weight_handling) ? (
            <Button
              accessibilityLabel={`Use ${use} ${r.product_name}`}
              disabled={op.busy()}
              onPress={() => void quick(r)}
              class={`shrink-0 min-h-11 md:min-h-8 min-w-[52px] px-2.5 rounded-lg border border-input bg-card items-center justify-center hover:border-foreground active:bg-accent ${focusRing} disabled:opacity-40`}
            >
              <Text
                style={{ numberOfLines: 1 }}
                class="text-[13px] font-medium text-foreground tabular-nums"
              >
                {`Use ${use}`}
              </Text>
            </Button>
          ) : null}
        </View>
      </View>
    );
  };
  const columns = () => (
    <View class="hidden md:flex flex-row items-center gap-2 h-[34px] border-b border-input">
      <View class="flex-1 min-w-0 flex-row items-center gap-4 pl-3">
        <Text class="flex-[2] min-w-0 text-[13px] font-medium text-muted-foreground">
          Product
        </Text>
        <Text class="flex-1 min-w-0 text-[13px] font-medium text-muted-foreground">
          Location
        </Text>
        <Text class="w-[176px] pr-[120px] text-right text-[13px] font-medium text-muted-foreground">
          Amount
        </Text>
        <Text class="w-[112px] text-[13px] font-medium text-muted-foreground">
          Best before
        </Text>
        <View class="w-[112px]" />
      </View>
      <View class="w-[68px]" />
    </View>
  );
  const group = (title: string, count: number) => (
    <View class="flex-row items-center gap-2 pt-5 pb-2 md:pl-3 border-b border-border">
      <Text role="header" class="text-[13px] font-medium text-foreground">
        {title}
      </Text>
      <Text class="text-[13px] text-muted-foreground tabular-nums">
        {String(count)}
      </Text>
    </View>
  );
  const purchaseAction = () => (
    <Action
      label="Add purchase"
      icon="plus"
      primary
      onPress={() => purchase()}
    />
  );
  const searchField = () => (
    <Search
      label="Search products"
      placeholder="Search products"
      value={query()}
      onChange={(v) => query.set(v)}
    />
  );
  const count = () => state.data()?.products.length ?? 0;

  return (
    <View class="gap-5 md:gap-6">
      <View class="gap-3">
        <View class="flex-row items-center gap-3 min-h-11">
          <View class="flex-1 min-w-0">
            <Heading
              title="Stock"
              detail={
                count() ? `${count()} ${count() === 1 ? "product" : "products"}` : undefined
              }
            />
          </View>
          {wide() && count() ? searchField() : null}
          {purchaseAction()}
        </View>
        {!wide() && count() ? (
          <View class="flex-row">{searchField()}</View>
        ) : null}
      </View>
      {proposals.data()?.length ? (
        <View class="flex-row items-center gap-2.5 min-h-11 px-3 rounded-lg border border-border bg-card">
          <Icon name="inbox" size={15} />
          <Count value={proposals.data()!.length} />
          <Text
            style={{ numberOfLines: 1 }}
            class="flex-1 min-w-0 text-sm text-ink-soft"
          >
            {proposals.data()!.length === 1
              ? "Nutrition change to review"
              : "Nutrition changes to review"}
          </Text>
          <Button
            accessibilityLabel={`Review ${proposals.data()!.length} nutrition changes`}
            onPress={() => review.set(true)}
            class={`min-h-11 md:min-h-8 px-1 justify-center rounded-md ${focusRing}`}
          >
            <Text class="text-sm font-medium text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground">
              Review
            </Text>
          </Button>
        </View>
      ) : null}
      {rulerItems().length ? (
        <View>
          <View class="hidden md:flex md:flex-col">
            <Ruler items={rulerItems()} span={30} onSelect={details} />
          </View>
          <View class="md:hidden">
            <Ruler items={rulerItems()} span={14} compact onSelect={details} />
          </View>
        </View>
      ) : null}
      <LoadState
        loading={state.loading()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback error={op.error()} success={op.success()} />
      {notice() ? (
        <View class="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-secondary pl-3 pr-1.5 min-h-11 py-1">
          <Icon name="check" size={15} tint="foreground" />
          <View class="flex-1 min-w-0">
            <Text class="text-sm text-foreground">{notice()}</Text>
          </View>
          {undo() ? (
            <Action
              label="Undo stock change"
              icon="undo"
              quiet
              compact
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
      {!state.loading() && !state.error() && !count() ? (
        <Empty
          title="No products yet"
          detail="Your stock starts with your first purchase."
        />
      ) : null}
      {!state.loading() && count() && rows().length === 0 ? (
        <Empty
          title={`No products match “${query()}”`}
          detail="Check the spelling, or create it as a new product with a purchase."
        >
          <View class="pt-2">
            <Action
              label={`Create ${query()}`}
              icon="plus"
              onPress={() => {
                purchase();
                newName.set(query());
              }}
            />
          </View>
        </Empty>
      ) : null}
      {count() && rows().length ? (
        <View class="gap-3">
          <View class="flex-row items-center justify-between gap-3">
            <Segments
              label="Filter products"
              items={filters()}
              value={view()}
              onChange={(v) => filter.set(v)}
            />
            {view() === "all" && attentionRows().length ? (
              <Text class="hidden md:flex text-[13px] text-muted-foreground">
                Sorted by urgency
              </Text>
            ) : null}
          </View>
          <View>
            {columns()}
            {view() === "all" ? (
              <View>
                {attentionRows().length
                  ? group("Needs attention", attentionRows().length)
                  : null}
                <Each of={attentionRows()}>{(r) => row(r())}</Each>
                {attentionRows().length && rows().some((r) => !attention(r))
                  ? group(
                      "Everything else",
                      rows().filter((r) => !attention(r)).length,
                    )
                  : null}
                <Each of={rows().filter((r) => !attention(r)).sort(urgency)}>
                  {(r) => row(r())}
                </Each>
              </View>
            ) : (
              <View>
                <Each of={filtered()}>{(r) => row(r())}</Each>
              </View>
            )}
          </View>
        </View>
      ) : null}
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
          <View class="gap-6">
            <View class="gap-1">
              <Text class="text-[28px] leading-9 font-semibold tracking-tight tabular-nums text-foreground">
                {`${current()?.amount ?? 0} ${unit(selected()?.qu_id_stock)}`.trim()}
              </Text>
              <View class="flex-row flex-wrap items-baseline gap-x-2">
                <Text class="text-sm text-muted-foreground">
                  {state
                    .data()
                    ?.locations.find((l) => String(l.id) === location())
                    ?.name ?? ""}
                </Text>
                {current() && belowMin(current()!) ? (
                  <Text class="text-sm text-muted-foreground tabular-nums">
                    {`· below minimum of ${Number(current()!.min_stock_amount)} ${unit(selected()?.qu_id_stock)}`.trim()}
                  </Text>
                ) : null}
              </View>
            </View>
            <View class="flex-row flex-wrap gap-2">
              {Number(current()?.amount) > 0 ? (
                <Action
                  label="Use amount"
                  onPress={() => {
                    amount.set("1");
                    mode.set("consume");
                  }}
                />
              ) : null}
              {Number(current()?.amount) > 0 &&
              !Number(selected()?.disable_open) ? (
                <Action
                  label="Open"
                  onPress={() => {
                    amount.set("1");
                    mode.set("open");
                  }}
                />
              ) : null}
              <Action
                label="Count"
                onPress={() => {
                  amount.set(String(current()?.amount ?? 0));
                  mode.set("inventory");
                }}
              />
              {Number(current()?.amount) > 0 &&
              (state.data()?.locations.length ?? 0) > 1 ? (
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
            <View class="gap-1">
              <Subheading
                title="In stock"
                detail={
                  entries.data()?.length
                    ? `${entries.data()!.length} ${entries.data()!.length === 1 ? "entry" : "entries"}`
                    : undefined
                }
              />
              <LoadState
                loading={entries.loading()}
                error={entries.error()}
                retry={entries.refresh}
              />
              {!entries.loading() &&
              !entries.error() &&
              !entries.data()?.length ? (
                <View class="py-3 border-b border-border">
                  <Note>Nothing in stock right now.</Note>
                </View>
              ) : null}
              <View>
                <Each of={entries.data() ?? []}>
                  {(entry) => (
                    <View class="flex-row items-center justify-between gap-3 min-h-11 py-2 border-b border-border">
                      <View class="flex-1 min-w-0 flex-row items-baseline gap-2">
                        <Text class="text-sm font-medium text-foreground tabular-nums">
                          {`${entry().amount} ${unit(selected()?.qu_id_stock)}`.trim()}
                        </Text>
                        <Text
                          style={{ numberOfLines: 1 }}
                          class="shrink min-w-0 text-[13px] text-muted-foreground"
                        >
                          {locationName(entry().location_id)}
                        </Text>
                      </View>
                      <Due value={entry().best_before_date} />
                    </View>
                  )}
                </Each>
              </View>
            </View>
            <View class="gap-2">
              <Action
                label="Add purchase"
                icon="plus"
                primary
                onPress={() => purchase(product())}
              />
              <Action
                label="Add to shopping list"
                icon="cart"
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
                icon="pencil"
                quiet
                onPress={() => {
                  editName.set(selected()?.name ?? "");
                  minimum.set(String(selected()?.min_stock_amount ?? 0));
                  days.set(String(selected()?.default_best_before_days ?? 0));
                  mode.set("edit");
                }}
              />
            </View>
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
            <View class="gap-2">
              <DateField
                label="Best before"
                emptyLabel="Use product default"
                value={date()}
                optional
                onChange={(v) => date.set(v)}
              />
              <View class="flex-row flex-wrap gap-1.5">
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
                    <Button
                      selected={date() === d()[1]}
                      onPress={() => date.set(d()[1])}
                      class={`min-h-11 md:min-h-8 px-2 md:px-2.5 rounded-md border items-center justify-center ${date() === d()[1] ? "border-foreground bg-selected" : "border-input bg-card hover:bg-accent"} ${focusRing}`}
                    >
                      <Text
                        class={`text-[13px] tabular-nums ${date() === d()[1] ? "font-medium text-foreground" : "text-ink-soft"}`}
                      >
                        {d()[0]}
                      </Text>
                    </Button>
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
            </View>
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
