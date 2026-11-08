import { nativeObjectUserfieldPresent } from "@/lib/native-userfield-values";
import { useNativeDocumentReload } from "@/lib/native-document";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, filePath, request } from "@/lib/api";
import type { JsonObject, JsonValue } from "@/lib/json";
import { nativeEquipmentManualPath, nativeEquipmentResources } from "@/lib/native-equipment-files";
import { nativeResourceUrl } from "@/lib/native-userfields-clear";
import {
  decodeEquipmentDetail,
  decodeEquipmentFileDefinitions,
  getEquipmentDetailResponse,
  getEquipmentRecords,
  type EquipmentRecord,
} from "@/lib/equipment-page";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { fetchApiDocument, openApiDocument } from "@/lib/open-document";
import { userfieldsQuery } from "@/lib/userfields";
import {
  nativeTableCell,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { matchesTableSearch } from "@/lib/table-search";
import { useModalDialog } from "@/hooks/useModalDialog";
import { PageHeader } from "./PageHeader";
import { EquipmentManual } from "./EquipmentManual";
import { FullscreenCard, FullscreenToggle } from "./FullscreenCard";
import { RichDescription } from "./RichDescription";
import { UserfieldValue } from "./UserfieldValue";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { HouseholdRowMenu } from "./HouseholdRowMenu";
import { Icon } from "./Icon";
import { Tabs, TabPanel } from "./ui/Tabs";
import {
  StockTableOptions,
  StockTableStatus,
  StockTableCells,
  StockTableRows,
} from "./StockTableOptions";

type NativeEquipmentResource = { path: string; visible: boolean; revision: number };

const initialResource: NativeEquipmentResource = { path: "", visible: true, revision: 0 };

function fileResource(bindings: Record<string, NativeEquipmentResource>, name: string) {
  return Object.hasOwn(bindings, name) ? bindings[name]! : initialResource;
}

export function EquipmentPage({ onDeleted }: { onDeleted: () => void }) {
  const { t, ready: translated } = useI18n();
  const reloadDocument = useNativeDocumentReload("/equipment");
  const features = useFeatures();
  const [nativeResources] = useState(() => nativeEquipmentResources(features.query.data));
  const preferences = usePreferences();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [detail, setDetail] = useState<EquipmentRecord>();
  const [fileValues, setFileValues] = useState<Record<string, string | null>>({});
  const [manualResource, setManualResource] = useState(initialResource);
  const [fileResources, setFileResources] = useState<Record<string, NativeEquipmentResource>>({});
  const [detailError, setDetailError] = useState<Error>();
  const [tab, setTab] = useState("equipment-manual");
  const [deleting, setDeleting] = useState<EquipmentRecord>();
  const [reloading, setReloading] = useState(false);
  const filtersId = useId();
  const relatedId = useId();

  const lifetime = useRef<{ alive: boolean; generation: number; initialized?: number }>({
    alive: true,
    generation: 0,
  });

  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    const owner = lifetime.current;
    owner.alive = true;
    const owned = requests.current;

    return () => {
      owner.alive = false;
      owner.generation++;
      owner.initialized = undefined;

      for (const controller of owned) controller.abort();
      owned.clear();
    };
  }, []);

  const records = useQuery({
    queryKey: ["equipment-page"],
    queryFn: ({ signal }) => getEquipmentRecords(signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const fields = useMemo(
    () => definitions.data?.filter((field) => field.entity === "equipment") ?? [],
    [definitions.data],
  );

  const shown = fields.filter(
    (field) => field.show_as_column_in_tables === 1 && field.type !== "file",
  );

  const fileFields = useMemo(() => fields.filter((field) => field.type === "file"), [fields]);

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Name" },
    ...shown.map((field) => ({
      key: "custom:" + field.name,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    "equipment-table",
    columns,
    { key: "name", descending: false },
    records.isSuccess && definitions.isSuccess,
  );

  const snapshot = useTableSnapshot(
    records.data,
    records.isSuccess &&
      !records.isFetching &&
      definitions.isSuccess &&
      translated &&
      options.ready &&
      !reloading,
    options.resetVersion,
    records.dataUpdatedAt,
  );

  const ordered = useTableOrder(
    (snapshot?.value ?? []).map((row) => {
      const cells: NativeTableRow = {
        name: nativeTableCell(tableText(row.name)),
        ...Object.fromEntries(
          shown.map((field) => [
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

      return { key: String(row.id), row: { ...row, cells }, cells };
    }),
    options,
    !!snapshot,
  );

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      Object.values(row.cells)
        .map((cell) => cell.search)
        .join("  "),
      search === "all" ? "" : search,
    ),
  );

  const [renderedVersion, setRenderedVersion] = useState(-1);

  if (snapshot && renderedVersion !== snapshot.version) {
    setRenderedVersion(snapshot.version);
    setSelected(ordered[0]?.id);
    setDetail(undefined);
    setDetailError(undefined);
    setFileValues({});
    setManualResource(initialResource);
    setFileResources({});
    setTab("equipment-manual");
  }

  const loadFileDefinitions = useCallback(
    (values: NonNullable<EquipmentRecord["userfields"]>, own: number) => {
      const controller = new AbortController();
      requests.current.add(controller);

      const active = () =>
        lifetime.current.alive && !controller.signal.aborted && own === lifetime.current.generation;

      // Each accepted source detail owns an independent filtered read and captured values.
      void request<JsonValue>(
        "/api/objects/userfields?query[]=entity=equipment&query[]=type=file",
        { signal: controller.signal },
      )
        .then(
          (response) => {
            if (!active()) return;

            try {
              const definitions = decodeEquipmentFileDefinitions(response).filter((definition) =>
                fileFields.some((field) => field.name === definition.name),
              );

              if (!definitions.length) return;
              setFileResources((previous) => {
                const next = new Map(Object.entries(previous));

                for (const { name } of definitions) {
                  const raw = values[name];
                  const binding = next.get(name) ?? initialResource;

                  next.set(
                    name,
                    raw
                      ? {
                          path: `/files/userfiles/${raw}`,
                          visible: true,
                          revision: binding.revision + 1,
                        }
                      : { ...binding, visible: false },
                  );
                }

                return Object.fromEntries(next);
              });
            } catch (error) {
              window.queueMicrotask(() => {
                if (active()) throw error;
              });
            }
          },
          (error: Error) => {
            if (!active()) return;

            if (error instanceof ApiError && error.status >= 200 && error.status < 300) {
              window.queueMicrotask(() => {
                if (active()) throw error;
              });
            } else console.error(error);
          },
        )
        .finally(() => requests.current.delete(controller));
    },
    [fileFields],
  );

  const select = useCallback(
    (id: number) => {
      const own = lifetime.current.generation;
      const controller = new AbortController();
      requests.current.add(controller);

      const active = () =>
        lifetime.current.alive && !controller.signal.aborted && own === lifetime.current.generation;

      void getEquipmentDetailResponse(id, controller.signal)
        .then(
          (response) => {
            if (!active()) return;

            try {
              const value = decodeEquipmentDetail(response);

              // Native replies apply in completion order, even after a replaced selection.
              setDetail(value);

              if (nativeResources) {
                // The heading updates before source btoa can fail in this callback.
                const path = value.instruction_manual_file_name
                  ? nativeEquipmentManualPath(value.instruction_manual_file_name)
                  : "";

                setManualResource((previous) =>
                  path
                    ? { path, visible: true, revision: previous.revision + 1 }
                    : { ...previous, visible: false },
                );
              }

              setTab(value.instruction_manual_file_name ? "equipment-manual" : "equipment-notes");

              // Null skips the source's independent file-definition callback entirely.
              if (value.userfields !== null) {
                if (nativeResources) loadFileDefinitions(value.userfields, own);
                else
                  setFileValues(
                    Object.fromEntries(
                      fileFields.map((field) => [
                        field.name,
                        value.userfields?.[field.name] ?? null,
                      ]),
                    ),
                  );
              }
            } catch (error) {
              if (nativeResources)
                window.queueMicrotask(() => {
                  if (active()) throw error;
                });
              else if (error instanceof Error) setDetailError(error);
            }
          },
          (error: Error) => {
            if (!active()) return;

            if (!nativeResources) setDetailError(error);
            else if (error instanceof ApiError && error.status >= 200 && error.status < 300) {
              // Successful-body failures belong to the source callback's global channel.
              window.queueMicrotask(() => {
                if (active()) throw error;
              });
            } else console.error(error);
          },
        )
        .finally(() => {
          requests.current.delete(controller);
        });
    },
    [fileFields, nativeResources, loadFileDefinitions],
  );

  useEffect(() => {
    if (!snapshot || lifetime.current.initialized === snapshot.version) return;
    lifetime.current.initialized = snapshot.version;
    const first = ordered[0]?.id;

    if (first !== undefined) select(first);
  }, [snapshot, ordered, select]);

  const reload = async () => {
    if (reloadDocument()) return;
    const own = ++lifetime.current.generation;

    for (const controller of requests.current) controller.abort();
    requests.current.clear();
    setDeleting(undefined);
    setReloading(true);
    setSearch("");
    setDetailError(undefined);

    try {
      const [result, custom] = await Promise.all([records.refetch(), definitions.refetch()]);

      if (
        lifetime.current.alive &&
        own === lifetime.current.generation &&
        result.isSuccess &&
        custom.isSuccess
      )
        options.reload();
    } finally {
      if (lifetime.current.alive && own === lifetime.current.generation) setReloading(false);
    }
  };

  const remove = useMutation({
    mutationFn: async ({
      row,
      controller,
      generation,
    }: {
      row: EquipmentRecord;
      controller: AbortController;
      generation: number;
    }) => {
      const active = () =>
        lifetime.current.alive &&
        !controller.signal.aborted &&
        generation === lifetime.current.generation;

      try {
        await request(`/api/objects/equipment/${row.id}`, {
          method: "DELETE",
          signal: controller.signal,
        });
      } catch (error) {
        if (nativeResources && active()) {
          if (error instanceof ApiError && error.status >= 200 && error.status < 300) {
            window.queueMicrotask(() => {
              if (active()) throw error;
            });
          } else console.error(error);
        }

        throw error;
      } finally {
        requests.current.delete(controller);
      }
    },
    onSuccess: async (_result, input) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["objects", "equipment"] }),
        client.invalidateQueries({ queryKey: ["entity-manager", "equipment"] }),
        client.invalidateQueries({ queryKey: ["equipment-page"], refetchType: "none" }),
      ]);

      if (
        !lifetime.current.alive ||
        input.controller.signal.aborted ||
        input.generation !== lifetime.current.generation
      )
        return;
      onDeleted();
      await reload();
    },
  });

  const error = records.error ?? definitions.error;
  const name = detail?.name ?? "";

  const tabs = [
    { id: "equipment-manual", label: t("Instruction manual") },
    { id: "equipment-notes", label: t("Notes") },
    ...fileFields.map((field) => ({ id: "equipment-file-" + field.id, label: field.caption })),
  ];

  return (
    <>
      <PageHeader
        title={t("Equipment")}
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
                to="/equipment/$equipmentId"
                params={{ equipmentId: "new" }}
              >
                {t("Add")}
              </Link>
              <Link className="btn btn-ghost" to="/manage" search={{ entity: "equipment" }}>
                {t("Manage")}
              </Link>
            </div>
          </>
        }
      />
      <div className="equipment-workspace">
        <section className="equipment-list" aria-label={t("Equipment list")}>
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
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  options.draw();
                }}
              />
            </label>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setSearch("");
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
              <button className="btn" type="button" onClick={() => void reload()}>
                {t("Retry")}
              </button>
            </>
          ) : null}
          {!snapshot && !error ? <LoadingBlock /> : null}
          {snapshot ? (
            <div
              className="journal-table-scroll"
              role="region"
              aria-label={t("Equipment table")}
              tabIndex={0}
            >
              <table className="stock-table equipment-table">
                <caption className="sr-only">{t("Equipment")}</caption>
                <thead>
                  <tr>
                    <StockTableCells options={options} headers>
                      <th scope="col">
                        <StockTableOptions options={options} onReset={() => void reload()} />
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
                    const groupedField = shown.find(
                      (field) => options.groupColumn === `custom:${field.name}`,
                    );

                    const groupedValues = row.userfields ?? {};
                    const { cells } = row;
                    const cell = cells[options.groupColumn ?? ""];
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
                              present: nativeObjectUserfieldPresent(
                                groupedValues,
                                groupedField.name,
                              ),
                            }
                          : undefined,
                    };
                  })}
                >
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      data-equipment-id={row.id}
                      aria-selected={selected === row.id}
                      onClick={(event) => {
                        const target = event.target;

                        if (
                          target instanceof HTMLElement &&
                          target.closest<HTMLTableCellElement>("td,th")?.cellIndex !== 0
                        ) {
                          setSelected(row.id);
                          setDetailError(undefined);
                          select(row.id);
                        }
                      }}
                    >
                      <StockTableCells options={options}>
                        <td className="row-actions">
                          <Link
                            className="btn btn-ghost btn-sm hide-when-embedded hide-on-fullscreen-card"
                            to="/equipment/$equipmentId"
                            params={{ equipmentId: String(row.id) }}
                            aria-label={t("Edit %s", row.name ?? "")}
                          >
                            {t("Edit this item")}
                          </Link>
                          <HouseholdRowMenu label={t("More")}>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                remove.reset();
                                setDeleting(row);
                              }}
                            >
                              {t("Delete this item")}
                            </button>
                          </HouseholdRowMenu>
                        </td>
                        <td>
                          <button type="button" className="btn btn-ghost">
                            {row.name}
                          </button>
                        </td>
                        {shown.map((field) => (
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
        </section>
        <section className="equipment-selected" aria-label={t("Selected equipment")}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel={t("Equipment details")} />
          {detailError ? <ErrorBlock message={detailError.message} /> : null}
          {!nativeResources && !detail && !!snapshot?.value.length && !detailError ? (
            <LoadingBlock />
          ) : null}
          <TabPanel
            id="equipment-manual-panel"
            labelledBy="tab-equipment-manual"
            hidden={tab !== "equipment-manual"}
          >
            {nativeResources ? (
              <NativeEquipmentFileCard
                name={name}
                label={t("Instruction manual")}
                binding={manualResource}
                config={features.query.data}
                emptyHint={t("The selected equipment has no instruction manual")}
              />
            ) : (
              <FullscreenCard label={t("Instruction manual")}>
                <PageHeader
                  title={name}
                  actions={
                    <>
                      <FullscreenToggle />
                      {detail?.instruction_manual_file_name ? (
                        <EquipmentDownload
                          path={filePath("equipmentmanuals", detail.instruction_manual_file_name)}
                        />
                      ) : null}
                    </>
                  }
                />
                {detail?.instruction_manual_file_name ? (
                  <EquipmentManual
                    name={detail.instruction_manual_file_name}
                    label={t("Instruction manual")}
                  />
                ) : detail ? (
                  <p>{t("The selected equipment has no instruction manual")}</p>
                ) : null}
              </FullscreenCard>
            )}
          </TabPanel>
          <TabPanel
            id="equipment-notes-panel"
            labelledBy="tab-equipment-notes"
            hidden={tab !== "equipment-notes"}
          >
            <FullscreenCard label={t("Notes")}>
              <PageHeader title={name} actions={<FullscreenToggle />} />
              {detail ? <RichDescription entity="equipment" objectId={detail.id} /> : null}
            </FullscreenCard>
          </TabPanel>
          {fileFields.map((field) => (
            <TabPanel
              key={field.id}
              id={`equipment-file-${field.id}-panel`}
              labelledBy={`tab-equipment-file-${field.id}`}
              hidden={tab !== "equipment-file-" + field.id}
            >
              {nativeResources ? (
                <NativeEquipmentFileCard
                  name={name}
                  label={field.caption}
                  binding={fileResource(fileResources, field.name)}
                  config={features.query.data}
                />
              ) : (
                <FullscreenCard label={field.caption}>
                  <PageHeader
                    title={name}
                    actions={
                      <>
                        <FullscreenToggle />
                        {fileValues[field.name] ? (
                          <EquipmentDownload path={`/files/userfiles/${fileValues[field.name]}`} />
                        ) : null}
                      </>
                    }
                  />
                  {fileValues[field.name] ? (
                    <EquipmentUserfile
                      path={`/files/userfiles/${fileValues[field.name]}`}
                      label={field.caption}
                    />
                  ) : null}
                </FullscreenCard>
              )}
            </TabPanel>
          ))}
        </section>
      </div>
      {deleting ? (
        <DeleteEquipment
          row={deleting}
          onClose={() => setDeleting(undefined)}
          onDelete={() => {
            const row = deleting;
            setDeleting(undefined);
            const controller = new AbortController();
            requests.current.add(controller);
            remove.mutate({ row, controller, generation: lifetime.current.generation });
          }}
        />
      ) : null}
    </>
  );
}

function NativeEquipmentFileCard({
  name,
  label,
  binding,
  config,
  emptyHint,
}: {
  name: string;
  label: string;
  binding: NativeEquipmentResource;
  config: JsonObject | undefined;
  emptyHint?: string;
}) {
  const { t } = useI18n();
  const source = binding.path && config ? nativeResourceUrl(binding.path, config) : "";

  const assigned = useRef<{
    element: HTMLEmbedElement;
    source: string;
    revision: number;
  }>(undefined);

  const bindPreview = useCallback(
    (element: HTMLEmbedElement | null) => {
      if (!element) return;
      const previous = assigned.current;

      if (binding.path && !config) {
        if (previous?.element !== element) {
          element.setAttribute("src", "");
          assigned.current = { element, source: "", revision: 0 };
        }

        return;
      }

      if (
        previous?.element !== element ||
        previous.source !== source ||
        previous.revision !== binding.revision
      ) {
        // Accepted source callbacks reload even an identical URL; unrelated renders do not.
        element.setAttribute("src", source);
        assigned.current = { element, source, revision: binding.revision };
      }
    },
    [binding.path, binding.revision, config, source],
  );

  return (
    <FullscreenCard label={label}>
      <PageHeader
        title={name}
        actions={
          <>
            <FullscreenToggle />
            <span hidden={!binding.visible}>
              <a
                className="btn btn-ghost"
                href={source || "#"}
                target="_blank"
                rel="noopener"
                title={t("Download file")}
              >
                {t("Download file")}
              </a>
            </span>
          </>
        }
      />
      {emptyHint ? <p hidden={binding.visible}>{emptyHint}</p> : null}
      <embed
        className="equipment-manual"
        ref={bindPreview}
        type="application/pdf"
        aria-label={label}
        tabIndex={0}
        hidden={!binding.visible}
      />
    </FullscreenCard>
  );
}

function DeleteEquipment({
  row,
  onClose,
  onDelete,
}: {
  row: EquipmentRecord;
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
      <p>{t('Are you sure you want to delete equipment "%s"?', row.name ?? "")}</p>
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

function EquipmentDownload({ path }: { path: string }) {
  const { t } = useI18n();
  const [error, setError] = useState<Error>();

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setError(undefined);
          void openApiDocument(path).catch((error: Error) => setError(error));
        }}
      >
        {t("Download file")}
      </button>
      {error ? <ErrorBlock message={error.message} /> : null}
    </>
  );
}

function EquipmentUserfile({ path, label }: { path: string; label: string }) {
  const { t } = useI18n();

  const [result, setResult] = useState<
    { path: string; url: string } | { path: string; error: Error }
  >();

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void fetchApiDocument(path, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        // Match the native PDF embed, keeping uploaded active content out of the preview origin.
        url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setResult({ path, url });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ path, error });
      });

    return () => {
      controller.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  if (!result || result.path !== path) return <LoadingBlock label={t("Loading…")} />;

  if ("error" in result) return <ErrorBlock message={result.error.message} />;

  return (
    <object
      className="equipment-manual"
      type="application/pdf"
      data={result.url}
      aria-label={label}
    >
      <p>{t("Download file")}</p>
    </object>
  );
}
