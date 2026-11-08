import { useNativeDocumentReload } from "@/lib/native-document";
import { createFileRoute } from "@tanstack/react-router";
import { HouseholdJournal } from "@/components/HouseholdJournal";
import { householdJournalSearch } from "@/lib/household-journal";

export const Route = createFileRoute("/batteriesjournal")({
  validateSearch: householdJournalSearch.passthrough(),
  component: BatteriesJournalPage,
});

function BatteriesJournalPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const reloadDocument = useNativeDocumentReload("/batteriesjournal");

  return (
    <HouseholdJournal
      key={`${search.battery}:${search.months}`}
      kind="battery"
      search={search}
      onChange={(search) => {
        reloadDocument();
        void navigate({ search });
      }}
    />
  );
}
