import { useNativeDocumentReload } from "@/lib/native-document";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  getMealPlanSections,
  invalidateMealPlanSections,
  type MealPlanSection,
} from "@/lib/mealplan-sections";
import { nativeTableCell, tableText } from "@/lib/native-table-cell";
import { useTableOptions } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { matchesTableSearch } from "@/lib/table-search";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { StockTableCells, StockTableOptions, StockTableStatus } from "./StockTableOptions";
import { QuantityUnitDeleteDialog } from "./QuantityUnitEditor";

const columns = [
  { key: "actions", label: "", configurable: false },
  { key: "name", label: "Name" },
  { key: "sort_number", label: "Sort number" },
  { key: "time_info", label: "Time" },
];

export function MealPlanSections() {
  const { t } = useI18n();
  const reloadDocument = useNativeDocumentReload("/mealplansections");
  const client = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [applied, setApplied] = useState("");
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const [deleting, setDeleting] = useState<MealPlanSection>();
  const [reloading, setReloading] = useState(false);
  const searchTimer = useRef<number>(undefined);
  const owner = useRef<AbortController>(undefined);
  useEffect(() => {
    const scope = new AbortController();
    owner.current = scope;

    return () => {
      owner.current?.abort();

      if (searchTimer.current !== undefined) window.clearTimeout(searchTimer.current);
    };
  }, []);

  const records = useQuery({
    queryKey: ["mealplan-sections"],
    queryFn: ({ signal }) => getMealPlanSections(signal),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const ready = records.isSuccess && settings.isSuccess && !settings.isFetching;

  const options = useTableOptions(
    "mealplansections-table",
    columns,
    { key: "sort_number", descending: false },
    ready,
  );

  const snapshot = useTableSnapshot(
    records.data,
    ready && !records.isFetching && options.ready && !reloading,
    options.resetVersion,
    records.dataUpdatedAt,
  );

  const ordered = useTableOrder(
    (snapshot?.value ?? []).map((row) => ({
      key: String(row.id),
      row,
      cells: {
        name: nativeTableCell(tableText(row.name)),
        sort_number: nativeTableCell(tableText(row.sort_number)),
        time_info: nativeTableCell(tableText(row.time_info)),
      },
    })),
    options,
    !!snapshot,
  );

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      `${row.name ?? ""}  ${row.sort_number ?? ""}  ${row.time_info ?? ""}`,
      applied,
    ),
  );

  const reload = async () => {
    if (reloadDocument()) return;
    owner.current?.abort();
    const scope = new AbortController();
    owner.current = scope;

    if (searchTimer.current !== undefined) window.clearTimeout(searchTimer.current);
    setText("");
    setApplied("");
    setDeleting(undefined);
    setEmbedded(undefined);
    setReloading(true);

    try {
      const result = await records.refetch();

      if (!scope.signal.aborted && result.isSuccess) options.reload();
    } finally {
      if (!scope.signal.aborted) setReloading(false);
    }
  };

  const remove = useMutation({
    mutationFn: async ({ id, signal }: { id: number; signal: AbortSignal | undefined }) => {
      await request(`/api/objects/meal_plan_sections/${id}`, { method: "DELETE", signal });
      void invalidateMealPlanSections(client);
      signal?.throwIfAborted();
    },
    onSuccess: async (_result, { signal }) => {
      if (signal?.aborted) return;
      await navigate({ to: "/mealplansections", search: {} });

      if (!signal?.aborted) await reload();
    },
    onError: (error, { signal }) => {
      if (!signal?.aborted) console.error(error);
    },
  });

  const editorHref = (id: number | "new") =>
    router.buildLocation({
      to: "/mealplansection/$sectionId",
      params: { sectionId: String(id) },
      search: {},
    }).publicHref + "?embedded";

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
  };

  const error = records.error ?? settings.error;

  return (
    <>
      <PageHeader
        title={t("Meal plan sections")}
        actions={
          <a className="btn btn-primary" href={editorHref("new")} onClick={open}>
            {t("Add")}
          </a>
        }
      />
      <div className="toolbar journal-filters">
        <label className="field">
          {t("Search")}
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyUp={(event) => {
              const input = event.currentTarget;

              if (searchTimer.current !== undefined) window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => {
                const value = input.value;
                setApplied(value === "all" ? "" : value);
                options.draw();
              }, 500);
            }}
          />
        </label>
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (searchTimer.current !== undefined) window.clearTimeout(searchTimer.current);
            setText("");
            setApplied("");
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
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {!snapshot && !error ? <LoadingBlock /> : null}
      {snapshot ? (
        <div className="journal-table-scroll">
          <table className="stock-table" id="mealplansections-table">
            <caption className="sr-only">{t("Meal plan sections")}</caption>
            <thead>
              <tr>
                <StockTableCells options={options} headers>
                  <th>
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
                        {t(column.label)}
                      </button>
                    </th>
                  ))}
                </StockTableCells>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <StockTableCells options={options}>
                    <td className="row-actions">
                      <a
                        className="btn btn-sm"
                        aria-label={t("Edit this item")}
                        href={editorHref(row.id)}
                        onClick={open}
                      >
                        {t("Edit")}
                      </a>
                      <button
                        className="btn btn-sm"
                        type="button"
                        aria-label={t("Delete this item")}
                        onClick={() => setDeleting(row)}
                      >
                        {t("Delete")}
                      </button>
                    </td>
                    <th scope="row">{row.name}</th>
                    <td>{row.sort_number}</td>
                    <td>{row.time_info}</td>
                  </StockTableCells>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
      {deleting ? (
        <QuantityUnitDeleteDialog
          message={t(
            'Are you sure you want to delete meal plan section "%s"?',
            deleting.name ?? "",
          )}
          pending={false}
          error={null}
          onClose={() => setDeleting(undefined)}
          onDelete={() => {
            remove.mutate({ id: deleting.id, signal: owner.current?.signal });
            setDeleting(undefined);
          }}
        />
      ) : null}
    </>
  );
}
