import { useState } from "react";

type TableSnapshot<Value> = { value: Value; version: number; at: number };

export function useTableSnapshot<Value>(
  value: Value | undefined,
  ready: boolean,
  version: number,
  at: number,
) {
  const [saved, setSaved] = useState<TableSnapshot<Value>>();

  if (ready && value !== undefined && saved?.version !== version) {
    const next = { value, version, at };
    setSaved(next);

    return next;
  }

  return saved?.version === version ? saved : undefined;
}
