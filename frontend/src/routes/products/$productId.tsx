import { useI18n } from "@/lib/i18n";
import { z } from "zod";
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
import { useFeatures } from "@/lib/features";
import { EntityPicture } from "@/components/EntityPicture";

type ProductSearch = { move?: "purchase" | "consume" | "open" };

const productSearchSchema = z.object({
  move: z.enum(["purchase", "consume", "open"]).optional().catch(undefined),
});

export const Route = createFileRoute("/products/$productId")({
  component: ProductDetailPage,
  validateSearch: (search): ProductSearch => productSearchSchema.parse(search),
});

function ProductDetailPage() {
  const { t: tr } = useI18n();

  const features = useFeatures();
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
    features.enabled("STOCK_LOCATION_TRACKING")
      ? catalog.location(product?.location_id)?.name
      : null,
    product ? `Stock unit ${catalog.unit(product.qu_id_stock)?.name ?? "—"}` : null,
    product?.barcode ? `Barcode ${product.barcode}` : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        back={
          <Link to="/products" className="back-link">
            <Icon name="back" />
            {tr("Products")}
          </Link>
        }
        title={product?.name ?? tr("Product #%s", String(productId))}
        lead={facts.length ? facts.join(" · ") : product?.description}
        actions={
          features.enabled("LABEL_PRINTER") ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => openApiDocument(`/api/stock/products/${id}/printlabel`)}
            >
              {tr("Print label")}
            </button>
          ) : null
        }
      />

      <div className="detail">
        <StockActions key={move ?? "purchase"} productId={id} initialMove={move} />
        <div className="detail-side">
          {product?.picture_file_name ? (
            <EntityPicture
              group="productpictures"
              source={product.picture_file_name}
              label={tr("%s picture", String(product.name))}
            />
          ) : null}
          {nutrition.isLoading ? <LoadingBlock label={tr("Loading nutrition…")} /> : null}
          {nutrition.isError && !nutritionMissing ? (
            <ErrorBlock message={nutrition.error.message} />
          ) : null}
          {nutritionMissing ? (
            <section className="panel">
              <h2 className="panel-head">{tr("Nutrition")}</h2>
              <p className="panel-empty">
                {tr(
                  "No nutrition saved yet. Propose values below, or ask your agent to read the label.",
                )}
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
