import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import type { CardHistory } from "@/lib/product-card-memory";
import { createPriceChart } from "@/lib/price-chart";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function ProductPriceHistory({
  state,
  onRetry,
  currency,
}: {
  state: CardHistory;
  onRetry: () => void;
  currency: string;
}) {
  const { t } = useI18n();
  const preferences = usePreferences();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);

  const { rows, factor } = state;
  const unknownStore = t("Unknown store");

  useEffect(() => {
    const target = canvas.current;

    if (!rows?.length || !target) return;
    const controller = new AbortController();
    let active = true;
    let chart: Awaited<ReturnType<typeof createPriceChart>> | undefined;
    void createPriceChart(
      target,
      rows,
      factor,
      unknownStore,
      currency,
      preferences.priceDisplayPrecision,
      controller.signal,
    )
      .then((value) => {
        if (active) chart = value;
        else value.destroy();
      })
      .catch((error: Error) => {
        if (active) setError(error);
      });

    return () => {
      active = false;
      controller.abort();
      chart?.destroy();
    };
  }, [rows, factor, unknownStore, currency, preferences.priceDisplayPrecision, attempt]);

  return (
    <section className="product-price-history" aria-label={t("Price history")}>
      <h3>{t("Price history")}</h3>
      {state.pending > 0 ? <LoadingBlock /> : null}
      {state.error || error ? (
        <>
          <ErrorBlock message={(state.error ?? error)!.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError(undefined);
              setAttempt(attempt + 1);

              if (state.error) onRetry();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {rows?.length ? (
        <>
          <div className="product-price-chart">
            <canvas ref={canvas} role="img" aria-label={t("Price history")} />
          </div>
          <table className="sr-only">
            <caption>{t("Price history")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Date")}</th>
                <th scope="col">{t("Store")}</th>
                <th scope="col">{t("Price")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <th scope="row">{row.date}</th>
                  <td>{row.shopping_location?.name ?? unknownStore}</td>
                  <td>{preferences.formatCurrency(row.price * factor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : rows ? (
        <p>{t("No price history available")}</p>
      ) : null}
    </section>
  );
}
