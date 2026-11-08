import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { getUsersOverview, writeUser, userValues, type NativeUser } from "@/lib/user-form";
import { useI18n } from "@/lib/i18n";
import { useNativeDocumentReload } from "@/lib/native-document";
import { usePreferences } from "@/lib/preferences";
import { useFeatures } from "@/lib/features";
import { useTableOptions } from "@/lib/table-options";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { useTableOrder } from "@/lib/table-order";
import {
  nativeTableCell,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { nativeUserfieldTableCell } from "@/lib/userfield-table-cell";
import { matchesTableSearch } from "@/lib/table-search";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { StockTableCells, StockTableOptions, StockTableStatus } from "./StockTableOptions";
import { QuantityUnitDeleteDialog } from "./QuantityUnitEditor";
import { NativeUserfieldRows, NativeUserfieldValue } from "./NativeUserfieldTable";

export function NativeUsers() {
  const reloadDocument = useNativeDocumentReload("/users");
  const { t } = useI18n();
  const preferences = usePreferences();
  const features = useFeatures();
  const client = useQueryClient();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const context = useQuery({
    queryKey: ["users-overview"],
    queryFn: ({ signal }) => getUsersOverview(signal),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [version, setVersion] = useState(0);
  const [reloading, setReloading] = useState(false);

  const snapshot = useTableSnapshot(
    context.data,
    context.isSuccess &&
      !context.isFetching &&
      settings.isSuccess &&
      !settings.isFetching &&
      !reloading,
    version,
    context.dataUpdatedAt,
  );

  const data = snapshot?.value;
  const fields = data?.fields.filter((field) => field.show_as_column_in_tables === 1) ?? [];

  const options = useTableOptions(
    "users-table",
    [
      { key: "actions", label: "", configurable: false },
      { key: "username", label: "Username" },
      { key: "first_name", label: "First name" },
      { key: "last_name", label: "Last name" },
      ...fields.map((field) => ({
        key: `custom:${field.name}`,
        label: field.caption,
        labelIsLiteral: true,
        groupable: true,
      })),
    ],
    { key: "username", descending: false },
    !!data,
  );

  const [text, setText] = useState("");
  const [applied, setApplied] = useState("");
  const timer = useRef<number>(undefined);
  const [deleting, setDeleting] = useState<NativeUser>();
  const scope = useRef<AbortController>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    const owner = new AbortController();
    scope.current = owner;

    return () => {
      scope.current?.abort();

      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, []);

  const source = (data?.users ?? []).map((row) => {
    const custom = data ? userValues(data, row.id) : {};

    const cells: NativeTableRow = {
      username: nativeTableCell(tableText(row.username)),
      first_name: nativeTableCell(tableText(row.first_name)),
      last_name: nativeTableCell(tableText(row.last_name)),
      ...Object.fromEntries(
        fields.map((field) => [
          `custom:${field.name}`,
          nativeUserfieldTableCell(
            field,
            custom[field.name] ?? null,
            Object.hasOwn(custom, field.name),
            preferences.priceDisplayPrecision,
            String(features.query.data?.CURRENCY ?? "USD"),
            features.query.data,
          ),
        ]),
      ),
    };

    return { key: String(row.id), row: { user: row, custom, cells }, cells };
  });

  const ordered = useTableOrder(source, options);
  const groupedField = fields.find((field) => options.groupColumn === `custom:${field.name}`);

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      Object.values(row.cells)
        .map((cell) => cell.search)
        .join("  "),
      applied,
    ),
  );

  const reload = async () => {
    if (reloadDocument()) return;
    const own = ++generation.current;
    scope.current?.abort();
    const owner = new AbortController();
    scope.current = owner;

    if (timer.current !== undefined) window.clearTimeout(timer.current);
    setText("");
    setApplied("");
    setDeleting(undefined);
    setReloading(true);

    try {
      const result = await context.refetch();

      if (!owner.signal.aborted && own === generation.current && result.isSuccess) {
        setVersion((current) => current + 1);
        options.reload();
      }
    } finally {
      if (!owner.signal.aborted && own === generation.current) setReloading(false);
    }
  };

  const remove = async (row: NativeUser) => {
    const signal = scope.current?.signal;
    const own = generation.current;
    setDeleting(undefined);

    try {
      await writeUser(client, `/api/users/${row.id}`, "DELETE", {}, signal);

      if (!signal?.aborted && own === generation.current) await reload();
    } catch (error) {
      if (!signal?.aborted && own === generation.current) console.error(error);
    }
  };

  return (
    <>
      <PageHeader
        title={t("Users")}
        actions={
          <>
            {data && !data.externally_managed_authentication ? (
              <Link className="btn btn-primary" to="/user/$userId" params={{ userId: "new" }}>
                {t("Add")}
              </Link>
            ) : null}
            <Link className="btn btn-ghost" to="/userfields" search={{ entity: "users" }}>
              {t("Configure userfields")}
            </Link>
          </>
        }
      />
      {context.isPending ? <LoadingBlock /> : null}
      {context.error ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button type="button" className="btn" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      {data ? (
        <>
          <div className="toolbar">
            <label className="field">
              {t("Search")}
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
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (timer.current !== undefined) window.clearTimeout(timer.current);
                setText("");
                setApplied("");
                options.draw();
              }}
            >
              {t("Clear filter")}
            </button>
          </div>
          <StockTableStatus options={options} />
          <div className="journal-table-scroll">
            <table className="stock-table">
              <caption className="sr-only">{t("Users")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th>
                      <StockTableOptions options={options} onReset={() => void reload()} />
                    </th>
                    {options.columns.slice(1).map((column) => (
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
                          {column.labelIsLiteral ? column.label : t(column.label)}
                        </button>
                      </th>
                    ))}
                  </StockTableCells>
                </tr>
              </thead>
              <NativeUserfieldRows
                options={options}
                interactiveField={
                  groupedField &&
                  ["image", "file", "link", "link-with-title"].includes(groupedField.type)
                    ? groupedField
                    : undefined
                }
                groups={rows.map((row) => {
                  const cell = row.cells[options.groupColumn ?? "username"];
                  const name = tablePlainText(cell?.html ?? "");

                  const value = row.custom[groupedField?.name ?? ""] ?? null;
                  const present = Object.hasOwn(row.custom, groupedField?.name ?? "");

                  return {
                    key: cell?.html ?? "",
                    label: groupedField ? (
                      <NativeUserfieldValue field={groupedField} value={value} present={present} />
                    ) : (
                      name
                    ),
                    name,
                    value,
                    present,
                  };
                })}
              >
                {rows.map(({ user, custom }) => (
                  <tr key={user.id} data-user-id={user.id}>
                    <StockTableCells options={options}>
                      <td className="row-actions">
                        <Link
                          className="btn btn-sm"
                          to="/user/$userId"
                          params={{ userId: String(user.id) }}
                          aria-label={t("Edit this item")}
                        >
                          {t("Edit")}
                        </Link>
                        {data.show_permissions ? (
                          <Link
                            className="btn btn-sm"
                            to="/user/$userId/permissions"
                            params={{ userId: String(user.id) }}
                          >
                            {t("Configure user permissions")}
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={user.id === data.current_user_id}
                          onClick={() => setDeleting(user)}
                        >
                          {t("Delete this item")}
                        </button>
                      </td>
                      <th scope="row">{user.username}</th>
                      <td>{user.first_name}</td>
                      <td>{user.last_name}</td>
                      {fields.map((field) => (
                        <td key={field.id}>
                          <NativeUserfieldValue
                            field={field}
                            value={custom[field.name] ?? null}
                            present={Object.hasOwn(custom, field.name)}
                          />
                        </td>
                      ))}
                    </StockTableCells>
                  </tr>
                ))}
              </NativeUserfieldRows>
            </table>
          </div>
          {snapshot && !rows.length ? (
            <p className="empty-state">{t("No users match this filter.")}</p>
          ) : null}
        </>
      ) : null}
      {deleting ? (
        <QuantityUnitDeleteDialog
          message={t('Are you sure you want to delete user "%s"?', deleting.username ?? "")}
          pending={false}
          error={null}
          onClose={() => setDeleting(undefined)}
          onDelete={() => void remove(deleting)}
        />
      ) : null}
    </>
  );
}
