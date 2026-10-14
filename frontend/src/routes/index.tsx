import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
export const Route = createFileRoute("/")({ component: TodayPage });
type Stock = {
  product_id: number;
  amount: number;
  best_before_date: string | null;
  product: { name: string };
};
function TodayPage() {
  const stock = useQuery({
    queryKey: ["stock-overview"],
    queryFn: () => request<Stock[]>("/api/stock"),
  });
  const due = useQuery({
    queryKey: ["stock-volatile"],
    queryFn: () =>
      request<{
        due_products: Stock[];
        overdue_products: Stock[];
        expired_products: Stock[];
        missing_products: {
          id: number;
          name: string;
          amount_missing: number;
        }[];
      }>("/api/stock/volatile"),
  });
  const error = stock.error || due.error;
  return (
    <>
      <h1 className="page-title">Your pantry today</h1>
      <p className="page-lead">
        Check stock and expiry dates before you shop or plan a meal.
      </p>
      {error && <ErrorBlock message={error.message} />}
      {stock.isPending && <LoadingBlock label="Loading pantry..." />}
      <div className="split">
        <section>
          <h2>Current stock</h2>
          <ul className="product-list">
            {stock.data?.map((row) => (
              <li key={row.product_id}>
                <Link
                  to="/products/$productId"
                  params={{ productId: String(row.product_id) }}
                  className="product-row"
                >
                  <div>
                    <h3>{row.product.name}</h3>
                    {row.best_before_date && (
                      <p>Best before {row.best_before_date}</p>
                    )}
                  </div>
                  <span>{row.amount}</span>
                </Link>
              </li>
            ))}
          </ul>
          {stock.isSuccess && !stock.data.length && (
            <p className="empty-state">
              No stock yet. <Link to="/products">Open the catalog</Link> to add
              products and record purchases.
            </p>
          )}
        </section>
        <section>
          <h2>Low stock</h2>
          <ul className="product-list">
            {due.data?.missing_products.map((row) => (
              <li key={row.id}>
                <Link
                  to="/products/$productId"
                  params={{ productId: String(row.id) }}
                  className="product-row"
                >
                  <span>{row.name}</span>
                  <span>Need {row.amount_missing}</span>
                </Link>
              </li>
            ))}
          </ul>
          <h2>Due soon</h2>
          <ul className="product-list">
            {due.data?.due_products.map((row) => (
              <li key={row.product_id} className="product-row">
                <Link
                  to="/products/$productId"
                  params={{ productId: String(row.product_id) }}
                >
                  {row.product.name}
                </Link>
                <span>{row.best_before_date}</span>
              </li>
            ))}
          </ul>
          {due.isSuccess && !due.data.due_products.length && (
            <p className="muted">No products due soon.</p>
          )}
          {!!due.data?.overdue_products.length && (
            <p role="status">
              {due.data.overdue_products.length} products are past their best
              before date.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
