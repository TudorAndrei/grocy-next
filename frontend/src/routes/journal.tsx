import { createFileRoute } from "@tanstack/react-router";
import { StockJournal } from "@/components/StockJournal";
import { PageHeader } from "@/components/PageHeader";
import { stockJournalSearch } from "@/lib/stock-journal";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/journal")({
  validateSearch: stockJournalSearch,
  component: JournalPage,
});

function JournalPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      <PageHeader title={t("Stock journal")} />
      <StockJournal
        key={`${search.product}:${search.months}`}
        search={search}
        onChange={(search) => {
          void navigate({ search });
        }}
      />
    </>
  );
}
