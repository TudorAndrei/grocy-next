import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryKeys } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Icon } from "@/components/Icon";
import { LoadingBlock } from "@/components/LoadingBlock";
import { NutritionPanel } from "@/components/NutritionPanel";
import { PageHeader } from "@/components/PageHeader";
import { ProposalForm } from "@/components/ProposalForm";
import { RevisionHistory } from "@/components/RevisionHistory";
import { ProductMerge } from "@/components/ProductMerge";
import { StockActions } from "@/components/StockActions";
import { StockLedger } from "@/components/StockLedger";
import { openApiDocument } from "@/lib/open-document";

type ProductSearch = { move?: "purchase" | "consume" | "open" };

export const Route = createFileRoute("/products/$productId")({
  component: ProductDetailPage,
  validateSearch: (search: Record<string, unknown>): ProductSearch => {
    const move = search.move;
    return move === "purchase" || move === "consume" || move === "open" ? { move } : {};
  },
});

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const { move } = Route.useSearch();
  const id = Number(productId);
  const catalog = useCatalog();

  const nutrition = useQuery({
    queryKey: queryKeys.nutrition(id),
    queryFn: () => api.getProductNutrition(id),
    enabled: Number.isFinite(id),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  const product = catalog.product(id);
  const nutritionMissing = nutrition.error instanceof ApiError && nutrition.error.status === 404;
  const facts = [
    catalog.location(product?.location_id)?.name,
    product ? `Stock unit ${catalog.unit(product.qu_id_stock)?.name ?? "—"}` : null,
    product?.barcode ? `Barcode ${product.barcode}` : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        back={
          <Link to="/products" className="back-link">
            <Icon name="back" />
            Products
          </Link>
        }
        title={product?.name ?? `Product #${productId}`}
        lead={facts.length ? facts.join(" · ") : product?.description}
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => openApiDocument(`/api/stock/products/${id}/printlabel`)}
          >
            Print label
          </button>
        }
      />

      <div className="detail">
        <StockActions key={move ?? "purchase"} productId={id} initialMove={move} />
        <div className="detail-side">
          {nutrition.isLoading ? <LoadingBlock label="Loading nutrition…" /> : null}
          {nutrition.isError && !nutritionMissing ? (
            <ErrorBlock message={(nutrition.error as Error).message} />
          ) : null}
          {nutritionMissing ? (
            <section className="panel">
              <h2 className="panel-head">Nutrition</h2>
              <p className="panel-empty">
                No nutrition saved yet. Propose values below, or ask your agent to read the label.
              </p>
            </section>
          ) : null}
          {nutrition.isSuccess ? <NutritionPanel data={nutrition.data} /> : null}
        </div>
      </div>

      <div className="split">
        <ProposalForm
          key={nutrition.data?.revision ?? "none"}
          productId={id}
          nutrition={nutrition.data ?? null}
        />
        <RevisionHistory productId={id} />
      </div>

      <div className="split">
        <StockLedger productId={id} />
        <ProductMerge productId={id} />
      </div>
    </>
  );
}
