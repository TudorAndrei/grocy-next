import { createFileRoute } from "@tanstack/react-router";
import { ErrorBlock } from "@/components/ErrorBlock";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/mealplansection/")({ component: Page });

function Page() {
  const { t } = useI18n();

  return <ErrorBlock message={t("Object not found")} />;
}
