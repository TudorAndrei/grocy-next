import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { NutritionPanel } from "@/components/NutritionPanel";
import { ProposalForm } from "@/components/ProposalForm";
import { PageHeader } from "@/components/PageHeader";
import { RevisionHistory } from "@/components/RevisionHistory";
import { ProductMerge } from "@/components/ProductMerge";
import { StockActions } from "@/components/StockActions";
import { openApiDocument } from "@/lib/open-document";

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
      <Link to="/products" className="back-link">
        ← Products
      </Link>
      <PageHeader
        title={title}
        lead={
          product?.barcode
            ? `Barcode ${product.barcode}`
            : "Stock moves, nutrition, and staged updates for this item."
        }
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              openApiDocument(`/api/stock/products/${id}/printlabel`)
            }
          >
            Print label
          </button>
        }
      />

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
          <p className="empty-state">
            No nutrition saved yet for this product.
          </p>
        ) : null}
        {nutritionQuery.isSuccess ? (
          <NutritionPanel data={nutritionQuery.data} />
        ) : null}

        <ProductMerge productId={id} />
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
