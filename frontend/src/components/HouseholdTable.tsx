import type { ReactNode } from "react";
import { daysUntil, formatDate } from "@/lib/format";
import { DueBar } from "./DueBar";

export type HouseholdRow = {
  id: number;
  name: string;
  detail?: string | null;
  due: string | null | undefined;
  dueEmpty: string;
  action: ReactNode;
};

/** Chores, tasks and batteries share one shape: name, when it is due, one action. */
export function HouseholdTable({ rows, dueLabel }: { rows: HouseholdRow[]; dueLabel: string }) {
  const sorted = [...rows].sort((a, b) => (daysUntil(a.due) ?? 9999) - (daysUntil(b.due) ?? 9999));
  return (
    <div className="panel">
      <table className="stock-table household-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">{dueLabel}</th>
            <th scope="col">Date</th>
            <th scope="col">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const days = daysUntil(row.due);
            return (
              <tr key={row.id}>
                <td className="stock-name">
                  <span className="name">{row.name}</span>
                  {row.detail ? <small>{row.detail}</small> : null}
                </td>
                <td className="level">
                  {days === null ? (
                    <span className="faint">{row.dueEmpty}</span>
                  ) : (
                    <DueBar days={days} />
                  )}
                </td>
                <td className="date">{formatDate(row.due) ?? "—"}</td>
                <td className="row-actions">{row.action}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
