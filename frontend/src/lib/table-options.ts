import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, queryKeys, request } from "./api";
import { userSettingsQuery } from "@/hooks/queries";
import type { UserSettings } from "./types";
import { nativeTableDocumentOwner, useNativeDocumentReload } from "./native-document";
import { useGenericError } from "@/hooks/useGenericError";

export type TableColumn = {
  key: string;
  label: string;
  labelIsLiteral?: boolean;
  rendered?: boolean;
  configurable?: boolean;
  groupable?: boolean;
  groupIndex?: number;
  defaultVisible?: boolean;
};

const direction = z.enum(["asc", "desc"]);
const index = z.number().int().nonnegative();

const searchState = z
  .object({
    search: z.string(),
    smart: z.boolean(),
    regex: z.boolean(),
    caseInsensitive: z.boolean(),
  })
  .passthrough();

const savedLayout = z
  .object({
    time: z.number(),
    order: z.array(z.tuple([index, direction])),
    search: searchState.optional(),
    columns: z.array(
      z.object({ visible: z.boolean(), search: searchState.optional() }).passthrough(),
    ),
    ColReorder: z.array(index).optional(),
  })
  .passthrough();

const savedGroup = z.object({
  enable: z.boolean(),
  dataSrc: z.union([index, z.string().regex(/^\d+$/)]).optional(),
});

type Group = z.infer<typeof savedGroup>;

type Layout = z.infer<typeof savedLayout>;

type Sort = { key: string; descending: boolean };

const blankSearch = { search: "", smart: true, regex: false, caseInsensitive: true };

function readLayout(value: UserSettings[string] | undefined, count: number): Layout | undefined {
  if (!value) return undefined;

  try {
    const result = savedLayout.safeParse(JSON.parse(String(value)));

    if (!result.success || !result.data.time || result.data.columns.length !== count)
      return undefined;
    const order = result.data.ColReorder;

    if (
      order &&
      (order.length !== count || new Set(order).size !== count || order.some((i) => i >= count))
    )
      return undefined;

    return result.data;
  } catch {
    return undefined;
  }
}

function readGroup(value: UserSettings[string] | undefined, count: number): Group | undefined {
  if (!value) return undefined;

  try {
    const result = savedGroup.safeParse(JSON.parse(String(value)));

    return result.success && Number(result.data.dataSrc ?? 0) < count ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function canonical(layout: Layout) {
  const { time: _time, childRows: _children, ...value } = layout;

  return JSON.stringify(value);
}

export function useTableOptions(
  tableId: string,
  columns: TableColumn[],
  defaultSort: Sort,
  enabled = true,
  defaultGroup?: string,
) {
  const settings = useQuery(userSettingsQuery());
  const client = useQueryClient();
  const genericError = useGenericError();
  const reloadDocument = useNativeDocumentReload(nativeTableDocumentOwner(tableId));
  const owner = useRef<AbortController>(undefined);
  const seen = useRef<UserSettings>(undefined);
  useEffect(() => {
    const scope = new AbortController();
    owner.current = scope;

    return () => scope.abort();
  }, []);
  const stateKey = `datatables_state_${tableId}`;
  const groupKey = `datatables_rowGroup_${tableId}`;
  const signature = columns.map((c) => c.key).join("\n");
  const original = readLayout(settings.data?.[stateKey], columns.length);
  const [createdAt] = useState(() => Date.now());

  const defaults: Layout = {
    time: createdAt,
    start: 0,
    length: 10,
    order: [
      [
        Math.max(
          0,
          columns.findIndex((c) => c.key === defaultSort.key),
        ),
        defaultSort.descending ? "desc" : "asc",
      ],
    ],
    search: blankSearch,
    columns: columns.map((c) => ({ visible: c.defaultVisible !== false, search: blankSearch })),
    ColReorder: columns.map((_, i) => i),
    select: { rows: [], columns: [], cells: [] },
    childRows: [],
  };

  const [draft, setDraft] = useState<{ signature: string; layout: Layout; group?: Group }>();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [resetting, setResetting] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [cellVersion, setCellVersion] = useState(0);
  const [drawVersion, setDrawVersion] = useState(0);
  const [drawnGroup, setDrawnGroup] = useState<{ signature: string; column?: string }>();

  const state =
    draft?.signature === signature
      ? draft
      : {
          signature,
          layout: original ?? defaults,
          group: readGroup(settings.data?.[groupKey], columns.length),
        };

  const layoutSource = JSON.stringify({
    ...state.layout,
    search: { ...(state.layout.search ?? blankSearch), search: "" },
    columns: state.layout.columns.map((c) => ({
      ...c,
      search: { ...(c.search ?? blankSearch), search: "" },
    })),
  });

  const layout = useMemo(() => savedLayout.parse(JSON.parse(layoutSource)), [layoutSource]);

  const order = layout.ColReorder ?? columns.map((_, i) => i);

  const groupSelection = state.group
    ? state.group.enable
      ? columns[order[Number(state.group.dataSrc ?? 0)]]?.key
      : undefined
    : columns.find((column) => column.key === defaultGroup)?.key;

  const groupColumn = drawnGroup?.signature === signature ? drawnGroup.column : groupSelection;

  const sorts: Sort[] = layout.order.flatMap(([i, direction]) =>
    columns[i] ? [{ key: columns[i].key, descending: direction === "desc" }] : [],
  );

  const sort = sorts[0] ?? defaultSort;
  const sorters = groupColumn ? [{ key: groupColumn, descending: false }, ...sorts] : sorts;

  const visibleColumns = order.flatMap((i) =>
    columns[i]?.rendered !== false && layout.columns[i]?.visible ? [columns[i]] : [],
  );

  const updateSetting = useCallback(
    (key: string, value: string | undefined) => {
      if (seen.current) {
        if (value === undefined) delete seen.current[key];
        else seen.current[key] = value;
      }

      client.setQueryData<UserSettings>(queryKeys.userSettings, (current) => {
        const next = { ...current };

        if (value === undefined) delete next[key];
        else next[key] = value;

        return next;
      });
    },
    [client],
  );

  const writeSetting = useCallback(
    (key: string, value: string) => {
      const scope = owner.current;

      if (!scope || scope.signal.aborted || !seen.current || seen.current[key] == value) return;
      const signal = scope.signal;

      // SaveUserSetting remembers the value before dispatch; success has no state callback.
      updateSetting(key, value);
      void request(`/api/user/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        signal,
        body: JSON.stringify({ value }),
      })
        .catch((error) => {
          if (!signal.aborted) console.error(error);
        })
        .finally(() => {
          // An independent write may have committed even when this table departed.
          void client.invalidateQueries({ queryKey: queryKeys.userSettings, refetchType: "none" });
        });
    },
    [client, updateSetting],
  );

  const desired = canonical(layout);
  const desiredGroup = state.group ? JSON.stringify(state.group) : undefined;

  async function reset(onReset: () => void) {
    const scope = owner.current;

    if (!scope || scope.signal.aborted) return;
    const signal = scope.signal;
    // state.clear() removes the saved preferences, not the living table's layout.
    // Keep that layout until a successful document replacement or a later draw.
    setDraft({ signature, layout: state.layout, group: state.group });
    setResetting(true);
    updateSetting(groupKey, undefined);
    updateSetting(stateKey, undefined);

    async function deleteSetting(key: string, reload: boolean) {
      try {
        await request(`/api/user/settings/${encodeURIComponent(key)}`, {
          method: "DELETE",
          signal,
          body: "{}",
        });
      } catch (error) {
        if (!signal.aborted && error instanceof ApiError && error.statusText)
          genericError("Error while deleting, please retry", error);

        return;
      } finally {
        // A dispatched DELETE may commit even if this document has departed.
        void client.invalidateQueries({ queryKey: queryKeys.userSettings, refetchType: "none" });
      }

      if (signal.aborted || !reload || reloadDocument()) return;
      setDraft({ signature, layout: defaults });
      setCollapsed([]);
      setDrawnGroup(undefined);
      setDrawVersion((current) => current + 1);
      setResetVersion((current) => current + 1);
      setResetting(false);
      onReset();
    }

    // Native Reset starts both requests even when neither preference is cached.
    // Only state deletion owns the reload; group settlement is independent.
    void deleteSetting(groupKey, false);
    await deleteSetting(stateKey, true);
  }

  useEffect(() => {
    if (!enabled || !settings.isSuccess || resetting) return;

    // Hydrate only from a successful read. Later responses cannot backdate this
    // living table's remembered writes or cause an unchanged failed PUT to replay.
    seen.current ??= { ...settings.data };

    if (desiredGroup) writeSetting(groupKey, desiredGroup);
    const saved = readLayout(seen.current[stateKey], columns.length);

    if (!saved || desired !== canonical(saved))
      writeSetting(stateKey, JSON.stringify({ ...layout, time: Date.now() }));
  }, [
    enabled,
    settings.isSuccess,
    settings.data,
    resetting,
    desired,
    desiredGroup,
    groupKey,
    stateKey,
    columns.length,
    writeSetting,
    layout,
  ]);

  function patch(next: Layout, group = state.group) {
    setDraft({ signature, layout: next, group });
    setResetting(false);
  }

  return {
    columns,
    visibleColumns,
    order,
    groupColumn,
    groupSelection,
    cellVersion,
    drawVersion,
    sort,
    sorters,
    resetVersion,
    reload: () => {
      setCollapsed([]);
      setDrawnGroup(undefined);
      setDrawVersion((current) => current + 1);
      setResetVersion((current) => current + 1);
    },
    draw: () => {
      setResetting(false);
      setDrawnGroup(undefined);
      setDrawVersion((current) => current + 1);
    },
    ready: settings.isSuccess,
    error: settings.error,
    retry: () => {
      void settings.refetch();
    },
    visible: (key: string) =>
      layout.columns[columns.findIndex((c) => c.key === key)]?.visible ?? false,
    show: (key: string, visible: boolean) =>
      patch({
        ...layout,
        columns: layout.columns.map((c, i) => (columns[i]?.key === key ? { ...c, visible } : c)),
      }),
    sortBy: (key: string, multiple: boolean) => {
      setDrawnGroup(undefined);
      setDrawVersion((current) => current + 1);
      const i = columns.findIndex((c) => c.key === key);
      const existing = layout.order.find(([column]) => column === i);
      const next: [number, "asc" | "desc"] = [i, existing?.[1] === "asc" ? "desc" : "asc"];
      patch({
        ...layout,
        order: multiple ? [...layout.order.filter(([column]) => column !== i), next] : [next],
      });
    },
    move: (key: string, target: string) => {
      const next = [...order];
      const from = next.indexOf(columns.findIndex((c) => c.key === key));
      const to = next.indexOf(columns.findIndex((c) => c.key === target));

      if (from < 0 || to < 0 || from === to) return;
      const [column] = next.splice(from, 1);
      next.splice(to, 0, column);
      setDrawnGroup({ signature, column: groupColumn });
      setCellVersion((current) => current + 1);
      patch({ ...layout, ColReorder: next });
    },
    groupBy: (key: string) => {
      const i = columns.findIndex((c) => c.key === key);

      const group: Group = key
        ? { enable: true, dataSrc: String(columns[i]?.groupIndex ?? order.indexOf(i)) }
        : { enable: false };

      // The native group handler persists its preference before drawing/state-save.
      if (enabled && settings.isSuccess) writeSetting(groupKey, JSON.stringify(group));
      setDrawnGroup(undefined);
      setDrawVersion((current) => current + 1);
      patch(layout, group);
    },
    collapsed: (group: string) => collapsed.includes(group),
    toggleGroup: (group: string) => {
      setResetting(false);
      setDrawnGroup(undefined);
      setDrawVersion((current) => current + 1);
      setCollapsed((current) =>
        current.includes(group) ? current.filter((c) => c !== group) : [...current, group],
      );
    },
    reset,
  };
}

export type TableOptions = ReturnType<typeof useTableOptions>;
