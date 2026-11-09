import { signal, Text, View, windowSize } from "nsh";
import { Button } from "nsh/base";
import { Api, message, positive, type Row } from "../api";
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
  Number(r.min_stock_amount) > 0 && Number(r.amount) < Number(r.min_stock_amount);
/** Days to best before for products in stock; null when undated or never due. */
const daysLeft = (r: Row) => (inStock(r) ? dueDays(r.best_before_date) : null);
const byName = (a: Row, b: Row) => String(a.product_name).localeCompare(String(b.product_name));
const urgency = (a: Row, b: Row) => (daysLeft(a) ?? 999) - (daysLeft(b) ?? 999) || byName(a, b);
const attention = (r: Row) =>
  Number(r.amount) < Number(r.min_stock_amount) ||
  (Number(r.amount) > 0 && (dueDays(r.best_before_date) ?? 99) <= 5);

/**
 * One status filter, two views of it: the urgent statuses are segments above
 * the list; every status, with location, group and sort, is in "Filter and sort".
 */
const statuses: { value: string; title: string; short?: string; test: (r: Row) => boolean }[] = [
  { value: "all", title: "All products", short: "All", test: () => true },
  { value: "attention", title: "Needs attention", test: attention },
  { value: "expired", title: "Expired", test: (r) => (daysLeft(r) ?? 0) < 0 },
  {
    value: "due",
    title: "Due soon",
    test: (r) => {
      const d = daysLeft(r);
      return d != null && d >= 0 && d <= 5;
    },
  },
  { value: "low", title: "Below minimum", short: "Below min", test: belowMin },
  { value: "in", title: "In stock", test: inStock },
  { value: "out", title: "Out of stock", test: (r) => !inStock(r) },
];
/** Statuses that earn a segment while they have products in them. */
const urgent = ["attention", "expired", "due", "low"];
const sorts = [
  { value: "urgency", title: "Urgency" },
  { value: "name", title: "Product name" },
  { value: "due", title: "Best-before date" },
  { value: "quantity", title: "Stock quantity" },
];
const sortTitle = (value: string) => sorts.find((s) => s.value === value)?.title.toLowerCase();

const wide = () => windowSize().width >= 768;

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

const columns = () => (
  <View class="hidden md:flex flex-row items-center gap-2 h-[34px] border-b border-input">
    <View class="flex-1 min-w-0 flex-row items-center gap-4 pl-3">
      <Text class="flex-[2] min-w-0 text-[13px] font-medium text-muted-foreground">Product</Text>
      <Text class="flex-1 min-w-0 text-[13px] font-medium text-muted-foreground">Location</Text>
      <Text class="w-[176px] pr-[120px] text-right text-[13px] font-medium text-muted-foreground">
        Amount
      </Text>
      <Text class="w-[112px] text-[13px] font-medium text-muted-foreground">Best before</Text>
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
    <Text class="text-[13px] text-muted-foreground tabular-nums">{String(count)}</Text>
  </View>
);

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
  const groups = remote((s) =>
    p.api.request<Row[]>("/api/objects/product_groups", "GET", undefined, s),
  );
  const proposals = remote((s) =>
    p.api.request<Row[]>("/api/v2/nutrition/proposals", "GET", undefined, s),
  );
  const query = signal(""),
    filter = signal("all"),
    filterLocation = signal(""),
    filterGroup = signal(""),
    sort = signal("urgency"),
    filtering = signal(false),
    scanner = signal(false),
    barcode = signal(""),
    scanAction = signal("details"),
    scanBusy = signal(false),
    scanError = signal(""),
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
      ? p.api.request<Row[]>(`/api/stock/products/${product()}/entries`, "GET", undefined, s)
      : Promise.resolve([]),
  );
  const undo = signal(""),
    notice = signal(""),
    op = operations(state.refresh);
  const selected = () => state.data()?.products.find((r) => String(r.id) === product());
  const unit = (id: unknown) =>
    state.data()?.units.find((r) => String(r.id) === String(id))?.name ?? "";
  const locationName = (id: unknown) =>
    state.data()?.locations.find((l) => Number(l.id) === Number(id))?.name ?? "Unknown location";
  /** Every product joined with its stock row, by name. */
  const allRows = (): Row[] => {
    const data = state.data();
    if (!data) return [];
    return data.products
      .map((item) => {
        const stock = data.overview.rows.find((r: Row) => Number(r.product_id) === Number(item.id));
        return {
          ...item,
          product_id: item.id,
          product_name: item.name,
          amount: 0,
          unit_label: unit(item.qu_id_stock),
          ...stock,
          locationLabel:
            stock?.location_names?.filter(Boolean).join(", ") ||
            data.locations.find((l) => Number(l.id) === Number(item.location_id))?.name ||
            "",
        };
      })
      .toSorted(byName);
  };
  /** Products matching the search, location and group; the status comes after. */
  const rows = (): Row[] =>
    allRows().filter((r) => {
      if (!String(r.product_name).toLowerCase().includes(query().toLowerCase())) return false;
      if (filterGroup() && String(r.product_group_id ?? "") !== filterGroup()) return false;
      if (filterLocation()) {
        const name = locationName(filterLocation());
        const matches = r.location_names?.length
          ? r.location_names.includes(name)
          : String(r.location_id) === filterLocation();
        if (!matches) return false;
      }
      return true;
    });
  const narrowed = () => Boolean(filterLocation() || filterGroup());
  const status = (value: string) => statuses.find((s) => s.value === value) ?? statuses[0];
  const countOf = (value: string) => rows().filter(status(value).test).length;
  /**
   * The chosen status. An urgent segment that empties by itself (the last due
   * item used up) falls back to All; one chosen alongside a location or group
   * stays, so the empty result can say the filters exclude everything.
   */
  const view = () => {
    const f = filter();
    if (!urgent.includes(f) || narrowed()) return status(f).value;
    return countOf(f) > 0 ? f : "all";
  };
  const segments = () =>
    statuses
      .filter(
        (s) =>
          s.value === "all" ||
          s.value === view() ||
          (urgent.includes(s.value) && countOf(s.value) > 0),
      )
      .map((s) => ({ value: s.value, label: s.short ?? s.title, count: countOf(s.value) }));
  const order = (a: Row, b: Row) =>
    sort() === "name"
      ? byName(a, b)
      : sort() === "quantity"
        ? Number(a.amount) - Number(b.amount) || byName(a, b)
        : urgency(a, b);
  const shown = (): Row[] => rows().filter(status(view()).test).toSorted(order);
  /** Urgency order on All splits the list into "Needs attention" and the rest. */
  const grouped = () => view() === "all" && sort() === "urgency";
  const attentionRows = () => shown().filter(attention);
  const restRows = () => shown().filter((r) => !attention(r));
  const rulerItems = (): RulerItem[] =>
    allRows()
      .filter((r) => daysLeft(r) != null)
      .map((r) => ({
        id: String(r.product_id),
        name: String(r.product_name),
        days: daysLeft(r)!,
        row: r,
      }));
  /** Location, group and a non-default sort: what "Filter and sort" holds beyond the segments. */
  const extraFilters = () =>
    (filterLocation() ? 1 : 0) + (filterGroup() ? 1 : 0) + (sort() !== "urgency" ? 1 : 0);
  const showAll = () => {
    filter.set("all");
    filterLocation.set("");
    filterGroup.set("");
    query.set("");
  };
  const choose = (id: string) => {
    product.set(id);
    const item = state.data()?.products.find((r) => String(r.id) === id);
    location.set(String(item?.location_id ?? ""));
  };
  function purchase(id = "") {
    choose(id);
    newName.set("");
    newUnit.set(String(state.data()?.units[0]?.id ?? ""));
    location.set(String(selected()?.location_id ?? state.data()?.locations[0]?.id ?? ""));
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
  async function lookupBarcode() {
    if (scanBusy() || op.busy()) return;
    const code = barcode().trim();
    if (!code) {
      scanError.set("Enter a barcode or scan with a connected scanner.");
      return;
    }
    scanBusy.set(true);
    scanError.set("");
    try {
      const result = await p.api.request<Row>(
        `/api/stock/products/by-barcode/${encodeURIComponent(code)}`,
      );
      if (!op.alive()) return;
      const item = result.product;
      if (!item?.id) throw new Error("No product was returned for this barcode.");
      if (!state.data()?.products.some((r) => Number(r.id) === Number(item.id)))
        await state.refresh();
      if (!op.alive()) return;
      const action = scanAction();
      if (action === "add") purchase(String(item.id));
      else {
        details({ product_id: item.id });
        if (action !== "details") {
          amount.set(
            action === "inventory"
              ? String(result.stock_amount ?? 0)
              : String(item.quick_consume_amount || 1),
          );
          mode.set(action);
        }
      }
      barcode.set("");
    } catch (error) {
      if (op.alive())
        scanError.set(
          `Barcode lookup failed: ${message(error)} Check the code or add the product in Settings.`,
        );
    } finally {
      if (op.alive()) scanBusy.set(false);
    }
  }
  async function book() {
    const action = mode();
    let transaction = "";
    const ok = await op.run(async () => {
      const quantity = positive(amount(), action === "inventory");
      let id = product();
      if (!id && action === "add") {
        if (!newName().trim()) throw new Error("Choose a product or enter its name.");
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
      const body: Row = action === "inventory" ? { new_amount: quantity } : { amount: quantity };
      if (date()) body.best_before_date = date();
      if (action === "add" && location()) body.location_id = Number(location());
      if (action === "transfer") {
        if (!from() || !location() || from() === location())
          throw new Error("Choose different source and destination locations.");
        body.location_id_from = Number(from());
        body.location_id_to = Number(location());
      }
      const result = await p.api.post(`/api/stock/products/${id}/${action}`, body);
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
      const result = await p.api.post(`/api/stock/products/${r.product_id}/consume`, {
        amount: count,
      });
      transaction = result?.[0]?.transaction_id ?? "";
    }, "");
    if (ok) {
      undo.set(transaction);
      notice.set(`Used ${count} ${r.unit_label} of ${r.product_name}.`);
    }
  }
  /** The open product's stock, whatever the list is filtered to. */
  const current = () => allRows().find((r) => String(r.product_id) === product());

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
            <Text style={{ numberOfLines: 2 }} class="text-[15px] font-medium text-foreground">
              {r.product_name}
            </Text>
            <View class="flex-row flex-wrap items-baseline md:hidden">
              <Text class="text-[13px] text-muted-foreground">{r.locationLabel}</Text>
              {phoneDue(r) ? (
                <Text class={`text-[13px] tabular-nums ${relTone(d).replace(" font-medium", "")}`}>
                  {`${r.locationLabel ? " · " : ""}${phoneDue(r)}`}
                </Text>
              ) : null}
            </View>
          </View>
          <View class="hidden md:flex flex-1 min-w-0">
            <Text style={{ numberOfLines: 1 }} class="text-[13px] text-muted-foreground">
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
  const purchaseAction = () => (
    <Action label="Add purchase" icon="plus" primary onPress={() => purchase()} />
  );
  /** Opens the barcode strip; an icon on phones, icon and word on desktop. */
  const scanToggle = () => (
    <Button
      accessibilityLabel={scanner() ? "Hide barcode entry" : "Barcode entry"}
      selected={scanner()}
      onPress={() => {
        scanner.set(!scanner());
        scanError.set("");
      }}
      class={`min-h-11 min-w-11 md:min-h-9 md:min-w-0 md:px-2.5 flex-row gap-1.5 items-center justify-center rounded-lg border ${scanner() ? "border-foreground bg-selected" : "border-transparent hover:bg-accent"} ${focusRing}`}
    >
      <Icon name="scan" size={16} tint="foreground" />
      <Text class="hidden md:flex text-sm font-medium text-foreground">Barcode</Text>
    </Button>
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
  const narrowedLabel = () =>
    [
      filterLocation() ? locationName(filterLocation()) : "",
      filterGroup() ? (groups.data()?.find((g) => String(g.id) === filterGroup())?.name ?? "") : "",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <View class="gap-5 md:gap-6">
      <View class="gap-3">
        <View class="flex-row items-center gap-2 md:gap-3 min-h-11">
          <View class="flex-1 min-w-0">
            <Heading
              title="Stock"
              detail={count() ? `${count()} ${count() === 1 ? "product" : "products"}` : undefined}
            />
          </View>
          {wide() && count() ? searchField() : null}
          {scanToggle()}
          {purchaseAction()}
        </View>
        {!wide() && count() ? <View class="flex-row">{searchField()}</View> : null}
      </View>
      {scanner() ? (
        <View class="gap-2 pb-5 border-b border-border">
          <View class="gap-3 md:flex-row md:items-end">
            <View class="md:w-48">
              <Choice
                label="Barcode action"
                value={scanAction()}
                items={[
                  { value: "details", title: "View product" },
                  { value: "add", title: "Purchase" },
                  { value: "consume", title: "Use" },
                  { value: "open", title: "Open" },
                  { value: "inventory", title: "Count" },
                ]}
                onChange={(v) => scanAction.set(v)}
              />
            </View>
            <View class="flex-1 min-w-0">
              <Field
                label="Barcode"
                value={barcode()}
                autoFocus
                placeholder="Scan or enter barcode"
                onChange={(v) => barcode.set(v)}
                onSubmit={() => void lookupBarcode()}
              />
            </View>
            <Action
              label={scanBusy() ? "Looking up barcode…" : "Look up barcode"}
              icon="search"
              disabled={scanBusy() || op.busy() || !barcode().trim()}
              onPress={() => void lookupBarcode()}
            />
          </View>
          {scanError() ? (
            <Note error>{scanError()}</Note>
          ) : (
            <Note>
              Scan with a connected scanner or type the code. You review the product before any
              stock change.
            </Note>
          )}
        </View>
      ) : null}
      {proposals.data()?.length ? (
        <View class="flex-row items-center gap-2.5 min-h-11 px-3 rounded-lg border border-border bg-card">
          <Icon name="inbox" size={15} />
          <Count value={proposals.data()!.length} />
          <Text style={{ numberOfLines: 1 }} class="flex-1 min-w-0 text-sm text-ink-soft">
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
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
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
        <Empty title="No products yet" detail="Your stock starts with your first purchase." />
      ) : null}
      {count() ? (
        <View class="gap-3">
          <View class="gap-2">
            <View class="flex-row items-center gap-3">
              <View class="flex-1 min-w-0">
                <Segments
                  label="Filter products"
                  items={segments()}
                  value={view()}
                  onChange={(v) => filter.set(v)}
                />
              </View>
              {grouped() && attentionRows().length ? (
                <Text class="hidden md:flex text-[13px] text-muted-foreground">
                  Sorted by urgency
                </Text>
              ) : null}
              <Button
                accessibilityLabel="Filter and sort"
                onPress={() => filtering.set(true)}
                class={`shrink-0 min-h-11 md:min-h-8 px-2.5 flex-row gap-1.5 items-center rounded-lg hover:bg-accent active:bg-accent ${focusRing}`}
              >
                <Text class="text-sm font-medium text-foreground">
                  {wide() ? "Filter and sort" : "Filter"}
                </Text>
                {extraFilters() ? <Count value={extraFilters()} /> : null}
              </Button>
            </View>
            {narrowed() || sort() !== "urgency" ? (
              <View class="flex-row flex-wrap items-center gap-x-2 min-h-8">
                <Text style={{ numberOfLines: 1 }} class="shrink min-w-0 text-[13px] text-ink-soft">
                  {[narrowedLabel(), sort() !== "urgency" ? `by ${sortTitle(sort())}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                <Button
                  accessibilityLabel="Clear filters"
                  onPress={() => {
                    filterLocation.set("");
                    filterGroup.set("");
                    sort.set("urgency");
                  }}
                  class={`min-h-11 md:min-h-8 px-1 justify-center rounded-md ${focusRing}`}
                >
                  <Text class="text-[13px] font-medium text-foreground underline decoration-input underline-offset-4 hover:decoration-foreground">
                    Clear
                  </Text>
                </Button>
              </View>
            ) : null}
          </View>
          {!state.loading() && shown().length === 0 ? (
            query() && !narrowed() && view() === "all" ? (
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
            ) : (
              <Empty
                title={
                  query()
                    ? `No products match “${query()}” with these filters.`
                    : "No products match these filters."
                }
                detail="Try another status or location, or show every product again."
              >
                <View class="flex-row flex-wrap justify-center gap-2 pt-2">
                  <Action
                    label="Show all products"
                    onPress={() => {
                      showAll();
                      filtering.set(false);
                    }}
                  />
                  {query().trim() ? (
                    <Action
                      label={`Create ${query()}`}
                      icon="plus"
                      quiet
                      onPress={() => {
                        purchase();
                        newName.set(query());
                      }}
                    />
                  ) : null}
                </View>
              </Empty>
            )
          ) : null}
          {shown().length ? (
            <View>
              {columns()}
              {grouped() ? (
                <View>
                  {attentionRows().length ? group("Needs attention", attentionRows().length) : null}
                  <Each of={attentionRows()}>{(r) => row(r())}</Each>
                  {attentionRows().length && restRows().length
                    ? group("Everything else", restRows().length)
                    : null}
                  <Each of={restRows()}>{(r) => row(r())}</Each>
                </View>
              ) : (
                <View>
                  <Each of={shown()}>{(r) => row(r())}</Each>
                </View>
              )}
            </View>
          ) : null}
        </View>
      ) : null}
      <Panel
        open={filtering()}
        title="Filter and sort"
        onClose={() => filtering.set(false)}
        footer={
          <View class="flex-row flex-wrap items-center justify-between gap-2">
            <Action
              label="Reset filters"
              quiet
              onPress={() => {
                showAll();
                sort.set("urgency");
              }}
            />
            <Action
              label="Refresh stock"
              quiet
              disabled={state.loading() || op.busy()}
              onPress={() => {
                void state.refresh();
                void groups.refresh();
              }}
            />
          </View>
        }
      >
        <View class="gap-4">
          <Choice
            label="Stock status"
            value={view()}
            items={statuses.map((s) => ({ value: s.value, title: s.title }))}
            onChange={(v) => filter.set(v || "all")}
          />
          <Choice
            label="Stock location"
            value={filterLocation()}
            items={[
              { value: "", title: "All locations" },
              ...(state.data()?.locations ?? []).map((r) => ({
                value: String(r.id),
                title: r.name,
              })),
            ]}
            onChange={(v) => filterLocation.set(v)}
          />
          <LoadState loading={groups.loading()} error={groups.error()} retry={groups.refresh} />
          {groups.data()?.length ? (
            <Choice
              label="Product group"
              value={filterGroup()}
              items={[
                { value: "", title: "All groups" },
                ...(groups.data() ?? []).map((r) => ({ value: String(r.id), title: r.name })),
              ]}
              onChange={(v) => filterGroup.set(v)}
            />
          ) : null}
          <Choice
            label="Sort products"
            value={sort()}
            items={sorts}
            onChange={(v) => sort.set(v || "urgency")}
          />
          <Note>
            {`${shown().length} of ${count()} ${count() === 1 ? "product" : "products"} shown. Urgency puts what needs attention first.`}
          </Note>
        </View>
      </Panel>
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
                  {state.data()?.locations.find((l) => String(l.id) === location())?.name ?? ""}
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
              {Number(current()?.amount) > 0 && !Number(selected()?.disable_open) ? (
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
              {Number(current()?.amount) > 0 && (state.data()?.locations.length ?? 0) > 1 ? (
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
              {!entries.loading() && !entries.error() && !entries.data()?.length ? (
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
            <Field label="Product name" value={editName()} onChange={(v) => editName.set(v)} />
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
