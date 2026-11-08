import { useNativeDocumentReload } from "@/lib/native-document";
import { createFileRoute } from "@tanstack/react-router";
import { StockJournal } from "@/components/StockJournal";
import { PageHeader } from "@/components/PageHeader";
import { stockJournalSearch } from "@/lib/stock-journal";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/stockjournal/")({
  validateSearch: stockJournalSearch,
  component: JournalPage,
});

function JournalPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const reloadDocument = useNativeDocumentReload("/stockjournal");

  return (
    <>
      <PageHeader title={t("Stock journal")} />
      <StockJournal
        key={`${search.product}:${search.months}`}
        search={search}
        onChange={(search) => {
          reloadDocument();
          void navigate({ search });
        }}
      />
    </>
  );
}
