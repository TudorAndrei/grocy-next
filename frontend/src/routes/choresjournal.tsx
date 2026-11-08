import { useNativeDocumentReload } from "@/lib/native-document";
import { createFileRoute } from "@tanstack/react-router";
import { HouseholdJournal } from "@/components/HouseholdJournal";
import { householdJournalSearch } from "@/lib/household-journal";

export const Route = createFileRoute("/choresjournal")({
  validateSearch: householdJournalSearch.passthrough(),
  component: ChoresJournalPage,
});

function ChoresJournalPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const reloadDocument = useNativeDocumentReload("/choresjournal");

  return (
    <HouseholdJournal
      key={`${search.chore}:${search.months}`}
      kind="chore"
      search={search}
      onChange={(search) => {
        reloadDocument();
        void navigate({ search });
      }}
    />
  );
}
