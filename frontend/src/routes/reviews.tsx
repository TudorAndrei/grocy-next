import { createFileRoute } from "@tanstack/react-router";
import { PendingProposals } from "@/components/PendingProposals";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/reviews")({
  component: ReviewsPage,
});

function ReviewsPage() {
  return (
    <>
      <PageHeader
        title="Review"
        lead="Proposed changes wait here. Nothing becomes the record until you approve it."
      />
      <PendingProposals />
    </>
  );
}
