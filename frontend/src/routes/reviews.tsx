import { useI18n } from "@/lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { PendingProposals } from "@/components/PendingProposals";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/reviews")({
  component: ReviewsPage,
});

function ReviewsPage() {
  const { t: tr } = useI18n();

  return (
    <>
      <PageHeader
        title={tr("Review")}
        lead={tr("Proposed changes wait here. Nothing becomes the record until you approve it.")}
      />
      <PendingProposals />
    </>
  );
}
