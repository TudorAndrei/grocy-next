import { nativeTableDocumentOwner, useNativeDocumentReload } from "@/lib/native-document";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { getCustomDataCatalog, getUserobjectsContext } from "@/lib/custom-data-context";
import { getUserfieldRows, userentitiesQuery } from "@/lib/custom-data-lists";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import {
  nativeTableCell,
  nativeNumberCell,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { useTableOrder } from "@/lib/table-order";
import { matchesTableSearch } from "@/lib/table-search";
import { useModalDialog } from "@/hooks/useModalDialog";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { Icon } from "./Icon";
import { UserfieldValue } from "./UserfieldValue";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import {
  StockTableOptions,
  StockTableStatus,
  StockTableCells,
  StockTableRows,
} from "./StockTableOptions";

type Kind = "fields" | "entities" | "objects";

type ListRow = {
  id: number;
  name: string;
  namespace?: string;
  edit: string;
  cells: NativeTableRow;
  content: ReactNode[];
  customValues?: Record<string, string | null>;
};

export function CustomDataLists({
  kind,
  entityName = "",
  initialEntity,
  onDeleteNavigation,
}: {
  kind: Kind;
  entityName?: string;
  initialEntity?: string | true;
  onDeleteNavigation: () => void;
}) {
  const { t, ready: translated } = useI18n();
  const client = useQueryClient();
  const features = useFeatures();
  const preferences = usePreferences();
  const initialValue = initialEntity === true ? "true" : (initialEntity ?? "");
  const [text, setText] = useState("");
  const [entity, setEntity] = useState(initialValue || "all");
  const [addEntity, setAddEntity] = useState(initialValue);
  const [includeAddEntity, setIncludeAddEntity] = useState(Boolean(initialValue));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const [deleting, setDeleting] = useState<ListRow>();
  const [reloading, setReloading] = useState(false);
  const filtersId = useId();
  const relatedId = useId();
  const alive = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const catalog = useQuery({
    queryKey: ["custom-data-catalog"],
    queryFn: ({ signal }) => getCustomDataCatalog(signal),
    enabled: kind === "fields",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const fields = useQuery({
    queryKey: ["custom-data-fields"],
    queryFn: ({ signal }) => getUserfieldRows(signal),
    enabled: kind === "fields",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const entities = useQuery({
    ...userentitiesQuery,
    enabled: kind === "entities",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const objects = useQuery({
    queryKey: ["custom-data-objects", entityName],
    queryFn: ({ signal }) => getUserobjectsContext(entityName, signal),
    enabled: kind === "objects",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const shown = objects.data?.fields.filter((field) => field.show_as_column_in_tables === 1) ?? [];

  const title =
    kind === "fields"
      ? t("Userfields")
      : kind === "entities"
        ? t("Userentities")
        : (objects.data?.userentity.caption ?? t("Userobjects"));

  const tableId =
    kind === "objects"
      ? "userobjects-table-" + (objects.data?.userentity.id ?? 0)
      : kind === "fields"
        ? "userfields-table"
        : "userentities-table";

  const reloadDocument = useNativeDocumentReload(nativeTableDocumentOwner(tableId));

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    ...(kind === "fields"
      ? [
          { key: "entity", label: "Entity", groupable: true },
          { key: "name", label: "Name" },
          { key: "caption", label: "Caption" },
          { key: "type", label: "Type", groupable: true },
          { key: "sort", label: "Sort number" },
        ]
      : kind === "entities"
        ? [
            { key: "name", label: "Name" },
            { key: "caption", label: "Caption" },
          ]
        : shown.map((field) => ({
            key: "custom:" + field.name,
            label: field.caption,
            labelIsLiteral: true,
            groupable: true,
          }))),
  ];

  const ready =
    kind === "fields"
      ? fields.isSuccess && catalog.isSuccess
      : kind === "entities"
        ? entities.isSuccess
        : objects.isSuccess;

  const fetching =
    kind === "fields"
      ? fields.isFetching || catalog.isFetching
      : kind === "entities"
        ? entities.isFetching
        : objects.isFetching;

  const options = useTableOptions(
    tableId,
    columns,
    { key: columns[1]?.key ?? "actions", descending: false },
    ready,
  );

  const view: ListRow[] =
    kind === "fields"
      ? (fields.data ?? []).map((field) => ({
          id: field.id,
          name: field.name,
          namespace: field.entity,
          edit: "/userfield/" + field.id,
          cells: {
            entity: nativeTableCell(tableText(field.entity)),
            name: nativeTableCell(tableText(field.name)),
            caption: nativeTableCell(tableText(field.caption)),
            type: nativeTableCell(tableText(t(field.type))),
            sort:
              // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Zod validates this SQL scalar union; numeric cells need its numeric branch.
              typeof field.sort_number === "number"
                ? nativeNumberCell(tableText(field.sort_number), field.sort_number)
                : nativeTableCell(tableText(field.sort_number)),
          },
          content: [field.entity, field.name, field.caption, t(field.type), field.sort_number],
        }))
      : kind === "entities"
        ? (entities.data ?? []).map((entry) => ({
            id: entry.id,
            name: entry.name,
            namespace: "userentity-" + entry.name,
            edit: "/userentity/" + entry.id,
            cells: {
              name: nativeTableCell(tableText(entry.name)),
              caption: nativeTableCell(tableText(entry.caption)),
            },
            content: [entry.name, entry.caption],
          }))
        : (objects.data?.rows ?? []).map((entry) => ({
            customValues: entry.values,
            id: entry.id,
            name: "",
            edit: "/userobject/" + encodeURIComponent(entityName) + "/" + entry.id,
            cells: Object.fromEntries(
              shown.map((field) => [
                "custom:" + field.name,
                userfieldTableCell(
                  field,
                  entry.values[field.name] ?? null,
                  preferences.priceDisplayPrecision,
                  String(features.query.data?.CURRENCY ?? "USD"),
                  features.query.data,
                  Object.hasOwn(entry.values, field.name),
                ),
              ]),
            ),
            content: shown.map((field) => (
              <UserfieldValue
                nativeTable
                key={field.id}
                field={field}
                value={entry.values[field.name] ?? null}
                present={Object.hasOwn(entry.values, field.name)}
              />
            )),
          }));

  const snapshot = useTableSnapshot(
    view,
    ready && !fetching && !reloading && translated && options.ready,
    options.resetVersion,
    kind === "fields"
      ? fields.dataUpdatedAt
      : kind === "entities"
        ? entities.dataUpdatedAt
        : objects.dataUpdatedAt,
  );

  const ordered = useTableOrder(
    (snapshot?.value ?? []).map((row) => ({ key: String(row.id), row, cells: row.cells })),
    options,
    !!snapshot,
  );

  const selected = catalog.data?.entities.includes(entity) ? entity : "";

  const rows = ordered.filter(
    (row) =>
      (kind !== "fields" ||
        entity === "all" ||
        matchesTableSearch(row.cells.entity.search, selected)) &&
      matchesTableSearch(
        Object.values(row.cells)
          .map((cell) => cell.search)
          .join("  "),
        text === "all" ? "" : text,
      ),
  );

  const reload = async () => {
    if (reloadDocument()) return;
    const own = ++generation.current;
    setReloading(true);
    setEmbedded(undefined);
    setDeleting(undefined);
    setText("");
    setEntity(initialValue || "all");
    setAddEntity(initialValue);
    setIncludeAddEntity(Boolean(initialValue));

    try {
      const result =
        kind === "fields"
          ? await fields.refetch()
          : kind === "entities"
            ? await entities.refetch()
            : await objects.refetch();

      if (alive.current && own === generation.current && result.isSuccess) options.reload();
    } finally {
      if (alive.current && own === generation.current) setReloading(false);
    }
  };

  const remove = useMutation({
    mutationFn: ({ row }: { row: ListRow; generation: number }) =>
      request(
        "/api/objects/" +
          (kind === "fields"
            ? "userfields"
            : kind === "entities"
              ? "userentities"
              : "userobjects") +
          "/" +
          row.id,
        { method: "DELETE" },
      ),
    onSuccess: async (_result, input) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["objects"] }),
        client.invalidateQueries({ queryKey: ["entity-manager-userfields"] }),
        client.invalidateQueries({ queryKey: ["custom-data-catalog"] }),
        client.invalidateQueries({ queryKey: ["custom-data-entities"], refetchType: "none" }),
        client.invalidateQueries({ queryKey: ["custom-data-objects"], refetchType: "none" }),
      ]);

      if (!alive.current || input.generation !== generation.current) return;
      onDeleteNavigation();
      await reload();
    },
  });

  const openEditor = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
  };

  const error =
    kind === "fields"
      ? (fields.error ?? catalog.error)
      : kind === "entities"
        ? entities.error
        : objects.error;

  const addPath =
    kind === "fields"
      ? "/userfield/new"
      : kind === "entities"
        ? "/userentity/new"
        : "/userobject/" + encodeURIComponent(entityName) + "/new";

  const addSearch =
    kind === "fields" && includeAddEntity
      ? { embedded: "", entity: catalog.data?.entities.includes(addEntity) ? addEntity : "" }
      : { embedded: "" };

  const question =
    kind === "fields"
      ? 'Are you sure you want to delete user field "%s"?'
      : kind === "entities"
        ? 'Are you sure you want to delete userentity "%s"?'
        : "Are you sure you want to delete this userobject?";

  return (
    <>
      <PageHeader
        title={title}
        lead={kind === "objects" ? objects.data?.userentity.description : undefined}
        actions={
          <>
            <button
              type="button"
              className="btn household-related-toggle"
              aria-controls={relatedId}
              aria-expanded={relatedOpen}
              onClick={() => setRelatedOpen((open) => !open)}
            >
              {t("Related links")}
            </button>
            <div id={relatedId} className="household-related-links" data-expanded={relatedOpen}>
              <Link
                className="btn btn-primary"
                to={addPath}
                search={addSearch}
                onClick={openEditor}
              >
                {t("Add")}
              </Link>
              {kind === "objects" ? (
                <Link
                  className="btn"
                  to="/userfields"
                  search={{ entity: "userentity-" + entityName }}
                >
                  {t("Configure fields")}
                </Link>
              ) : null}
            </div>
          </>
        }
      />
      <button
        type="button"
        className="btn household-journal-filter-toggle"
        aria-controls={filtersId}
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((open) => !open)}
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
        {kind === "fields" ? (
          <label className="field">
            {t("Entity")}
            <select
              value={entity === "all" ? "all" : selected}
              onChange={(event) => {
                const value = event.target.value;
                setEntity(value);
                setAddEntity(value === "all" ? "" : value);
                setIncludeAddEntity(true);
                options.draw();
              }}
            >
              {entity !== "all" && !selected ? <option value="" hidden disabled /> : null}
              <option value="all">{t("All")}</option>
              {catalog.data?.entities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText("");
            setEntity("all");
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

              if (kind === "fields") void catalog.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {!snapshot && !error ? <LoadingBlock /> : null}
      {snapshot ? (
        <div className="journal-table-scroll" role="region" aria-label={title} tabIndex={0}>
          <table className="stock-table custom-data-table">
            <caption className="sr-only">{title}</caption>
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
                        type="button"
                        className="journal-sort"
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
                const groupedField = shown.find(
                  (field) => options.groupColumn === `custom:${field.name}`,
                );

                const groupedValues = row.customValues ?? {};
                const cell = row.cells[options.groupColumn ?? ""];
                const name = cell ? tablePlainText(cell.html) : "";

                return {
                  key: cell?.html ?? "",
                  label: name,
                  name,
                  userfield:
                    groupedField &&
                    ["link", "link-with-title", "file", "image"].includes(groupedField.type)
                      ? {
                          field: groupedField,
                          value: groupedValues[groupedField.name] ?? null,
                          present: Object.hasOwn(groupedValues, groupedField.name),
                        }
                      : undefined,
                };
              })}
            >
              {rows.map((row) => (
                <tr key={row.id}>
                  <StockTableCells options={options}>
                    <td className="row-actions">
                      <Link
                        className="btn btn-ghost btn-sm"
                        to={row.edit}
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
                      {kind === "entities" ? (
                        <Link
                          className="btn btn-ghost btn-sm"
                          to="/userfields"
                          search={{ entity: row.namespace }}
                        >
                          {t("Configure fields")}
                        </Link>
                      ) : null}
                    </td>
                    {row.content.map((content, index) =>
                      kind === "entities" && index === 0 ? (
                        <th scope="row" key={index}>
                          {content}
                        </th>
                      ) : (
                        <td key={index}>{content}</td>
                      ),
                    )}
                  </StockTableCells>
                </tr>
              ))}
            </StockTableRows>
          </table>
        </div>
      ) : null}
      {deleting ? (
        <DeleteCustom
          key={deleting.id}
          question={t(question, deleting.name)}
          onClose={() => setDeleting(undefined)}
          onDelete={() => {
            remove.mutate({ row: deleting, generation: generation.current });
            setDeleting(undefined);
          }}
        />
      ) : null}
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
    </>
  );
}

function DeleteCustom({
  question,
  onClose,
  onDelete,
}: {
  question: string;
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
      <p>{question}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onDelete}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}
