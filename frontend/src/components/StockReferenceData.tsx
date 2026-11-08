import { nativeObjectUserfieldPresent } from "@/lib/native-userfield-values";
import { useNativeDocumentReload } from "@/lib/native-document";
import { useEffect, useEffectEvent, useId, useRef, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { nativeQueryFlag } from "@/lib/native-query-flag";
import {
  stockReferences,
  stockReferenceRecords,
  productGroupCounts,
  includesDisabledReferences,
  type StockReferenceEntity,
  type StockReferenceRecord,
} from "@/lib/stock-reference";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { useTableOrder } from "@/lib/table-order";
import { matchesTableSearch } from "@/lib/table-search";
import {
  nativeTableCell,
  nativeNumberCell,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import { userfieldsQuery } from "@/lib/userfields";
import { useModalDialog } from "@/hooks/useModalDialog";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { Icon } from "./Icon";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { UserfieldValue } from "./UserfieldValue";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";

const closed = z.object({ Message: z.literal("CloseLastModal") });

export function StockReferenceData({
  entity,
  search,
  onShowDisabled,
}: {
  entity: StockReferenceEntity;
  search: string;
  onShowDisabled: (checked: boolean) => void;
}) {
  const { t, ready: translated } = useI18n();
  const reloadDocument = useNativeDocumentReload(stockReferences[entity].path);
  const client = useQueryClient();
  const features = useFeatures();
  const preferences = usePreferences();
  const config = stockReferences[entity];
  const includeDisabled = includesDisabledReferences(search);
  const filtersId = useId();
  const relatedId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(() => nativeQueryFlag(search, "include_disabled"));
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const [deleting, setDeleting] = useState<StockReferenceRecord>();
  const [reloading, setReloading] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const records = useQuery({
    queryKey: ["stock-reference", entity],
    queryFn: ({ signal }) => stockReferenceRecords(entity, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const products = useQuery({
    queryKey: ["stock-reference", "group-products"],
    queryFn: ({ signal }) => productGroupCounts(signal),
    enabled: entity === "product_groups",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const fields =
    definitions.data?.filter(
      (field) => field.entity === entity && field.show_as_column_in_tables === 1,
    ) ?? [];

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    ...(entity === "product_groups" ? [{ key: "count", label: "Product count" }] : []),
    ...fields.map((field) => ({
      key: "custom:" + field.name,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const ready =
    records.isSuccess && definitions.isSuccess && (!products.isEnabled || products.isSuccess);

  const options = useTableOptions(
    config.path.slice(1) + "-table",
    columns,
    { key: "name", descending: false },
    ready,
  );

  const snapshot = useTableSnapshot(
    records.data?.filter((row) => includeDisabled || row.active === 1),
    ready &&
      !records.isFetching &&
      !products.isFetching &&
      options.ready &&
      translated &&
      !reloading,
    options.resetVersion,
    records.dataUpdatedAt,
  );

  const count = (id: number) =>
    products.data?.filter((product) => product.active === 1 && product.product_group_id === id)
      .length ?? 0;

  const cells = new Map(
    (snapshot?.value ?? []).map((row) => {
      const values: NativeTableRow = {
        name: nativeTableCell(tableText(row.name)),
        description: nativeTableCell(tableText(row.description)),
        ...Object.fromEntries(
          fields.map((field) => [
            "custom:" + field.name,
            userfieldTableCell(
              field,
              row.userfields?.[field.name] ?? null,
              preferences.priceDisplayPrecision,
              String(features.query.data?.CURRENCY ?? "USD"),
              features.query.data,
              nativeObjectUserfieldPresent(row.userfields, field.name),
            ),
          ]),
        ),
      };

      if (entity === "product_groups")
        values.count = nativeNumberCell(tableText(count(row.id)), count(row.id));

      return [row, values] as const;
    }),
  );

  const ordered = useTableOrder(
    (snapshot?.value ?? []).map((row) => ({ key: String(row.id), row, cells: cells.get(row)! })),
    options,
    !!snapshot,
  );

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      Object.values(cells.get(row)!)
        .map((cell) => cell.search)
        .join("  "),
      text === "all" ? "" : text,
    ),
  );

  const reload = async (restoreCheckbox = true) => {
    if (reloadDocument()) return;
    const ownGeneration = ++generation.current;
    setDeleting(undefined);
    setEmbedded(undefined);
    setText("");

    if (restoreCheckbox) setChecked(nativeQueryFlag(search, "include_disabled"));
    setReloading(true);

    try {
      const results = await Promise.all([
        records.refetch(),
        products.isEnabled ? products.refetch() : Promise.resolve(null),
      ]);

      if (alive.current && ownGeneration === generation.current && results[0].isSuccess)
        options.reload();
    } finally {
      if (alive.current && ownGeneration === generation.current) setReloading(false);
    }
  };

  const receive = useEffectEvent((event: MessageEvent) => {
    if (
      entity === "product_groups" &&
      event.origin === window.location.origin &&
      closed.safeParse(event.data).success
    )
      void reload();
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => receive(event);
    window.addEventListener("message", listener);

    return () => window.removeEventListener("message", listener);
  }, []);

  const remove = useMutation({
    mutationFn: ({ row }: { row: StockReferenceRecord; generation: number }) =>
      request("/api/objects/" + entity + "/" + row.id, { method: "DELETE" }),
    onSuccess: async (_result, input) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["objects", entity] }),
        client.invalidateQueries({ queryKey: [entity] }),
        client.invalidateQueries({ queryKey: ["products"] }),
        client.invalidateQueries({ queryKey: ["stock"] }),
      ]);

      if (!alive.current || input.generation !== generation.current) return;
      setChecked(false);
      onShowDisabled(false);
      await reload(false);
    },
  });

  const openEditor = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
  };

  const error = records.error ?? definitions.error ?? products.error;

  return (
    <>
      <PageHeader
        title={t(config.title)}
        actions={
          <>
            <button
              type="button"
              className="btn household-related-toggle"
              aria-controls={relatedId}
              aria-expanded={relatedOpen}
              onClick={() => setRelatedOpen((value) => !value)}
            >
              {t("Related links")}
            </button>
            <div id={relatedId} className="household-related-links" data-expanded={relatedOpen}>
              <Link
                className="btn btn-primary"
                to={config.editor + "/new"}
                search={{ embedded: "" }}
                onClick={openEditor}
              >
                {t("Add")}
              </Link>
              <Link className="btn" to={"/" + "userfields"} search={{ entity }}>
                {t("Configure userfields")}
              </Link>
            </div>
          </>
        }
      />
      <button
        type="button"
        className="btn household-journal-filter-toggle"
        aria-controls={filtersId}
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((value) => !value)}
      >
        <Icon name="filter" />
        {t("Filter")}
      </button>
      <div
        id={filtersId}
        className="toolbar journal-filters household-journal-filters"
        data-expanded={filtersOpen}
      >
        <label className="field">
          {t("Search")}
          <input
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              options.draw();
            }}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => {
              setChecked(event.target.checked);
              onShowDisabled(event.target.checked);
            }}
          />
          {t("Show disabled")}
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText("");
            options.draw();
          }}
        >
          {t("Clear filter")}
        </button>
      </div>
      <StockTableStatus options={options} />
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void reload();
              void definitions.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {!snapshot && !error ? <LoadingBlock /> : null}
      {snapshot ? (
        <div
          className="journal-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t(config.title)}
        >
          <table className="stock-table stock-reference-table">
            <caption className="sr-only">{t(config.title)}</caption>
            <thead>
              <tr>
                <StockTableCells options={options} headers>
                  <th scope="col">
                    <StockTableOptions
                      options={options}
                      onReset={() => {
                        void reload();
                      }}
                    />
                  </th>
                  {columns.slice(1).map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        options.sort.key === column.key
                          ? options.sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button
                        className="journal-sort"
                        type="button"
                        onClick={(event) => options.sortBy(column.key, event.shiftKey)}
                      >
                        {column.labelIsLiteral ? column.label : t(column.label)}
                      </button>
                    </th>
                  ))}
                </StockTableCells>
              </tr>
            </thead>
            <StockTableRows
              options={options}
              groups={rows.map((row) => {
                const groupedField = fields.find(
                  (field) => options.groupColumn === `custom:${field.name}`,
                );

                const groupedValues = row.userfields ?? {};
                const cell = cells.get(row)?.[options.groupColumn ?? ""];
                const name = cell ? tablePlainText(cell.html) : "";

                return {
                  key: cell?.html ?? "",
                  name,
                  label: name,
                  userfield:
                    groupedField &&
                    ["link", "link-with-title", "file", "image"].includes(groupedField.type)
                      ? {
                          field: groupedField,
                          value: groupedValues[groupedField.name] ?? null,
                          present: nativeObjectUserfieldPresent(groupedValues, groupedField.name),
                        }
                      : undefined,
                };
              })}
            >
              {rows.map((row) => (
                <tr key={row.id} data-disabled={row.active === 0 ? true : undefined}>
                  <StockTableCells options={options}>
                    <td className="row-actions">
                      <Link
                        className="btn btn-ghost btn-sm"
                        to={config.editor + "/" + row.id}
                        search={{ embedded: "" }}
                        onClick={openEditor}
                      >
                        {t("Edit this item")}
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          remove.reset();
                          setDeleting(row);
                        }}
                      >
                        {t("Delete this item")}
                      </button>
                    </td>
                    <th scope="row">{row.name}</th>
                    <td>{row.description}</td>
                    {entity === "product_groups" ? (
                      <td>
                        {count(row.id)}{" "}
                        <Link
                          to="/products"
                          search={{ "product-group": String(row.id) }}
                          aria-label={t("Products in %s", row.name)}
                        >
                          <Icon name="external" />
                        </Link>
                      </td>
                    ) : null}
                    {fields.map((field) => (
                      <td key={field.id}>
                        <UserfieldValue
                          nativeTable
                          field={field}
                          value={row.userfields?.[field.name] ?? null}
                          present={nativeObjectUserfieldPresent(row.userfields, field.name)}
                        />
                      </td>
                    ))}
                  </StockTableCells>
                </tr>
              ))}
            </StockTableRows>
          </table>
        </div>
      ) : null}
      {deleting ? (
        <DeleteReference
          row={deleting}
          question={config.question}
          pending={remove.isPending}
          error={remove.error}
          onClose={() => setDeleting(undefined)}
          onDelete={() => remove.mutate({ row: deleting, generation: generation.current })}
        />
      ) : null}
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
    </>
  );
}

function DeleteReference({
  row,
  question,
  pending,
  error,
  onClose,
  onDelete,
}: {
  row: StockReferenceRecord;
  question: string;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Delete this item")}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <p>{t(question, row.name)}</p>
      {error ? <ErrorBlock message={error.message} /> : null}
      <div className="actions">
        <button className="btn btn-primary" type="button" disabled={pending} onClick={onDelete}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}
