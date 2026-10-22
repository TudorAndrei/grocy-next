import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { objectsQuery } from "@/hooks/queries";
import { formatAmount } from "@/lib/format";
import { request } from "@/lib/api";

export const Route = createFileRoute("/locations")({
  component: LocationsPage,
});

type LocationEntry = {
  product_id: number;
  amount: number;
  best_before_date: string | null;
  open: number;
};

function LocationsPage() {
  const [locationId, setLocationId] = useState<number>(0);
  const locations = useQuery(objectsQuery("locations"));
  const products = useQuery(objectsQuery("products"));
  const entries = useQuery({
    queryKey: ["stock", "location", locationId],
    queryFn: () =>
      request<LocationEntry[]>(`/api/stock/locations/${locationId}/entries`),
    enabled: locationId > 0,
  });

  const productName = (id: number) =>
    products.data?.find((p) => p.id === id)?.name ?? `Product #${id}`;

  const error = locations.error || products.error || entries.error;

  return (
    <>
      <PageHeader
        title="Stock by location"
        lead="See which products sit in each storage location, including opened amounts."
      />
      <div className="field" style={{ maxWidth: "20rem" }}>
        <label htmlFor="location-pick">Location</label>
        <select
          id="location-pick"
          value={locationId || ""}
          onChange={(e) => setLocationId(Number(e.target.value))}
        >
          <option value="">Choose a location</option>
          {(locations.data ?? []).map((loc) => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
      </div>
      {error ? <ErrorBlock message={error.message} /> : null}
      {locationId > 0 && entries.isLoading ? (
        <LoadingBlock label="Loading entries…" />
      ) : null}
      {locationId > 0 && entries.isSuccess && entries.data.length === 0 ? (
        <p className="empty-state">No stock in this location.</p>
      ) : null}
      {locationId > 0 && entries.isSuccess && entries.data.length > 0 ? (
        <section className="panel">
          <div className="panel-inner" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Amount</th>
                  <th>Opened</th>
                  <th>Best before</th>
                </tr>
              </thead>
              <tbody>
                {entries.data.map((row, index) => (
                  <tr key={`${row.product_id}-${index}`}>
                    <td>
                      <Link
                        to="/products/$productId"
                        params={{ productId: String(row.product_id) }}
                        className="row-link"
                      >
                        {productName(row.product_id)}
                      </Link>
                    </td>
                    <td className="amount-cell">{formatAmount(row.amount)}</td>
                    <td className="muted">{formatAmount(row.open)}</td>
                    <td className="muted">{row.best_before_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
