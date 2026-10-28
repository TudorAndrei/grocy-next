import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProductEditor } from "@/components/ProductEditor";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/product/$productId")({
  validateSearch: z.object({
    flow: z.coerce.string().optional().catch(undefined),
    name: z.coerce.string().optional().catch(undefined),
    barcode: z.coerce.string().optional().catch(undefined),
    returnto: z.string().optional().catch(undefined),
    "copy-of": z.coerce.number().int().positive().optional().catch(undefined),
  }),
  component: ProductFormPage,
});

function returnPath(path = "/products", productName?: string) {
  const base = "https://grocy.invalid";
  let target: URL;

  try {
    target = new URL(path, base);
  } catch {
    return "/products";
  }

  if (!path.startsWith("/") || target.origin !== base) return "/products";

  if (productName !== undefined) target.searchParams.set("product-name", productName);

  return target.pathname + target.search + target.hash;
}

function ProductFormPage() {
  const { t } = useI18n();
  const { productId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const recordId = productId === "new" ? null : Number(productId);

  return (
    <>
      <PageHeader title={t(recordId === null ? "Create product" : "Edit product")} />
      <ProductEditor
        key={productId + ":" + (search.name ?? "") + ":" + (search["copy-of"] ?? "")}
        editor={{
          recordId,
          copyOf: recordId === null ? search["copy-of"] : undefined,
          continueLabel: "Save & continue",
          allowReturn: search.flow === undefined && search.returnto === undefined,
          initialValues:
            search.flow === "InplaceNewProductWithName" ? { name: search.name ?? "" } : undefined,
          onCancel: () => {
            void navigate({ href: returnPath(search.returnto) });
          },
          onSaved: async (id, body, returnToList) => {
            if (search.returnto !== undefined) {
              await navigate({
                href: returnPath(
                  search.returnto,
                  search.flow !== undefined ? String(body.name ?? "") : undefined,
                ),
              });
            } else if (returnToList) await navigate({ href: `/products?product=${id}` });
            else
              await navigate({
                to: "/product/$productId",
                params: { productId: String(id) },
                search: {},
              });
          },
        }}
      />
    </>
  );
}
