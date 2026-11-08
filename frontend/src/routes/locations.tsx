import { useNativeDocumentReload } from "@/lib/native-document";
import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { StockReferenceData } from "@/components/StockReferenceData";

export const Route = createFileRoute("/locations")({ component: ReferenceListRoute });

function ReferenceListRoute() {
  const router = useRouter();
  const reloadDocument = useNativeDocumentReload("/locations");
  const search = useLocation({ select: () => router.history.location.search });

  return (
    <StockReferenceData
      key={search}
      entity="locations"
      search={search}
      onShowDisabled={(checked) => {
        reloadDocument();
        const target = router.buildLocation({ to: "/locations", search: {} }).publicHref;
        router.history.push(target + (checked ? "?include_disabled" : ""));
      }}
    />
  );
}
