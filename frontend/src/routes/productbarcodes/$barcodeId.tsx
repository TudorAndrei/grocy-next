import { createFileRoute } from "@tanstack/react-router";
import { ProductBarcodeEditor } from "@/components/ProductBarcodeEditor";
import { productBarcodeSearch } from "@/lib/product-barcode-form";

export const Route = createFileRoute("/productbarcodes/$barcodeId")({
  validateSearch: productBarcodeSearch,
  component: BarcodeFormPage,
});

function BarcodeFormPage() {
  const { barcodeId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <ProductBarcodeEditor
      key={`${barcodeId}:${search.product ?? ""}`}
      recordId={barcodeId === "new" ? null : Number(barcodeId)}
      productId={Number(search.product)}
    />
  );
}
