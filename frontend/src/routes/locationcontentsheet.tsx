import { useState } from "react";
import { flushSync } from "react-dom";
import moment from "moment/min/moment-with-locales.js";
import { sprintf } from "sprintf-js";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { userSettingsQuery } from "@/hooks/queries";
import {
  getLocationSheet,
  locationSheetSearch,
  type LocationSheetSearch,
} from "@/lib/location-sheet";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import "@/styles/location-sheet.css";

export const Route = createFileRoute("/locationcontentsheet")({
  validateSearch: locationSheetSearch,
  component: LocationSheetPage,
});

function LocationSheetPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <LocationSheet
      key={JSON.stringify(search)}
      search={search}
      onChange={(search) => void navigate({ search })}
    />
  );
}

function LocationSheet({
  search,
  onChange,
}: {
  search: LocationSheetSearch;
  onChange: (search: LocationSheetSearch) => void;
}) {
  const { t, pluralIndex, ready: translationsReady } = useI18n();
  const preferences = usePreferences();
  const settings = useQuery(userSettingsQuery());
  const [printing, setPrinting] = useState<{ location?: number; timestamp: string }>();

  const report = useQuery({
    queryKey: ["stock", "location-content-sheet", search],
    queryFn: ({ signal }) => getLocationSheet(search, signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const ready = report.isSuccess && !settings.isPending && translationsReady;
  const error = report.error || settings.error;

  function print(location?: number) {
    const requested = t("moment_locale");
    const locale = moment.locales().includes(requested) ? requested : "en";
    flushSync(() => setPrinting({ location, timestamp: moment().locale(locale).format("l LT") }));
    window.print();
  }

  return (
    <div className="location-sheet">
      <div className="location-sheet-controls">
        <PageHeader
          title={t("Location Content Sheet")}
          lead={t(
            "Here you can print a page per location with the current stock, maybe to hang it there and note the consumed things on it",
          )}
          actions={
            <button
              type="button"
              className="btn"
              disabled={!ready || !!error}
              onClick={() => print()}
            >
              {t("Print")} ({t("all locations")})
            </button>
          }
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!search.include_out_of_stock}
            onChange={(event) =>
              onChange({
                ...search,
                include_out_of_stock: event.target.checked ? undefined : "true",
              })
            }
          />
          {t("Show only in stock products")}
        </label>
        <p className="muted">
          {t("Out of stock items will be shown at the products default location")}
        </p>
        {!ready && !error ? <LoadingBlock /> : null}
        {error ? (
          <>
            <ErrorBlock message={error.message} />
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (report.isError) void report.refetch();

                if (settings.isError) void settings.refetch();
              }}
            >
              {t("Retry")}
            </button>
          </>
        ) : null}
      </div>
      {ready && !error
        ? report.data.locations.map((location) => (
            <section
              key={location.id}
              className="location-sheet-page"
              aria-label={location.name ?? ""}
              data-print-selected={
                printing?.location === undefined || printing.location === location.id
              }
              data-print-single={printing?.location === location.id}
            >
              <img
                src={`${import.meta.env.BASE_URL.replace(/\/+$/, "")}/vendor/grocy/logo.svg`}
                alt="Grocy"
                width="114"
                height="30"
                className="location-sheet-logo"
              />
              <div className="location-sheet-heading">
                <h2>{location.name}</h2>
                <button
                  type="button"
                  className="btn location-sheet-controls"
                  onClick={() => print(location.id)}
                >
                  {t("Print")} ({t("this location")})
                </button>
              </div>
              <p className="location-sheet-timestamp">
                {t("Time of printing")}: {printing?.timestamp}
              </p>
              <table className="data-table location-sheet-table">
                <caption className="sr-only">{location.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Product")}</th>
                    <th scope="col">{t("Amount")}</th>
                    <th scope="col">
                      {t("Consumed amount")} / {t("Notes")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {location.products.map((product) => (
                    <tr key={product.id}>
                      <th scope="row">{product.name}</th>
                      <td>
                        {product.amount.toLocaleString(undefined, {
                          maximumFractionDigits: preferences.amountPrecision,
                        })}{" "}
                        {sprintf(
                          unitLabel(
                            {
                              name: product.unit_name ?? "",
                              name_plural: product.unit_name_plural,
                              plural_forms: product.unit_plural_forms,
                              active: product.unit_active ?? 0,
                            },
                            product.amount,
                            pluralIndex,
                            false,
                          ),
                          product.amount,
                        )}
                        {product.amount_opened > 0 ? (
                          <small> {t("%s opened", String(product.amount_opened))}</small>
                        ) : null}
                      </td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))
        : null}
    </div>
  );
}
