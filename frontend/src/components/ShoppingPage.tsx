import { useI18n } from "@/lib/i18n";
import { Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { api, queryKeys } from "@/lib/api";
import { useCatalog, useInvalidateStock } from "@/lib/catalog";
import { unitLabel } from "@/lib/format";
import { userSettingsQuery } from "@/hooks/queries";
import { ShoppingItemForm } from "@/components/ShoppingItemForm";
import { ShoppingNotes } from "@/components/ShoppingNotes";
import { ShoppingListActions } from "@/components/ShoppingListActions";
import { shoppingListsQuery } from "@/lib/shopping-list";
import { ShoppingPrintAction } from "@/components/ShoppingPrintAction";
import type { ShoppingList, ShoppingListItem, UserSettings } from "@/lib/types";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Icon } from "@/components/Icon";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { useNotify } from "@/components/Toaster";
import { useFeatures } from "@/lib/features";
import { ShoppingCalendar } from "./ShoppingCalendar";
import { ShoppingPurchaseDialog, type ShoppingPurchaseRequest } from "./ShoppingPurchaseDialog";
import { nativeShoppingListText, type NativeShoppingContext } from "@/lib/native-shopping";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";

type Mode = "plan" | "shop";

const shoppingListChanged = z.object({
  Message: z.literal("ShoppingListChanged"),
  Payload: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform((value) => Number(value))
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
});

const nativeShoppingListChanged = z.object({
  Message: z.literal("ShoppingListChanged"),
  Payload: z
    .union([z.number(), z.string().regex(/^[+-]?\d+$/)])
    .transform(Number)
    .pipe(z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)),
});

function initialMode(): Mode {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
    ? "shop"
    : "plan";
}

type ShoppingPageProps = {
  nativePage?: boolean;
  nativeContext?: NativeShoppingContext;
  nativeSearch?: string;
  onNativeReload?: () => void;
  selectedListId: number;
  onListChange: (id: number) => void;
  onListReset?: () => void;
};

export function ShoppingPage(props: ShoppingPageProps) {
  const [generation, setGeneration] = useState(0);
  const { selectedListId, onListChange } = props;

  const reload = useCallback(
    (id: number) => {
      if (props.nativePage) onListChange(id);
      else if (id === selectedListId) setGeneration((previous) => previous + 1);
      else onListChange(id);
    },
    [selectedListId, onListChange, props.nativePage],
  );

  return (
    <ShoppingPageView key={`${selectedListId}:${generation}`} {...props} onReloadPage={reload} />
  );
}

function ShoppingPageView({
  nativePage = false,
  nativeContext,
  nativeSearch,
  onNativeReload,
  selectedListId,
  onListChange,
  onListReset,
  onReloadPage,
}: ShoppingPageProps & { onReloadPage: (id: number) => void }) {
  const { t: tr, locale, pluralIndex } = useI18n();

  const features = useFeatures();
  const stockEnabled = features.enabled("STOCK");
  const datesEnabled = stockEnabled && features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const router = useRouter();

  const configuration = useQuery({
    queryKey: queryKeys.systemConfig,
    queryFn: api.getSystemConfig,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const [initial, setInitial] = useState<UserSettings>();

  if (
    !initial &&
    settings.isSuccess &&
    !settings.isFetching &&
    configuration.isSuccess &&
    !configuration.isFetching
  )
    setInitial(settings.data);

  const templateFlag = (name: string) => {
    const value = initial?.[name];

    return (
      value !== undefined &&
      value !== null &&
      value !== false &&
      value !== 0 &&
      value !== "" &&
      value !== "0"
    );
  };

  const roundUp = templateFlag("shopping_list_round_up");
  const showCalendar = templateFlag("shopping_list_show_calendar");

  const precision = Math.max(
    0,
    Math.min(20, Math.trunc(Number(initial?.stock_decimal_places_amounts ?? 4))),
  );

  const amountText = (value: number) =>
    value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: Number.isFinite(precision) ? precision : 4,
    });

  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const notify = useNotify();
  const invalidateStock = useInvalidateStock();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [revision, setRevision] = useState(0);
  const [actionsRevision, setActionsRevision] = useState(0);
  const [editing, setEditing] = useState<{ itemId?: number }>();
  const [nativeEditor, setNativeEditor] = useState<EmbeddedPage>();
  const nativeEditorHost = useRef<HTMLDivElement>(null);
  const [purchase, setPurchase] = useState<ShoppingPurchaseRequest>();
  const purchaseRows = useRef<HTMLUListElement>(null);
  const listId = features.enabled("SHOPPINGLIST_MULTIPLE_LISTS") ? selectedListId : 1;
  const displayList = nativeContext ? nativeShoppingListText(nativeContext) : String(listId);

  const [notesDraft, setNotesDraft] = useState<{
    listId: number;
    html: string;
    visible: boolean;
  }>();

  const receiveListChange = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;

    if (
      nativeEditor &&
      event.data?.Message === "CloseLastModal" &&
      event.source === nativeEditorHost.current?.querySelector("iframe")?.contentWindow
    ) {
      setNativeEditor(undefined);

      return;
    }

    const parsed = (nativePage ? nativeShoppingListChanged : shoppingListChanged).safeParse(
      event.data,
    );

    if (!parsed.success) return;
    const id = parsed.data.Payload;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: shoppingListsQuery.queryKey, refetchType: "none" }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.objects("shopping_lists"),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.shopping(id), refetchType: "none" }),
    ]);
    onReloadPage(id);
  });

  useEffect(() => {
    const receive = (event: MessageEvent) => receiveListChange(event);
    window.addEventListener("message", receive);

    return () => window.removeEventListener("message", receive);
  }, []);

  const updateNotes = useCallback(
    (notes: { html: string; visible: boolean }) => {
      setNotesDraft({ listId, ...notes });
    },
    [listId],
  );

  const lists = useQuery({
    ...shoppingListsQuery,
    refetchOnMount: "always",
    enabled: features.enabled("SHOPPINGLIST_MULTIPLE_LISTS"),
  });

  const listKey = queryKeys.shopping(listId);

  const modernList = useQuery({
    queryKey: listKey,
    queryFn: () => api.getShoppingList(listId),
    refetchOnMount: "always",
    enabled: nativeContext === undefined,
  });

  const list = nativeContext
    ? {
        data: {
          id: nativeContext.list?.id ?? listId,
          name: nativeContext.list?.name ?? tr("Shopping list"),
          description: nativeContext.list?.description ?? null,
          items: nativeContext.items,
        },
        isSuccess: true,
        isLoading: false,
        isError: false,
        error: null,
      }
    : modernList;

  const items = list.data?.items ?? [];

  const itemEditorHref = (id: number | "new") =>
    `${router.buildLocation({ to: "/shoppinglistitem/$itemId", params: { itemId: String(id) }, search: {} }).publicHref}?embedded&list=${displayList}`;

  const openNativeItem = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    setNativeEditor({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
  };

  const open = items.filter((item) => !item.done);
  const checked = items.filter((item) => item.done);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listKey }),
      queryClient.invalidateQueries({ queryKey: shoppingListsQuery.queryKey }),
      ...(nativeContext
        ? [queryClient.invalidateQueries({ queryKey: ["shopping", "native-context"] })]
        : []),
    ]);
  };

  const itemName = (item: ShoppingListItem) =>
    item.product_id != null ? catalog.productName(item.product_id) : (item.note ?? "Note");

  const purchaseHref = (item: ShoppingListItem) => {
    const amount = item.stock_amount ?? item.amount;
    const quantity = roundUp ? Math.ceil(amount) : amount;

    return `${router.buildLocation({ to: "/purchase", search: {} }).publicHref}?embedded&flow=shoppinglistitemtostock&product=${item.product_id}&amount=${quantity}&listitemid=${item.id}&quId=${item.qu_id ?? ""}`;
  };

  const startAllPurchases = () => {
    const entries = Array.from(
      purchaseRows.current?.querySelectorAll<HTMLLIElement>("li[data-stock-purchase-item]") ?? [],
    ).flatMap((target) => {
      const item = items.find((row) => String(row.id) === target.dataset.stockPurchaseItem);

      return item
        ? [{ itemId: item.id, url: new URL(purchaseHref(item), window.location.href).href, target }]
        : [];
    });

    if (!entries.length) return;
    setPurchase({ entries, all: true, version: (purchase?.version ?? 0) + 1 });
  };

  const onError = (err: Error) => notify({ message: err.message, tone: "error" });

  const toggle = useMutation({
    mutationFn: (item: ShoppingListItem) => api.setShoppingItemDone(item.id, !item.done),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<ShoppingList>(listKey);
      queryClient.setQueryData<ShoppingList>(listKey, (data) =>
        data
          ? {
              ...data,
              items: data.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
            }
          : data,
      );

      return { previous };
    },
    onError: (err: Error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
      onError(err);
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (item: ShoppingListItem) => api.deleteObject("shopping_list", item.id),
    onSuccess: async (_data, item) => {
      await refresh();
      const productId = item.product_id;
      notify({
        message: tr("Removed %s", String(itemName(item))),
        undo:
          productId != null
            ? async () => {
                await api.addShoppingProduct(productId, item.amount, item.note, listId, item.qu_id);
                await refresh();
              }
            : undefined,
      });
    },
    onError,
  });

  const clear = useMutation({
    mutationFn: (doneOnly: boolean) => api.clearShoppingList(listId, doneOnly),
    onSuccess: async () => {
      if (nativeContext && onNativeReload) onNativeReload();
      else await refresh();
      notify({ message: tr("Shopping list cleared") });
    },
    onError,
  });

  const addMissing = useMutation({
    mutationFn: () => api.addMissingToShoppingList(listId),
    onSuccess: async () => {
      if (nativeContext) onReloadPage(listId);
      else await refresh();
      notify({ message: tr("Added every product below its minimum") });
    },
    onError,
  });

  const addDue = useMutation({
    mutationFn: (kind: "overdue" | "expired") =>
      kind === "overdue"
        ? api.addOverdueToShoppingList(listId)
        : api.addExpiredToShoppingList(listId),
    onSuccess: async (_data, kind) => {
      if (nativeContext) onReloadPage(listId);
      else await refresh();
      notify({ message: tr("Added every %s product", String(kind)) });
    },
    onError,
  });

  // Checked items become purchases; then the checked rows leave the list.
  const putAway = useMutation({
    mutationFn: async (done: ShoppingListItem[]) => {
      let count = 0;

      for (const item of done) {
        const result = await api.purchaseShoppingItem(listId, item.id);

        if (result.purchased) count += 1;
      }

      return count;
    },
    onSuccess: async (count) => {
      await Promise.all([refresh(), invalidateStock()]);
      notify({
        message: tr(
          "Booked %1$s %2$s into stock",
          String(count),
          String(count === 1 ? "purchase" : "purchases"),
        ),
      });
    },
    onError: async (err: Error) => {
      await Promise.all([refresh(), invalidateStock()]);
      onError(err);
    },
  });

  if (!initial)
    return (
      <>
        <PageHeader title={tr("Shopping list")} />
        {settings.error || configuration.error ? (
          <>
            <ErrorBlock message={(settings.error ?? configuration.error)!.message} />
            <button
              type="button"
              className="btn"
              onClick={() => void Promise.all([settings.refetch(), configuration.refetch()])}
            >
              {tr("Retry")}
            </button>
          </>
        ) : (
          <LoadingBlock label={tr("Loading preferences…")} />
        )}
      </>
    );

  return (
    <div className="shopping" data-mode={mode}>
      <PageHeader
        title={list.data?.name ?? tr("Shopping list")}
        lead={
          list.isSuccess
            ? tr(
                "%1$s to buy%2$s",
                String(open.length),
                String(checked.length ? ` · ${checked.length} in the basket` : ""),
              )
            : tr("Build the list for the next run, then check items off in the shop.")
        }
        actions={
          <>
            <Link to="/shoppinglistsettings" className="btn btn-ghost">
              {tr("Shopping list settings")}
            </Link>
            {features.enabled("SHOPPINGLIST_MULTIPLE_LISTS") ? (
              <label className="select-field">
                <span className="sr-only">{tr("Shopping list")}</span>
                <select
                  value={listId}
                  onChange={(e) => {
                    setPurchase(undefined);
                    setNotesDraft(undefined);
                    setActionsRevision((value) => value + 1);
                    onListChange(Number(e.target.value));
                  }}
                >
                  {lists.data?.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} ({row.item_count})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {features.enabled("SHOPPINGLIST_MULTIPLE_LISTS") ? (
              <ShoppingListActions
                key={actionsRevision}
                listId={listId}
                name={
                  nativeContext?.lists.find((row) => row.id === listId)?.name ??
                  list.data?.name ??
                  ""
                }
                editHref={
                  nativeContext
                    ? `${router.buildLocation({ to: "/shoppinglist", search: {} }).publicHref.replace(/\/$/, "")}/${displayList}?embedded`
                    : undefined
                }
                onDeleted={() => {
                  setPurchase(undefined);
                  setNotesDraft(undefined);
                  setRevision((value) => value + 1);
                  setActionsRevision((value) => value + 1);

                  if (onListReset) onListReset();
                  else onListChange(1);
                }}
              />
            ) : null}
            {stockEnabled ? (
              <button
                type="button"
                className="btn"
                disabled={!items.some((item) => Boolean(item.product_id))}
                onClick={startAllPurchases}
              >
                {tr("Add all list items to stock")}
              </button>
            ) : null}
            <div className="seg-group" role="group" aria-label={tr("Mode")}>
              <button
                type="button"
                className="seg"
                aria-pressed={mode === "plan"}
                onClick={() => setMode("plan")}
              >
                {tr("Plan")}
              </button>
              <button
                type="button"
                className="seg"
                aria-pressed={mode === "shop"}
                onClick={() => setMode("shop")}
              >
                {tr("In the shop")}
              </button>
            </div>
          </>
        }
      />

      {mode === "plan" ? (
        <div className="toolbar">
          <AddItemForm listId={listId} onAdded={refresh} />
          <div className="toolbar-end">
            {nativeContext ? (
              <a className="btn" href={itemEditorHref("new")} onClick={openNativeItem}>
                {tr("Add item")}
              </a>
            ) : (
              <button type="button" className="btn" onClick={() => setEditing({})}>
                {tr("Create shopping list item")}
              </button>
            )}
            {stockEnabled ? (
              <button
                type="button"
                className="btn"
                disabled={addMissing.isPending}
                onClick={() => addMissing.mutate()}
              >
                {tr("Add missing")}
              </button>
            ) : null}
            {datesEnabled ? (
              <button
                type="button"
                className="btn"
                disabled={addDue.isPending}
                onClick={() => addDue.mutate("overdue")}
              >
                {tr("Add overdue")}
              </button>
            ) : null}
            {datesEnabled ? (
              <button
                type="button"
                className="btn"
                disabled={addDue.isPending}
                onClick={() => addDue.mutate("expired")}
              >
                {tr("Add expired")}
              </button>
            ) : null}
            <ShoppingPrintAction
              nativePage={nativePage}
              nativeSearch={nativeSearch}
              listId={nativeContext?.list?.id ?? listId}
              paper
              notes={notesDraft?.listId === listId ? notesDraft : undefined}
            />
            <ShoppingPrintAction listId={listId} nativePage={nativePage} />
            {features.enabled("LABEL_PRINTER") ? (
              <Link to="/labels" className="btn btn-ghost">
                {tr("Labels")}
              </Link>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={clear.isPending || items.length === 0}
              onClick={() => clear.mutate(true)}
            >
              {tr("Clear done items")}
            </button>
            <button
              type="button"
              className="btn btn-danger-quiet"
              disabled={clear.isPending || items.length === 0}
              onClick={() => {
                if (
                  window.confirm(
                    features.enabled("SHOPPINGLIST_MULTIPLE_LISTS")
                      ? tr(
                          'Are you sure you want to empty shopping list "%s"?',
                          `${list.data?.name ?? ""} (${items.length})`,
                        )
                      : tr("Are you sure you want to empty the shopping list?"),
                  )
                )
                  clear.mutate(false);
              }}
            >
              {tr("Clear list")}
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <ShoppingItemForm
          itemId={editing.itemId}
          listId={listId}
          onClose={() => setEditing(undefined)}
          onSaved={(id) => {
            setEditing(undefined);
            onListChange(id);
          }}
        />
      ) : null}
      <div className="shopping-preference-layout" data-calendar={showCalendar || undefined}>
        <div className="shopping-preference-items">
          {list.isLoading ? <LoadingBlock label={tr("Loading shopping list…")} /> : null}
          {list.isError ? <ErrorBlock message={list.error?.message ?? ""} /> : null}
          {list.isSuccess && items.length === 0 ? (
            <p className="empty-state">
              {tr(
                "The list is empty. Add a product above, press ⌘K and type “list coffee”, or pull in everything below its minimum with Add missing.",
              )}
            </p>
          ) : null}

          {items.length > 0 ? (
            <ul ref={purchaseRows} className="shop-list panel">
              {[...open, ...checked].map((item) => {
                const product =
                  item.product_id != null ? catalog.product(item.product_id) : undefined;

                const stockAmount = item.stock_amount ?? item.amount;
                const purchaseAmount = roundUp ? Math.ceil(stockAmount) : stockAmount;

                const displayAmount = roundUp
                  ? purchaseAmount * (item.display_factor ?? 1)
                  : item.amount;

                return (
                  <li
                    key={item.id}
                    className="shop-item"
                    data-done={item.done ? "true" : "false"}
                    data-stock-purchase-item={stockEnabled && item.product_id ? item.id : undefined}
                  >
                    <button
                      type="button"
                      className="shop-check"
                      role="checkbox"
                      aria-checked={item.done}
                      aria-label={tr("%s in the basket", String(itemName(item)))}
                      onClick={() => toggle.mutate(item)}
                    >
                      <span className="shop-box">{item.done ? <Icon name="check" /> : null}</span>
                      <span className="shop-name">
                        {itemName(item)}
                        <small>
                          {product
                            ? (catalog.location(product.location_id)?.name ?? tr("No location"))
                            : tr("Note")}
                          {item.product_id != null && item.note ? ` · ${item.note}` : ""}
                        </small>
                      </span>
                      <span className="amount">
                        {item.product_id != null
                          ? `${amountText(displayAmount)} ${unitLabel(catalog.unit(item.qu_id ?? product?.qu_id_stock), displayAmount, pluralIndex, false)}`
                          : amountText(displayAmount)}
                      </span>
                    </button>
                    {mode === "plan" ? (
                      <span className="row-actions">
                        {stockEnabled && item.product_id !== null ? (
                          <a
                            className="btn btn-sm btn-ghost"
                            href={purchaseHref(item)}
                            onClick={(event) => {
                              event.preventDefault();
                              setPurchase({
                                entries: [{ itemId: item.id, url: event.currentTarget.href }],
                                all: false,
                                version: (purchase?.version ?? 0) + 1,
                              });
                            }}
                          >
                            {tr("Add this item to stock")}
                          </a>
                        ) : null}
                        {nativeContext ? (
                          <a
                            className="btn btn-sm btn-ghost"
                            aria-label={tr("Edit %s", itemName(item))}
                            href={itemEditorHref(item.id)}
                            onClick={openNativeItem}
                          >
                            {tr("Edit")}
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            aria-label={tr("Edit %s", itemName(item))}
                            onClick={() => setEditing({ itemId: item.id })}
                          >
                            {tr("Edit")}
                          </button>
                        )}
                        {item.product_id != null ? (
                          <Link
                            to="/products/$productId"
                            params={{ productId: String(item.product_id) }}
                            className="btn btn-sm btn-ghost"
                          >
                            {tr("Product")}
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(item)}
                        >
                          {tr("Remove")}
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {list.isSuccess ? (
          <>
            {showCalendar ? (
              <ShoppingCalendar firstDayOfWeek={configuration.data?.CALENDAR_FIRST_DAY_OF_WEEK} />
            ) : null}
            <ShoppingNotes
              key={`${listId}:${locale}:${revision}`}
              listId={listId}
              description={list.data.description}
              initialDocument={nativeContext?.notes_document}
              onDraft={updateNotes}
            />
          </>
        ) : null}
      </div>
      <ShoppingPurchaseDialog key={listId} purchase={purchase} onRemoved={refresh} />
      {nativeEditor ? (
        <div ref={nativeEditorHost}>
          <EmbeddedPageDialog page={nativeEditor} onClose={() => setNativeEditor(undefined)} />
        </div>
      ) : null}

      {checked.length > 0 ? (
        <div className="basket-bar">
          <span>
            <b>{checked.length}</b> {tr("in the basket")}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={putAway.isPending}
            onClick={() => putAway.mutate(checked)}
          >
            {putAway.isPending ? tr("Booking…") : tr("Put %s in stock", String(checked.length))}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AddItemForm({ listId, onAdded }: { listId: number; onAdded: () => Promise<void> }) {
  const { t: tr } = useI18n();

  const catalog = useCatalog();
  const notify = useNotify();
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      if (productId) {
        await api.addShoppingProduct(
          Number(productId),
          Number(amount),
          note.trim(),
          listId,
          catalog.product(Number(productId))?.qu_id_stock,
        );
      } else {
        await api.createObject("shopping_list", {
          shopping_list_id: listId,
          product_id: null,
          amount: Number(amount),
          note: note.trim(),
        });
      }
    },
    onSuccess: async () => {
      await onAdded();
      notify({
        message: tr(
          "Added %s",
          String(productId ? catalog.productName(Number(productId)) : note.trim()),
        ),
      });
      setAmount("1");
      setNote("");
      setProductId("");
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();

    if ((!productId && !note.trim()) || !(Number(amount) > 0)) return;
    add.mutate();
  }

  const unit = productId ? catalog.stockUnitText(Number(productId), Number(amount) || 1) : "";

  return (
    <form className="add-form" onSubmit={onSubmit}>
      <label className="select-field grow">
        <span className="sr-only">{tr("Product")}</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">{tr("Note only (no product)")}</option>
          {catalog.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <label className="amount-field">
        <span className="sr-only">{tr("Amount")}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        {unit ? <span className="unit">{unit}</span> : null}
      </label>
      <label className="note-field">
        <span className="sr-only">{tr("Note")}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={productId ? tr("Note (optional)") : tr("Note")}
          required={!productId}
        />
      </label>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={add.isPending || (!productId && !note.trim())}
      >
        <Icon name="plus" />
        {tr("Add")}
      </button>
    </form>
  );
}
