import { useI18n } from "@/lib/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function RevisionHistory({ productId }: { productId: number }) {
  const { t: tr } = useI18n();

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
        {tr("Revision history")}
        <span>{items.length ? tr("%s saved", String(items.length)) : ""}</span>
      </h2>
      {query.isLoading ? <LoadingBlock label={tr("Loading revisions…")} /> : null}
      {query.isError ? <ErrorBlock message={query.error.message} /> : null}
      {restore.error ? <ErrorBlock message={restore.error.message} /> : null}
      {query.isSuccess && items.length === 0 ? (
        <p className="panel-empty">
          {tr("No revisions yet. The first approved proposal becomes revision 1.")}
        </p>
      ) : null}
      <ol className="revisions">
        {items.map((rev) => (
          <li key={rev.id}>
            <span className="rev-no">
              {tr("r")}
              {rev.revision}
            </span>
            <span className="rev-what">
              {tr("Per")} {rev.basis_quantity} {rev.basis_unit}
              {rev.nutrients.energy_kcal != null
                ? tr(" · %s kcal", String(rev.nutrients.energy_kcal))
                : ""}
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
              aria-label={tr("Restore revision %s", String(rev.revision))}
            >
              {tr("Restore")}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
