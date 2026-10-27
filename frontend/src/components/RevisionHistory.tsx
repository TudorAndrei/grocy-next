import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function RevisionHistory({ productId }: { productId: number }) {
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
  const items = [...(query.data ?? [])].sort((a, b) => b.revision - a.revision);

  return (
    <section className="panel" aria-labelledby="revisions-heading">
      <h2 className="panel-head" id="revisions-heading">
        Revision history
        <span>{items.length ? `${items.length} saved` : ""}</span>
      </h2>
      {query.isLoading ? <LoadingBlock label="Loading revisions…" /> : null}
      {query.isError ? <ErrorBlock message={(query.error as Error).message} /> : null}
      {restore.error ? <ErrorBlock message={restore.error.message} /> : null}
      {query.isSuccess && items.length === 0 ? (
        <p className="panel-empty">
          No revisions yet. The first approved proposal becomes revision 1.
        </p>
      ) : null}
      <ol className="revisions">
        {items.map((rev) => (
          <li key={rev.id}>
            <span className="rev-no">r{rev.revision}</span>
            <span className="rev-what">
              Per {rev.basis_quantity} {rev.basis_unit}
              {rev.nutrients.energy_kcal != null ? ` · ${rev.nutrients.energy_kcal} kcal` : ""}
              {rev.change_summary ? <small>{rev.change_summary}</small> : null}
            </span>
            <span className="tag" data-domain={rev.origin === "web" ? undefined : "agent"}>
              {rev.origin}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={restore.isPending}
              onClick={() => restore.mutate(rev.revision)}
              aria-label={`Restore revision ${rev.revision}`}
            >
              Restore
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
