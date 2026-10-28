import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { StockJournalSummary } from "@/components/StockJournalSummary";
import { useI18n } from "@/lib/i18n";
import { stockSummarySearch } from "@/lib/stock-journal";

export const Route = createFileRoute("/stockjournal/summary")({
  validateSearch: stockSummarySearch,
  component: SummaryPage,
});

function SummaryPage() {
  const { t } = useI18n();
  const search = Route.useSearch();

  return (
    <>
      <PageHeader title={t("Stock journal summary")} />
      <StockJournalSummary
        key={`${search.product_id}:${search.user_id}:${search.transaction_type}`}
        search={search}
      />
    </>
  );
}
