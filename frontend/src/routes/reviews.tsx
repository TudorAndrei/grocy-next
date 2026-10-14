import { createFileRoute } from "@tanstack/react-router";
import { PendingProposals } from "@/components/PendingProposals";

export const Route = createFileRoute("/reviews")({
  component: ReviewsPage,
});

function ReviewsPage() {
  return (
    <>
      <h1 className="page-title">Review queue</h1>
      <p className="page-lead">
        Approve pending nutrition proposals before they become the canonical
        record for a product.
      </p>
      <PendingProposals />
    </>
  );
}
