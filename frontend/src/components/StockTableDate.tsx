import type { tableDate } from "@/lib/native-table-cell";

export function StockTableDate({ value }: { value: ReturnType<typeof tableDate> }) {
  return (
    <>
      <span>{value.date}</span>
      {value.relative ? (
        <>
          {" "}
          <time className="stock-table-relative" dateTime={value.timestamp ?? undefined}>
            {value.relative}
          </time>
        </>
      ) : null}
    </>
  );
}
