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
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const product = productsQuery.data?.find((p) => p.id === id);
  const title = product?.name ?? `Product #${productId}`;
  const nutritionMissing =
    nutritionQuery.error instanceof ApiError &&
    nutritionQuery.error.status === 404;

  return (
    <>
      <p className="muted" style={{ marginBottom: "0.5rem" }}>
        <Link to="/products">← Back to pantry</Link>
      </p>
      <h1 className="page-title">{title}</h1>
      {product?.barcode ? (
        <p className="page-lead">Barcode {product.barcode}</p>
      ) : (
        <p className="page-lead">
          Nutrition details and staged updates for this item.
        </p>
      )}

      <div className="stack" style={{ marginTop: "1.5rem" }}>
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
          <p className="empty-state">
            No nutrition saved yet for this product.
          </p>
        ) : null}
        {nutritionQuery.isSuccess ? (
          <NutritionPanel data={nutritionQuery.data} />
        ) : null}

        <div className="split">
          <ProposalForm
            key={`${id}-${nutritionQuery.data?.revision ?? 0}`}
            productId={id}
            nutrition={nutritionQuery.data ?? null}
          />
          <RevisionHistory productId={id} />
        </div>
      </div>
    </>
  );
}
