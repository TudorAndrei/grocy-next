import { useI18n } from "@/lib/i18n";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useFeatures } from "@/lib/features";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";

export const Route = createFileRoute("/")({ component: EntryPage });

const ENTRY_PAGES = new Map([
  ["stock", "/stock"],
  ["purchase", "/purchase"],
  ["consume", "/consume"],
  ["shoppinglist", "/shopping"],
  ["recipes", "/recipes"],
  ["chores", "/chores"],
  ["tasks", "/tasks"],
  ["batteries", "/batteries"],
  ["equipment", "/equipment"],
  ["calendar", "/calendar"],
  ["mealplan", "/meal-plan"],
]);

function EntryPage() {
  const { t: tr } = useI18n();

  const features = useFeatures();

  if (features.query.isPending) return <LoadingBlock label={tr("Loading configuration…")} />;

  if (features.query.isError) return <ErrorBlock message={features.query.error.message} />;

  return (
    <Navigate to={ENTRY_PAGES.get(String(features.query.data.ENTRY_PAGE)) ?? "/stock"} replace />
  );
}
