import { useNativeDocumentReload } from "@/lib/native-document";
import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { QuantityUnitsPage } from "@/components/QuantityUnitsPage";
import { quantityUnitSearch } from "@/lib/quantity-unit-form";
import { nativeQueryFlag, nativeQueryParameterPresent } from "@/lib/native-query-flag";

export const Route = createFileRoute("/quantityunits")({
  validateSearch: quantityUnitSearch,
  component: UnitsRoute,
});

function UnitsRoute() {
  const router = useRouter();
  const reloadDocument = useNativeDocumentReload("/quantityunits");
  const raw = useLocation({ select: () => router.history.location.search });

  return (
    <QuantityUnitsPage
      key={raw}
      includeDisabled={nativeQueryParameterPresent(raw, "include_disabled")}
      initiallyChecked={nativeQueryFlag(raw, "include_disabled")}
      onShowDisabled={(checked) => {
        reloadDocument();
        const url = router.buildLocation({ to: "/quantityunits", search: {} }).publicHref;
        router.history.push(url + (checked ? "?include_disabled" : ""));
      }}
    />
  );
}
