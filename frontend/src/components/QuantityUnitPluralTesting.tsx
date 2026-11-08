import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQuantityUnits } from "@/lib/quantity-unit-form";
import { nativeQuantityUnit } from "@/lib/native-quantity-unit";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";

export function QuantityUnitPluralTesting({ initialUnit = "" }: { initialUnit?: string }) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const [unit, setUnit] = useState(initialUnit);
  const [amount, setAmount] = useState("1");
  const [result, setResult] = useState<string>();

  const data = useQuery({
    queryKey: ["quantity-units"],
    queryFn: ({ signal }) => getQuantityUnits(signal),
    refetchOnWindowFocus: false,
  });

  const selected = data.data?.find((row) => row.active === 1 && String(row.id) === unit);

  const current =
    selected && amount ? nativeQuantityUnit(selected, Number(amount), pluralIndex) : undefined;

  if (current !== undefined && current !== result) setResult(current);

  return (
    <>
      <PageHeader title={t("Quantity unit plural form testing")} />
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button type="button" className="btn" onClick={() => void data.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      {data.isPending ? <LoadingBlock /> : null}
      {data.data ? (
        <>
          <div className="move-form household-editor">
            <label className="field">
              {t("Quantity unit")}
              <select value={unit} onChange={(event) => setUnit(event.target.value)}>
                <option value="" />
                {data.data
                  .filter((row) => row.active === 1)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              {t("Amount")}
              <input
                autoFocus
                type="number"
                min={0}
                step={10 ** -preferences.amountPrecision}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          </div>
          <h2>
            {t("Result")}: <span>{result}</span>
          </h2>
        </>
      ) : null}
    </>
  );
}
