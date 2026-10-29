import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, queryKeys, request } from "./api";
import { userSettingsQuery } from "@/hooks/queries";
import type { UserSettings } from "./types";

export type TableColumn = {
  key: string;
  label: string;
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
) {
  const settings = useQuery(userSettingsQuery());
  const client = useQueryClient();
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

  const groupColumn = state.group?.enable
    ? columns[order[Number(state.group.dataSrc ?? 0)]]?.key
    : undefined;

  const sorts: Sort[] = layout.order.flatMap(([i, direction]) =>
    columns[i] ? [{ key: columns[i].key, descending: direction === "desc" }] : [],
  );

  const sort = sorts[0] ?? defaultSort;
  const sorters = groupColumn ? [{ key: groupColumn, descending: false }, ...sorts] : sorts;

  const visibleColumns = order.flatMap((i) =>
    columns[i]?.rendered !== false && layout.columns[i]?.visible ? [columns[i]] : [],
  );

  function updateSetting(key: string, value: string | undefined) {
    client.setQueryData<UserSettings>(queryKeys.userSettings, (current) => {
      const next = { ...current };

      if (value === undefined) delete next[key];
      else next[key] = value;

      return next;
    });
  }

  const save = useMutation({
    mutationFn: async (next: { layout: Layout; group?: Group }) => {
      const saved = readLayout(
        client.getQueryData<UserSettings>(queryKeys.userSettings)?.[stateKey],
        columns.length,
      );

      if (!saved || canonical(saved) !== canonical(next.layout)) {
        const value = JSON.stringify({ ...next.layout, time: Date.now() });
        await api.putUserSetting(stateKey, value);
        updateSetting(stateKey, value);
      }

      if (next.group) {
        const value = JSON.stringify(next.group);

        if (client.getQueryData<UserSettings>(queryKeys.userSettings)?.[groupKey] !== value) {
          await api.putUserSetting(groupKey, value);
          updateSetting(groupKey, value);
        }
      }
    },
  });

  const desired = canonical(layout);
  const desiredGroup = state.group ? JSON.stringify(state.group) : undefined;
  const saved = original ? canonical(original) : undefined;
  const mutate = save.mutate;

  const reset = useMutation({
    mutationFn: async (onReset: () => void) => {
      setResetting(true);

      if (client.getQueryData<UserSettings>(queryKeys.userSettings)?.[groupKey] !== undefined) {
        await request(`/api/user/settings/${encodeURIComponent(groupKey)}`, { method: "DELETE" });
        updateSetting(groupKey, undefined);
      }

      await request(`/api/user/settings/${encodeURIComponent(stateKey)}`, { method: "DELETE" });
      updateSetting(stateKey, undefined);
      save.reset();
      setDraft({ signature, layout: defaults });
      setCollapsed([]);
      setResetVersion((current) => current + 1);
      onReset();
    },
    onSettled: () => setResetting(false),
  });

  useEffect(() => {
    if (
      !enabled ||
      !settings.isSuccess ||
      resetting ||
      save.isPending ||
      save.isError ||
      reset.isError
    )
      return;

    if (desired !== saved || (desiredGroup && desiredGroup !== settings.data[groupKey]))
      mutate({ layout, group: state.group });
  }, [
    enabled,
    settings.isSuccess,
    settings.data,
    resetting,
    save.isPending,
    save.isError,
    reset.isError,
    desired,
    desiredGroup,
    saved,
    groupKey,
    mutate,
    layout,
    state.group,
  ]);

  function patch(next: Layout, group = state.group) {
    setDraft({ signature, layout: next, group });
    save.reset();
  }

  return {
    columns,
    visibleColumns,
    order,
    groupColumn,
    sort,
    sorters,
    resetVersion,
    reload: () => {
      setCollapsed([]);
      setResetVersion((current) => current + 1);
    },
    ready: settings.isSuccess,
    pending: save.isPending || reset.isPending,
    error: settings.error || save.error || reset.error,
    retry: () => {
      if (reset.isError && reset.variables) {
        reset.mutate(reset.variables);

        return;
      }

      save.reset();
      reset.reset();
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

      if (from < 0 || to < 0) return;
      const [column] = next.splice(from, 1);
      next.splice(to, 0, column);
      patch({ ...layout, ColReorder: next });
    },
    groupBy: (key: string) => {
      const i = columns.findIndex((c) => c.key === key);
      patch(
        layout,
        key
          ? { enable: true, dataSrc: String(columns[i]?.groupIndex ?? order.indexOf(i)) }
          : { enable: false },
      );
    },
    collapsed: (group: string) => collapsed.includes(group),
    toggleGroup: (group: string) =>
      setCollapsed((current) =>
        current.includes(group) ? current.filter((c) => c !== group) : [...current, group],
      ),
    reset: (onReset: () => void) => reset.mutateAsync(onReset),
  };
}

export type TableOptions = ReturnType<typeof useTableOptions>;
