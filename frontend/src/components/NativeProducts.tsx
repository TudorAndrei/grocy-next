import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useNativeDocumentReload, useNativePresentation } from "@/lib/native-document";
import { userSettingsQuery } from "@/hooks/queries";
import { useProductCardMemory } from "@/hooks/useProductCardMemory";
import {
  getNativeProductsContext,
  nativeProductValues,
  nativeProductsCells,
  nativeProductsColumns,
  nativeProductsSearch,
  type NativeProductsContext,
} from "@/lib/native-products";
import { nativeQueryFlag, nativeQueryParameter } from "@/lib/native-query-flag";
import { useTableOptions } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { matchesTableSearch } from "@/lib/table-search";
import { tablePlainText } from "@/lib/native-table-cell";
import { fetchApiDocument } from "@/lib/open-document";
import { NativeProductActionsScope, NativeProductRowActions } from "./NativeProductRowActions";
import { NativeUserfieldRows, NativeUserfieldValue } from "./NativeUserfieldTable";
import { StockTableCells, StockTableOptions, StockTableStatus } from "./StockTableOptions";
import { EntityPicture } from "./EntityPicture";
import { ProductOverview } from "./ProductOverview";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { Icon } from "./Icon";

export function NativeProducts() {
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });
  const reloadDocument = useNativeDocumentReload("/products");

  const reload = async (next = "") => {
    const current = router.history.location;
    const query = next && !next.startsWith("?") ? `?${next}` : next;
    reloadDocument();

    if (current.search !== query || current.hash) {
      await router.navigate({ href: current.pathname + query, replace: true });
    }
  };

  return <ProductsContext key={search} search={search} generation={0} onReload={reload} />;
}

function ProductsContext({
  search,
  generation,
  onReload,
}: {
  search: string;
  generation: number;
  onReload: (search?: string) => Promise<void>;
}) {
  const { t, ready, localizationError, retryLocalization } = useI18n();
  const client = useQueryClient();
  const presentation = useNativePresentation();

  const source =
    presentation?.kind === "products" && presentation.search === search
      ? presentation.value
      : undefined;

  const [snapshot, setSnapshot] = useState<NativeProductsContext>();
  const [settingsPrepared, setSettingsPrepared] = useState(false);

  const context = useQuery({
    queryKey: ["native-products", search, generation],
    queryFn: ({ signal }) => getNativeProductsContext(search, signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !source,
  });

  const settings = useQuery(userSettingsQuery());

  if (
    !snapshot &&
    ready &&
    (source || (context.isSuccess && context.isFetchedAfterMount && !context.isFetching))
  )
    setSnapshot(source ?? context.data);

  if (
    snapshot &&
    !settingsPrepared &&
    !settings.isFetching &&
    settings.data &&
    Object.keys(settings.data).length === Object.keys(snapshot.user_settings).length &&
    Object.entries(snapshot.user_settings).every(([key, value]) => settings.data?.[key] === value)
  )
    setSettingsPrepared(true);
  useEffect(() => {
    if (!snapshot || settingsPrepared) return;
    let active = true;
    const key = userSettingsQuery().queryKey;
    // The controller snapshot replaces any settings request belonging to the previous page.
    void client.cancelQueries({ queryKey: key, exact: true }).then(() => {
      if (active) client.setQueryData(key, snapshot.user_settings);
    });

    return () => {
      active = false;
    };
  }, [snapshot, settingsPrepared, client]);

  if (snapshot && settingsPrepared)
    return (
      <NativeProductActionsScope>
        <ProductsTable context={snapshot} search={search} onReload={onReload} />
      </NativeProductActionsScope>
    );

  return (
    <>
      <PageHeader title={t("Products")} />
      {context.error || localizationError ? (
        <>
          <ErrorBlock message={(context.error ?? localizationError)!.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              retryLocalization();
              void context.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : (
        <LoadingBlock />
      )}
    </>
  );
}

function ProductsTable({
  context,
  search,
  onReload,
}: {
  context: NativeProductsContext;
  search: string;
  onReload: (search?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [applied, setApplied] = useState("");

  const [group, setGroup] = useState(() => {
    const raw = nativeQueryParameter(search, "product-group");

    return raw === undefined
      ? "all"
      : context.product_groups.some((item) => String(item.id) === String(raw))
        ? String(raw)
        : "";
  });

  const [disabled, setDisabled] = useState(() => nativeQueryFlag(search, "include_disabled"));
  const [status, setStatus] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const filters = useId();
  const related = useId();
  const timer = useRef<number>(undefined);
  const groupInput = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (group === "" && groupInput.current) groupInput.current.selectedIndex = -1;
  });
  const [selected, setSelected] = useState<number>();
  const [expanded, setExpanded] = useState(false);
  const memory = useProductCardMemory();
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );
  const columns = nativeProductsColumns(context);
  const options = useTableOptions("products-table", columns, { key: "name", descending: false });

  const cells = new Map(
    context.products.map((row) => [
      row.id,
      nativeProductsCells(row, context, t("This product has a picture")),
    ]),
  );

  const ordered = useTableOrder(
    context.products.map((row) => ({ key: String(row.id), row, cells: cells.get(row.id)! })),
    options,
  );

  const selectedGroup =
    group === "all"
      ? t("All")
      : (context.product_groups.find((item) => String(item.id) === group)?.name ?? "");

  const shown = ordered.filter(
    (row) =>
      (selectedGroup === t("All") ||
        cells.get(row.id)!.product_group.search.toLowerCase() === selectedGroup.toLowerCase()) &&
      matchesTableSearch(
        Object.values(cells.get(row.id)!)
          .map((cell) => cell.search)
          .join("  "),
        applied,
      ),
  );

  const grouped = context.userfields.find(
    (field) => `custom:${field.name}` === options.groupColumn,
  );

  const reset = () => void onReload(search);
  const reload = () => onReload();

  const updateStatus = (value: string) => {
    setStatus(value);

    const next = nativeProductsSearch(search, (params) => {
      if (value === "all") {
        params.set("only_in_stock", "true");
        params.delete("only_in_stock");
        params.delete("only_out_of_stock");
      } else if (value === "in-stock") {
        params.delete("only_out_of_stock");
        params.set("only_in_stock", "true");
      } else {
        params.delete("only_in_stock");
        params.set("only_out_of_stock", "true");
      }
    });

    void onReload(next);
  };

  const heading = (key: string, label: string) => (
    <th
      key={key}
      aria-sort={
        options.sort.key === key ? (options.sort.descending ? "descending" : "ascending") : "none"
      }
    >
      <button
        type="button"
        className="journal-sort"
        onClick={(event) => options.sortBy(key, event.shiftKey)}
      >
        {label}
      </button>
    </th>
  );

  return (
    <section className="native-products">
      <PageHeader
        title={t("Products")}
        actions={
          <>
            <button
              type="button"
              className="btn native-products-filters-toggle"
              aria-label={t("Filter")}
              aria-expanded={filtersOpen}
              aria-controls={filters}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <Icon name="search" />
            </button>
            <button
              type="button"
              className="btn native-products-related-toggle"
              aria-label={t("More")}
              aria-expanded={relatedOpen}
              aria-controls={related}
              onClick={() => setRelatedOpen((value) => !value)}
            >
              <Icon name="more" />
            </button>
            <div id={related} className="native-products-related" data-expanded={relatedOpen}>
              <Link
                className="btn btn-primary"
                to="/product/$productId"
                params={{ productId: "new" }}
              >
                {t("Add")}
              </Link>
              <Link className="btn" to="/userfields" search={{ entity: "products" }}>
                {t("Configure userfields")}
              </Link>
              <Link className="btn" to="/stocksettings" hash="productpresets">
                {t("Presets for new products")}
              </Link>
              <Link className="btn" to="/catalog">
                {t("Catalog")}
              </Link>
            </div>
          </>
        }
      />
      <div id={filters} className="toolbar native-products-filters" data-expanded={filtersOpen}>
        <label className="field">
          <span>{t("Search")}</span>
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyUp={(event) => {
              const input = event.currentTarget;

              if (timer.current !== undefined) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => {
                setApplied(input.value === "all" ? "" : input.value);
                options.draw();
              }, 500);
            }}
          />
        </label>
        <label className="field">
          <span>{t("Product group")}</span>
          <select
            ref={groupInput}
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              options.draw();
            }}
          >
            <option value="all">{t("All")}</option>
            {context.product_groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("Status")}</span>
          <select value={status} onChange={(event) => updateStatus(event.target.value)}>
            <option value="all">{t("All")}</option>
            <option value="in-stock">{t("In stock products")}</option>
            <option value="out-of-stock">{t("Out of stock products")}</option>
          </select>
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={disabled}
            onChange={(event) => {
              setDisabled(event.target.checked);
              void onReload(
                nativeProductsSearch(search, (params) => {
                  if (event.target.checked) params.set("include_disabled", "true");
                  else params.delete("include_disabled");
                }),
              );
            }}
          />
          {t("Show disabled")}
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (timer.current !== undefined) window.clearTimeout(timer.current);
            setText("");
            setApplied("");
            setGroup("all");
            options.draw();

            if (disabled) {
              setDisabled(false);
              void onReload(
                nativeProductsSearch(search, (params) => {
                  params.delete("include_disabled");
                  params.delete("only_in_stock");
                }),
              );
            }

            if (status !== "all") updateStatus("all");
          }}
        >
          {t("Clear filter")}
        </button>
      </div>
      <StockTableStatus options={options} />
      <div className="native-products-scroll">
        <table className="stock-table journal-table native-products-table" id="products-table">
          <caption className="sr-only">{t("Products")}</caption>
          <thead>
            <tr>
              <StockTableCells options={options} headers>
                <th>
                  <StockTableOptions options={options} onReset={reset} />
                </th>
                {columns
                  .slice(1)
                  .filter((column) => column.rendered !== false)
                  .map((column) =>
                    heading(column.key, column.labelIsLiteral ? column.label : t(column.label)),
                  )}
              </StockTableCells>
            </tr>
          </thead>
          <NativeUserfieldRows
            options={options}
            interactiveField={
              grouped && ["image", "file", "link", "link-with-title"].includes(grouped.type)
                ? grouped
                : undefined
            }
            groups={shown.map((row) => {
              const cell = cells.get(row.id)![options.groupColumn ?? "name"];
              const values = nativeProductValues(context, row.id);
              const value = values[grouped?.name ?? ""] ?? null;
              const present = Object.hasOwn(values, grouped?.name ?? "");
              const name = tablePlainText(cell?.html ?? "");

              return {
                key: cell?.html ?? "",
                label: grouped ? (
                  <NativeUserfieldValue field={grouped} value={value} present={present} />
                ) : (
                  name
                ),
                name,
                value,
                present,
              };
            })}
          >
            {shown.map((row) => {
              const values = nativeProductValues(context, row.id);
              const cell = cells.get(row.id)!;

              return (
                <tr
                  key={row.id}
                  data-product-id={row.id}
                  className={row.active === 0 ? "native-product-inactive" : undefined}
                >
                  <StockTableCells options={options}>
                    <td className="row-actions">
                      <NativeProductRowActions
                        product={row}
                        products={context.products}
                        onReload={reload}
                      />
                    </td>
                    <th scope="row">
                      <button
                        className="productcard-trigger"
                        type="button"
                        onClick={() => setSelected(row.id)}
                      >
                        {row.name}
                        {row.picture_file_name && row.picture_file_name !== "0" ? (
                          <span title={t("This product has a picture")}>
                            <Icon name="image" />
                          </span>
                        ) : null}
                      </button>
                    </th>
                    {columns
                      .slice(2)
                      .filter((column) => column.rendered !== false)
                      .map((column) => (
                        <td
                          key={column.key}
                          className={
                            column.key === "picture"
                              ? "native-product-picture"
                              : column.key === "grocycode"
                                ? "native-product-code"
                                : undefined
                          }
                        >
                          {column.key === "grocycode" ? (
                            <ProductGrocycode id={row.id} name={row.name ?? ""} />
                          ) : column.key === "picture" ? (
                            row.picture_file_name && row.picture_file_name !== "0" ? (
                              <EntityPicture
                                group="productpictures"
                                source={row.picture_file_name}
                                label={t("%s picture", row.name ?? "")}
                                width={64}
                                height={64}
                              />
                            ) : null
                          ) : column.key.startsWith("custom:") ? (
                            <NativeUserfieldValue
                              field={context.userfields.find(
                                (field) => `custom:${field.name}` === column.key,
                              )!}
                              value={values[column.key.slice(7)] ?? null}
                              present={Object.hasOwn(values, column.key.slice(7))}
                            />
                          ) : column.key === "minimum" ? (
                            <span className="locale-number locale-number-quantity-amount">
                              {tablePlainText(cell.minimum.html)}
                            </span>
                          ) : (
                            tablePlainText(cell[column.key]?.html ?? "")
                          )}
                        </td>
                      ))}
                  </StockTableCells>
                </tr>
              );
            })}
          </NativeUserfieldRows>
        </table>
      </div>
      {selected !== undefined ? (
        <ProductOverview
          productId={selected}
          memory={memory}
          embedded={false}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onReturn={() => onReload(search)}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}

function ProductGrocycode({ id, name }: { id: number; name: string }) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ url: string } | { error: string }>();
  useEffect(() => {
    const owner = new AbortController();
    let url: string | undefined;
    void fetchApiDocument(`/product/${id}/grocycode?size=25`, owner.signal)
      .then((blob) => {
        if (owner.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ url });
      })
      .catch((error: Error) => {
        if (!owner.signal.aborted) setResult({ error: error.message });
      });

    return () => {
      owner.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  return result ? (
    "url" in result ? (
      <img src={result.url} alt={t("%s Grocycode", name)} loading="lazy" />
    ) : (
      <ErrorBlock message={result.error} />
    )
  ) : (
    <LoadingBlock />
  );
}
