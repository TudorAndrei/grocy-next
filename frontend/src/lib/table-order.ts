import { useState } from "react";
import { compareNativeCells, type NativeTableCell, type NativeTableRow } from "./native-table-cell";
import type { TableOptions } from "./table-options";

type TableRecord<Row> = { key: string; row: Row; cells: NativeTableRow };

type OrderSnapshot = { signature: string; resetVersion: number; keys: string[] };

const blank: NativeTableCell = { kind: "text", html: "", search: "", order: "" };

export function useTableOrder<Row>(
  source: TableRecord<Row>[],
  options: Pick<TableOptions, "sorters" | "ready" | "resetVersion">,
  enabled = true,
): Row[] {
  const [snapshot, setSnapshot] = useState<OrderSnapshot>({
    signature: "",
    resetVersion: -1,
    keys: [],
  });

  const signature = JSON.stringify([
    options.resetVersion,
    options.sorters,
    source.map(({ key, cells }) => [
      key,
      options.sorters.map((sort) => {
        const cell = cells[sort.key] ?? blank;

        return [cell.kind, String(cell.order)];
      }),
    ]),
  ]);

  const byKey = new Map(source.map((record) => [record.key, record]));
  const previous = snapshot.resetVersion === options.resetVersion ? snapshot.keys : [];
  const seen = new Set(previous);

  const ordered = previous.flatMap((key) => {
    const record = byKey.get(key);

    return record ? [record] : [];
  });

  for (const record of source) if (!seen.has(record.key)) ordered.push(record);

  if (options.ready && enabled && snapshot.signature !== signature) {
    // DataTables sorts its complete master list. Equal values keep their prior positions.
    ordered.sort((left, right) => {
      for (const sort of options.sorters) {
        const comparison = compareNativeCells(
          left.cells[sort.key] ?? blank,
          right.cells[sort.key] ?? blank,
        );

        if (comparison) return sort.descending ? -comparison : comparison;
      }

      return 0;
    });
    setSnapshot({
      signature,
      resetVersion: options.resetVersion,
      keys: ordered.map((record) => record.key),
    });
  }

  return ordered.map((record) => record.row);
}
