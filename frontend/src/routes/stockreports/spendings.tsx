import { createFileRoute } from "@tanstack/react-router";
import { SpendingsReport } from "@/components/SpendingsReport";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";
import { spendingsSearch } from "@/lib/spendings";

export const Route = createFileRoute("/stockreports/spendings")({
  validateSearch: spendingsSearch,
  component: SpendingsPage,
});

function SpendingsPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      <PageHeader title={`${t("Stock report")} / ${t("Spendings")}`} />
      <SpendingsReport
        key={JSON.stringify(search)}
        search={search}
        onChange={(search) => void navigate({ search })}
      />
    </>
  );
}
