import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { QuantityUnitConversionEditor } from "@/components/QuantityUnitConversionEditor";
import { quantityUnitSearch, type QuantityUnitSearch } from "@/lib/quantity-unit-form";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/quantityunitconversion/$conversionId")({
  validateSearch: quantityUnitSearch,
  component: ConversionRoute,
});

function ConversionRoute() {
  const { conversionId } = Route.useParams();
  const search = Route.useSearch();

  return <ConversionDocument key={conversionId} conversionId={conversionId} search={search} />;
}

function ConversionDocument({
  conversionId,
  search,
}: {
  conversionId: string;
  search: QuantityUnitSearch;
}) {
  // Native history edits change callback destinations, not the rendered read context.
  const [initialSearch] = useState(search);
  const router = useRouter();

  return (
    <QuantityUnitConversionEditor
      recordId={conversionId === "new" ? null : Number(conversionId)}
      search={initialSearch}
      onSaved={async () => {
        const raw = router.history.location.search;
        const unit = nativeQueryParameter(raw, "qu-unit");

        if (unit !== undefined) {
          if (nativeQueryParameter(raw, "embedded") !== undefined)
            window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
          else {
            const root = router
              .buildLocation({ to: "/", search: {} })
              .publicHref.replace(/\/+$/, "");

            // The source uses its raw href, including the empty unit's trailing slash.
            router.history.push(`${root}/quantityunit/${unit}`);
          }
        } else {
          window.parent.postMessage(
            { Message: "ProductQUConversionChanged", Payload: null },
            window.location.origin,
          );
          window.parent.postMessage(
            { Message: "CloseLastModal", Payload: null },
            window.location.origin,
          );
        }
      }}
    />
  );
}
