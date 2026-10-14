import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function PendingProposals() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.proposalsPending,
    queryFn: () => api.listPendingProposals(),
  });
  const productsQuery = useQuery({
    queryKey: queryKeys.products,
    queryFn: () => api.listProducts(),
  });

  const productNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, product.name);
    }
    return map;
  }, [productsQuery.data]);

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
    <section className="panel">
      <div className="panel-inner" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Proposal</th>
              <th>Basis</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link
                    to="/products/$productId"
                    params={{ productId: String(item.product_id) }}
                    className="row-link"
                  >
                    {productNames.get(item.product_id) ?? `Product #${item.product_id}`}
                  </Link>
                </td>
                <td className="muted">
                  #{item.id}
                  {item.payload.note ? ` · ${item.payload.note}` : ""}
                </td>
                <td className="muted">
                  {item.payload.basis.quantity} {item.payload.basis.unit}
                </td>
                <td>
                  <span className="badge badge-warn">{item.status}</span>
                </td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(item.id)}
                    >
                      Approve
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
