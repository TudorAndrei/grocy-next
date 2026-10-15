import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

type RevisionHistoryProps = {
  productId: number;
};

export function RevisionHistory({ productId }: RevisionHistoryProps) {
  const client = useQueryClient();
  const restore = useMutation({
    mutationFn: (revision: number) => api.restoreRevision(productId, revision),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  const query = useQuery({
    queryKey: queryKeys.revisions(productId),
    queryFn: () => api.listNutritionRevisions(productId),
  });

  if (query.isLoading) {
    return <LoadingBlock label="Loading revision history…" />;
  }

  if (query.isError) {
    return (
      <ErrorBlock
        message={
          query.error instanceof Error
            ? query.error.message
            : "Could not load revisions."
        }
      />
    );
  }

  const items = query.data ?? [];

  return (
    <section className="panel" aria-labelledby="revisions-heading">
      <div className="panel-inner">
        <h2 id="revisions-heading" className="panel-title">
          Revision history
        </h2>
        {restore.error && <ErrorBlock message={restore.error.message} />}
        {items.length === 0 ? (
          <p className="empty-state" style={{ padding: 0 }}>
            No prior revisions.
          </p>
        ) : (
          <ul className="revision-list">
            {items.map((rev) => (
              <li key={rev.id} className="revision-item">
                <header>
                  <strong>Revision {rev.revision}</strong>
                  <span className="status-pill">{rev.origin}</span>
                  <button
                    className="btn btn-ghost"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(rev.revision)}
                  >
                    Restore revision {rev.revision}
                  </button>
                </header>
                <p className="muted" style={{ margin: 0 }}>
                  Basis {rev.basis_quantity} {rev.basis_unit}
                  {rev.change_summary ? ` · ${rev.change_summary}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
