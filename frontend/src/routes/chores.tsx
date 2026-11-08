import { useNativeDocumentReload } from "@/lib/native-document";
import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { HouseholdMasterData } from "@/components/HouseholdMasterData";
import { householdMasterSearch } from "@/lib/household-master";
import { nativeQueryFlag, nativeQueryParameterPresent } from "@/lib/native-query-flag";

export const Route = createFileRoute("/chores")({
  validateSearch: householdMasterSearch,
  component: ChoresPage,
});

function ChoresPage() {
  const router = useRouter();
  const reloadDocument = useNativeDocumentReload("/chores");
  const raw = useLocation({ select: () => router.history.location.search });

  return (
    <HouseholdMasterData
      key={raw}
      entity="chores"
      includeDisabled={nativeQueryParameterPresent(raw, "include_disabled")}
      initiallyChecked={nativeQueryFlag(raw, "include_disabled")}
      onShowDisabled={(checked) => {
        reloadDocument();
        const destination = router.buildLocation({ to: "/chores", search: {} }).publicHref;
        router.history.push(destination + (checked ? "?include_disabled" : ""));
      }}
    />
  );
}
