import { useI18n } from "@/lib/i18n";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { nativeEntryPage, useFeatures } from "@/lib/features";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";

export const Route = createFileRoute("/")({ component: EntryPage });

function EntryPage() {
  const { t: tr } = useI18n();

  const features = useFeatures();

  if (features.query.isPending) return <LoadingBlock label={tr("Loading configuration…")} />;

  if (features.query.isError) return <ErrorBlock message={features.query.error.message} />;

  return <Navigate to={nativeEntryPage(features.query.data)} replace />;
}
