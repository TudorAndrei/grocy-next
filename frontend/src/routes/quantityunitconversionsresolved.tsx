import { createFileRoute } from "@tanstack/react-router";
import { ResolvedConversions } from "@/components/ResolvedConversions";
import { resolvedConversionSearch } from "@/lib/resolved-conversions";

export const Route = createFileRoute("/quantityunitconversionsresolved")({
  validateSearch: resolvedConversionSearch,
  component: Page,
});

function Page() {
  const { product } = Route.useSearch();

  return (
    <ResolvedConversions
      key={product ?? "global"}
      product={product === undefined ? undefined : String(product)}
    />
  );
}
