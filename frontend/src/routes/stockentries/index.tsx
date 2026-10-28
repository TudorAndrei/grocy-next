import { createFileRoute } from "@tanstack/react-router";
import { StockEntries } from "@/components/StockEntries";
import { PageHeader } from "@/components/PageHeader";
import { stockEntriesSearch } from "@/lib/stock-entries";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/stockentries/")({
  validateSearch: stockEntriesSearch,
  component: EntriesPage,
});

function EntriesPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      <PageHeader title={t("Stock entries")} />
      <StockEntries
        search={search}
        onChange={(search) => {
          void navigate({ search });
        }}
      />
    </>
  );
}
