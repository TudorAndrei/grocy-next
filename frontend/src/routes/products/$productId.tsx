import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { NutritionPanel } from "@/components/NutritionPanel";
import { ProposalForm } from "@/components/ProposalForm";
import { RevisionHistory } from "@/components/RevisionHistory";
import { StockActions } from "@/components/StockActions";

export const Route = createFileRoute("/products/$productId")({
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const id = Number(productId);

  const productsQuery = useQuery({
    queryKey: queryKeys.products,
    queryFn: () => api.listProducts(),
  });

  const nutritionQuery = useQuery({
    queryKey: queryKeys.nutrition(id),
    queryFn: () => api.getProductNutrition(id),
    enabled: Number.isFinite(id),
    retry: (_, error) => {
      if (error instanceof ApiError && error.status === 404) {
        return false;
      }
      return true;
    },
  });

  const product = productsQuery.data?.find((p) => p.id === id);
  const title = product?.name ?? `Product #${productId}`;
  const nutritionMissing =
    nutritionQuery.error instanceof ApiError && nutritionQuery.error.status === 404;

  return (
    <>
      <Link to="/products" className="back-link">
        ← Products
      </Link>
      <header className="page-header">
        <div className="page-header-copy">
          <h1 className="page-title">{title}</h1>
          <p className="page-lead">
            {product?.barcode
              ? `Barcode ${product.barcode}`
              : "Stock moves, nutrition, and staged updates for this item."}
          </p>
        </div>
      </header>

      <div className="stack">
        <StockActions productId={id} />
        {nutritionQuery.isLoading ? (
          <LoadingBlock label="Loading nutrition…" />
        ) : null}
        {nutritionQuery.isError && !nutritionMissing ? (
          <ErrorBlock
            message={
              nutritionQuery.error instanceof Error
                ? nutritionQuery.error.message
                : "Could not load nutrition."
            }
          />
        ) : null}
        {nutritionMissing ? (
          <p className="empty-state">No nutrition saved yet for this product.</p>
        ) : null}
        {nutritionQuery.isSuccess ? (
          <NutritionPanel data={nutritionQuery.data} />
        ) : null}

        <div className="split">
          <ProposalForm
            productId={id}
            nutrition={nutritionQuery.data ?? null}
          />
          <RevisionHistory productId={id} />
        </div>
      </div>
    </>
  );
}
