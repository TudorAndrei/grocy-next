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
        title="Review queue"
        lead="Approve pending nutrition proposals before they become the canonical record."
      />
      <PendingProposals />
    </>
  );
}
