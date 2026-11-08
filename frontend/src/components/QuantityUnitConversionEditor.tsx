import { useId, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { useQuery } from "@tanstack/react-query";
import {
  getQuantityUnitConversionContext,
  type QuantityUnitSearch,
} from "@/lib/quantity-unit-form";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { userSettingsQuery } from "@/hooks/queries";
import { nativeQuantityUnit } from "@/lib/native-quantity-unit";
import type { JsonObject } from "@/lib/json";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { QuantityUnitObjectForm } from "./QuantityUnitEditor";

export function QuantityUnitConversionEditor({
  recordId,
  search,
  onSaved,
}: {
  recordId: number | null;
  search: QuantityUnitSearch;
  onSaved: (id: number, mode: string) => Promise<void> | void;
}) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const settings = useQuery(userSettingsQuery());
  const id = useId();
  const router = useRouter();

  const [initialFromLocked] = useState(
    () => nativeQueryParameter(router.history.location.search, "qu-unit") !== undefined,
  );

  const to = useRef<HTMLSelectElement>(null);
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);

  const data = useQuery({
    queryKey: ["quantity-unit-conversion-editor", recordId, search.product, search["qu-unit"]],
    queryFn: ({ signal }) => getQuantityUnitConversionContext(recordId, search, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const title = recordId === null ? "Create QU conversion" : "Edit QU conversion";
  const error = data.error || settings.error;

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void data.refetch();
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && (data.isPending || settings.isPending) ? <LoadingBlock /> : null}
      {data.data && settings.isSuccess ? (
        <>
          <p>
            {t(data.data.product ? "Override for product" : "Default for QU")}{" "}
            <strong>{data.data.product?.name ?? data.data.defaultUnit?.name}</strong>
          </p>
          <QuantityUnitObjectForm
            entity="quantity_unit_conversions"
            recordId={recordId}
            record={data.data.record}
            title={title}
            buttons={[{ mode: "save", label: "Save" }]}
            onSaved={onSaved}
            defaults={(row) => ({
              from_qu_id: row
                ? data.data.units.some((unit) => unit.id === Number(row.from_qu_id))
                  ? String(row.from_qu_id)
                  : ""
                : String(
                    data.data.units
                      .filter(
                        (unit) =>
                          unit.id === data.data.product?.qu_id_stock ||
                          unit.id === data.data.defaultUnit?.id,
                      )
                      .at(-1)?.id ?? "",
                  ),
              to_qu_id:
                row && data.data.units.some((unit) => unit.id === Number(row.to_qu_id))
                  ? String(row.to_qu_id)
                  : "",
              factor: Number(row?.factor ?? 1).toLocaleString("en", {
                maximumFractionDigits: preferences.amountPrecision,
                useGrouping: false,
              }),
            })}
            body={(values) => {
              const body: JsonObject = { ...values };

              if (data.data.product) body.product_id = String(data.data.product.id);

              return body;
            }}
            fields={(values, change, controlsRestored) => {
              const from = data.data.units.find((unit) => String(unit.id) === values.from_qu_id);
              const target = data.data.units.find((unit) => String(unit.id) === values.to_qu_id);
              const factor = Number.parseFloat(values.factor);
              const equal = values.from_qu_id === values.to_qu_id;
              const invalid = equal ? t("This cannot be equal to %s", from?.name ?? "") : "";

              return (
                <>
                  {data.data.product ? (
                    <input type="hidden" name="product_id" value={String(data.data.product.id)} />
                  ) : null}
                  <label className="field" htmlFor={`${id}-from`}>
                    {t("Quantity unit from")}
                  </label>
                  <select
                    name="from_qu_id"
                    autoFocus
                    id={`${id}-from`}
                    required
                    value={values.from_qu_id}
                    disabled={initialFromLocked && !controlsRestored}
                    onChange={(event) => {
                      change("from_qu_id", event.target.value);
                      to.current?.setCustomValidity(
                        event.target.value === values.to_qu_id
                          ? t(
                              "This cannot be equal to %s",
                              data.data.units.find((unit) => String(unit.id) === event.target.value)
                                ?.name ?? "",
                            )
                          : "",
                      );
                    }}
                  >
                    <option value="" />
                    {data.data.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                  <label className="field" htmlFor={`${id}-to`}>
                    {t("Quantity unit to")}
                  </label>
                  <select
                    name="to_qu_id"
                    ref={(element) => {
                      to.current = element;
                      element?.setCustomValidity(invalid);
                    }}
                    id={`${id}-to`}
                    required
                    value={values.to_qu_id}
                    onChange={(event) => change("to_qu_id", event.target.value)}
                  >
                    <option value="" />
                    {data.data.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                  {equal && values.to_qu_id ? <p role="status">{invalid}</p> : null}
                  <label className="field">
                    {t("Factor")}
                    <input
                      name="factor"
                      type="number"
                      required
                      min={10 ** -preferences.amountPrecision}
                      step={10 ** -preferences.amountPrecision}
                      value={values.factor}
                      onChange={(event) => change("factor", event.target.value)}
                    />
                  </label>
                  {from && target ? (
                    <>
                      <p>
                        {t(
                          "This means 1 %1$s is the same as %2$s %3$s",
                          from.name ?? "",
                          preferences.formatAmount(factor),
                          nativeQuantityUnit(target, factor, pluralIndex),
                        )}
                      </p>
                      <p>
                        {t(
                          "This means 1 %1$s is the same as %2$s %3$s",
                          target.name ?? "",
                          preferences.formatAmount(1 / factor),
                          nativeQuantityUnit(from, 1 / factor, pluralIndex),
                        )}
                      </p>
                    </>
                  ) : null}
                </>
              );
            }}
          />
        </>
      ) : null}
    </>
  );
}
