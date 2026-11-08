import { BarcodeFormat, EncodeHintType, QRCodeWriter } from "@zxing/library";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { request, queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useNativeDocumentReload } from "@/lib/native-document";
import {
  apiKeyQrContent,
  getNativeApiKeys,
  invalidateNativeApiKeys,
  type NativeApiKey,
} from "@/lib/native-api-keys";
import { nativeTableCell, tableDate, tableText } from "@/lib/native-table-cell";
import { useTableOptions } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { matchesTableSearch } from "@/lib/table-search";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { StockTableDate } from "./StockTableDate";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { QuantityUnitDeleteDialog } from "./QuantityUnitEditor";

const columns = [
  { key: "actions", label: "", configurable: false },
  { key: "description", label: "Description" },
  { key: "api_key", label: "API key" },
  { key: "user", label: "User", groupable: true },
  { key: "expires", label: "Expires" },
  { key: "last_used", label: "Last used" },
  { key: "created", label: "Created" },
  { key: "key_type", label: "Key type", groupable: true },
];

export function NativeApiKeys({ search }: { search: string }) {
  const reloadDocument = useNativeDocumentReload("/manageapikeys");
  const { t, locale } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [applied, setApplied] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<NativeApiKey>();
  const [qr, setQr] = useState<NativeApiKey>();
  const [reloading, setReloading] = useState(false);
  const timer = useRef<number>(undefined);
  const owner = useRef<AbortController>(undefined);
  useEffect(() => {
    owner.current = new AbortController();

    return () => {
      owner.current?.abort();

      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, []);

  const records = useQuery({
    queryKey: ["native-api-keys", search],
    queryFn: ({ signal }) => getNativeApiKeys(search, signal),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const ready = records.isSuccess && settings.isSuccess && !settings.isFetching;

  const options = useTableOptions(
    "apikeys-table",
    columns,
    { key: "created", descending: true },
    ready,
  );

  const snapshot = useTableSnapshot(
    records.data,
    ready && !records.isFetching && options.ready && !reloading,
    options.resetVersion,
    records.dataUpdatedAt,
  );

  const [now] = useState(() => new Date());

  const prepared = (snapshot?.value.keys ?? []).map((key) => {
    const user = snapshot?.value.users.find((user) => user.id === key.user_id);
    const first = user?.first_name && user.first_name !== "0" ? user.first_name : "";
    const last = user?.last_name && user.last_name !== "0" ? user.last_name : "";
    const userName = first && last ? `${first} ${last}` : first || last || user?.username || "";
    const expires = tableDate(key.expires, now, locale, t, { plain: true });
    const lastUsed = tableDate(key.last_used, now, locale, t, { plain: true });

    if (!key.last_used || key.last_used === "0") lastUsed.date = t("never");
    const created = tableDate(key.row_created_timestamp, now, locale, t, { plain: true });

    const cells = {
      description: nativeTableCell(tableText(key.description)),
      api_key: nativeTableCell(tableText(key.api_key)),
      user: nativeTableCell(tableText(userName)),
      expires: nativeTableCell(expires.html),
      last_used: nativeTableCell(
        !key.last_used || key.last_used === "0" ? tableText(t("never")) : lastUsed.html,
      ),
      created: nativeTableCell(created.html),
      key_type: nativeTableCell(tableText(key.key_type)),
    };

    return {
      key: String(key.id),
      row: { key, userName, expires, lastUsed, created, cells },
      cells,
    };
  });

  const ordered = useTableOrder(prepared, options, !!snapshot);

  const rows = ordered.filter(({ cells }) =>
    matchesTableSearch(
      Object.values(cells)
        .map((cell) => cell.search)
        .join("  "),
      applied,
    ),
  );

  const reload = async () => {
    if (reloadDocument()) return;
    owner.current?.abort();
    const scope = new AbortController();
    owner.current = scope;
    remove.reset();

    if (timer.current !== undefined) window.clearTimeout(timer.current);
    setText("");
    setApplied("");
    setDescription("");
    setAdding(false);
    setDeleting(undefined);
    setQr(undefined);
    setReloading(true);

    try {
      const result = await records.refetch();

      if (!scope.signal.aborted && result.isSuccess) options.reload();
    } finally {
      if (!scope.signal.aborted) setReloading(false);
    }
  };

  const remove = useMutation({
    mutationFn: async ({ id, signal }: { id: number; signal?: AbortSignal }) => {
      signal?.throwIfAborted();

      try {
        await request(`/api/objects/api_keys/${id}`, { method: "DELETE", signal });
      } finally {
        invalidateNativeApiKeys(client);
        void client.invalidateQueries({ queryKey: queryKeys.currentUser, refetchType: "none" });
      }
    },
    onSuccess: async (_result, { signal }) => {
      if (signal?.aborted) return;
      await client.refetchQueries({ queryKey: queryKeys.currentUser, exact: true, type: "active" });

      if (signal?.aborted) return;

      if (search) {
        reloadDocument();
        await router.navigate({ to: "/manageapikeys", search: {} });
      } else await reload();
    },
    onError: (error, { signal }) => {
      if (!signal?.aborted) console.error(error);
    },
  });

  const error = records.error ?? settings.error;

  return (
    <>
      <PageHeader
        title={t("API keys")}
        actions={
          <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}>
            {t("Add")}
          </button>
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
          className="btn"
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
          <table className="stock-table" id="apikeys-table">
            <caption className="sr-only">{t("API keys")}</caption>
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
            <StockTableRows
              options={options}
              groups={rows.map((row) => {
                const value = options.groupColumn
                  ? options.groupColumn === "user"
                    ? row.userName
                    : row.key.key_type
                  : "";

                return { key: value, label: value, name: value };
              })}
            >
              {rows.map(({ key, userName, expires, lastUsed, created }) => (
                <tr
                  key={key.id}
                  aria-selected={Number(snapshot.value.selected_key_id) === key.id}
                  className={
                    Number(snapshot.value.selected_key_id) === key.id ? "table-info" : undefined
                  }
                >
                  <StockTableCells options={options}>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={t("Delete this item")}
                        onClick={() => setDeleting(key)}
                      >
                        {t("Delete")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={t("Show a QR-Code for this API key")}
                        onClick={() => setQr(key)}
                      >
                        {t("QR-Code")}
                      </button>
                    </td>
                    <td>{key.description}</td>
                    <td>{key.api_key}</td>
                    <td>{userName}</td>
                    <td>
                      <StockTableDate value={expires} />
                    </td>
                    <td>
                      <StockTableDate value={lastUsed} />
                    </td>
                    <td>
                      <StockTableDate value={created} />
                    </td>
                    <td>{key.key_type}</td>
                  </StockTableCells>
                </tr>
              ))}
            </StockTableRows>
          </table>
        </div>
      ) : null}
      {adding ? (
        <AddKeyDialog
          value={description}
          onChange={setDescription}
          onClose={() => setAdding(false)}
          onCreate={() => {
            void router.navigate({ to: "/manageapikeys/new", search: { description } });
          }}
        />
      ) : null}
      {deleting ? (
        <QuantityUnitDeleteDialog
          message={t(
            'Are you sure you want to delete API key "%s"?',
            deleting.description ? deleting.description : deleting.api_key,
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
      {qr ? <ApiKeyQrDialog apiKey={qr} onClose={() => setQr(undefined)} /> : null}
    </>
  );
}

function AddKeyDialog({
  value,
  onChange,
  onClose,
  onCreate,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => input.current?.focus(), 500);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Create new API key")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{t("Create new API key")}</h2>
      <label className="field">
        {t("Description")}
        <input
          ref={input}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t("Cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          {t("OK")}
        </button>
      </div>
    </dialog>
  );
}

function ApiKeyQrDialog({ apiKey, onClose }: { apiKey: NativeApiKey; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const content = apiKeyQrContent(apiKey);

  const matrix = useMemo(
    () =>
      new QRCodeWriter().encode(
        content,
        BarcodeFormat.QR_CODE,
        0,
        0,
        new Map([[EncodeHintType.CHARACTER_SET, "UTF-8"]]),
      ),
    [content],
  );

  const pixels = [];

  for (let y = 0; y < matrix.getHeight(); y += 1)
    for (let x = 0; x < matrix.getWidth(); x += 1)
      if (matrix.get(x, y))
        pixels.push(<rect key={`${x}:${y}`} x={x} y={y} width="1" height="1" />);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("API key")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{t("API key")}</h2>
      <h3>{apiKey.description}</h3>
      <svg
        role="img"
        aria-label={t("QR-Code")}
        className="qr-code"
        viewBox={`0 0 ${matrix.getWidth()} ${matrix.getHeight()}`}
        width={matrix.getWidth() * 4}
        height={matrix.getHeight() * 4}
      >
        <rect width="100%" height="100%" fill="white" />
        <g fill="black">{pixels}</g>
      </svg>
      <button className="btn" type="button" onClick={onClose}>
        {t("OK")}
      </button>
    </dialog>
  );
}
