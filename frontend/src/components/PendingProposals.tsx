import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { Link } from "@tanstack/react-router";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function PendingProposals() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.proposalsPending,
    queryFn: () => api.listPendingProposals(),
  });

  const approve = useMutation({
    mutationFn: (id: number) => api.approveProposal(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposalsPending });
      await queryClient.invalidateQueries({ queryKey: ["nutrition"] });
      await queryClient.invalidateQueries({ queryKey: ["revisions"] });
    },
  });

  if (query.isLoading) {
    return <LoadingBlock label="Loading pending proposals…" />;
  }

  if (query.isError) {
    return (
      <ErrorBlock
        message={
          query.error instanceof Error
            ? query.error.message
            : "Could not load proposals."
        }
      />
    );
  }

  const items = query.data ?? [];

  if (items.length === 0) {
    return (
      <p className="empty-state">
        Nothing waiting for approval. Proposals appear here after submission from a
        product page.
      </p>
    );
  }

  return (
    <ul className="product-list">
      {items.map((item) => (
        <li
          key={item.id}
          className="product-row"
          style={{ gridTemplateColumns: "1fr auto auto" }}
        >
          <div>
            <h2>
              <Link
                to="/products/$productId"
                params={{ productId: String(item.product_id) }}
              >
                Product #{item.product_id}
              </Link>
            </h2>
            <p>
              Proposal #{item.id}
              {item.payload.note ? ` · ${item.payload.note}` : ""}
            </p>
            <p className="muted">
              Basis {item.payload.basis.quantity} {item.payload.basis.unit}
            </p>
          </div>
          <span className="status-pill">{item.status}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={approve.isPending}
            onClick={() => approve.mutate(item.id)}
          >
            Approve
          </button>
        </li>
      ))}
    </ul>
  );
}
