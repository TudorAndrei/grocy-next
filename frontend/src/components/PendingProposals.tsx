import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, queryKeys } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { NUTRIENTS, formatNutrient } from "@/lib/nutrients";
import type { NutritionProposal } from "@/lib/types";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

export function PendingProposals() {
  const query = useQuery({
    queryKey: queryKeys.proposalsPending,
    queryFn: api.listPendingProposals,
  });

  if (query.isLoading) return <LoadingBlock label="Loading proposals…" />;
  if (query.isError) return <ErrorBlock message={(query.error as Error).message} />;

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <p className="empty-state">
        Nothing waiting. Proposals from your agent, or from a product page, appear here before they
        change the record.
      </p>
    );
  }

  return (
    <ul className="proposals">
      {items.map((item) => (
        <ProposalCard key={item.id} proposal={item} />
      ))}
    </ul>
  );
}

function ProposalCard({ proposal }: { proposal: NutritionProposal }) {
  const catalog = useCatalog();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: queryKeys.nutrition(proposal.product_id),
    queryFn: () => api.getProductNutrition(proposal.product_id),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  const settle = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.proposalsPending }),
      queryClient.invalidateQueries({ queryKey: ["nutrition"] }),
      queryClient.invalidateQueries({ queryKey: ["revisions"] }),
    ]);
  };
  const name = catalog.productName(proposal.product_id);

  const approve = useMutation({
    mutationFn: () => api.approveProposal(proposal.id),
    onSuccess: async () => {
      await settle();
      notify({ message: `Approved nutrition for ${name}` });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });
  const reject = useMutation({
    mutationFn: () => api.rejectProposal(proposal.id),
    onSuccess: async () => {
      await settle();
      notify({ message: `Rejected proposal for ${name}` });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const proposed = proposal.payload.nutrients;
  const before = current.data?.nutrients ?? {};
  const rows = NUTRIENTS.filter((n) => proposed[n.key] != null || before[n.key] != null);
  const fromAgent = proposal.payload.origin !== "web";
  const busy = approve.isPending || reject.isPending;

  return (
    <li className="panel proposal">
      <header className="proposal-head">
        <span className="tag" data-domain={fromAgent ? "agent" : undefined}>
          {fromAgent ? "Agent" : "Web"}
        </span>
        <h2>
          <Link to="/products/$productId" params={{ productId: String(proposal.product_id) }}>
            {name}
          </Link>
        </h2>
        <span className="proposal-meta">
          #{proposal.id} · per {proposal.payload.basis.quantity} {proposal.payload.basis.unit}
          {current.data ? ` · replaces revision ${current.data.revision}` : " · first record"}
        </span>
      </header>
      {proposal.conflict_reason ? (
        <p className="proposal-conflict" role="alert">
          {proposal.conflict_reason}
        </p>
      ) : null}
      {proposal.payload.note ? <p className="proposal-note">“{proposal.payload.note}”</p> : null}
      <table className="diff-table">
        <thead>
          <tr>
            <th scope="col">Nutrient</th>
            <th scope="col" className="num">
              Now
            </th>
            <th scope="col" className="num">
              Proposed
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => {
            const changed = (before[n.key] ?? null) !== (proposed[n.key] ?? null);
            return (
              <tr key={n.key} data-changed={changed ? "true" : undefined}>
                <th scope="row" data-indent={n.indent ? "true" : undefined}>
                  {n.label}
                </th>
                <td className="num">{formatNutrient(before[n.key], n.unit)}</td>
                <td className="num">{formatNutrient(proposed[n.key], n.unit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <footer className="proposal-actions">
        <button
          type="button"
          className="btn btn-danger-quiet"
          disabled={busy}
          onClick={() => reject.mutate()}
        >
          Reject
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => approve.mutate()}
        >
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
      </footer>
    </li>
  );
}
