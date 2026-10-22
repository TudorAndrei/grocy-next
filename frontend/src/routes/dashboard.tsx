import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  batteriesQuery,
  choresQuery,
  pendingProposalsQuery,
  stockOverviewQuery,
  stockVolatileQuery,
  tasksQuery,
} from "@/hooks/queries";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const stock = useQuery(stockOverviewQuery());
  const volatile = useQuery(stockVolatileQuery());
  const proposals = useQuery(pendingProposalsQuery());
  const tasks = useQuery(tasksQuery(false));
  const chores = useQuery(choresQuery());
  const batteries = useQuery(batteriesQuery());

  const error =
    stock.error ||
    volatile.error ||
    proposals.error ||
    tasks.error ||
    chores.error ||
    batteries.error;

  const loading =
    stock.isLoading ||
    volatile.isLoading ||
    proposals.isLoading ||
    tasks.isLoading ||
    chores.isLoading ||
    batteries.isLoading;

  const openTasks = tasks.data?.filter((t) => !t.done).length ?? 0;
  const dueChores = chores.data?.length ?? 0;
  const batteryCount = batteries.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        lead="A quick read on stock, household work, and nutrition reviews."
      />
      {error ? (
        <ErrorBlock
          message={error instanceof Error ? error.message : "Could not load dashboard."}
        />
      ) : null}
      {loading ? <LoadingBlock label="Loading dashboard…" /> : null}
      <div className="stat-strip">
        <Link to="/stock" className="stat-card stat-card-link" data-tone="accent">
          <span className="label">Products in stock</span>
          <span className="value">{stock.data?.length ?? "—"}</span>
        </Link>
        <Link to="/stock" className="stat-card stat-card-link" data-tone="warn">
          <span className="label">Due soon</span>
          <span className="value">
            {volatile.data?.due_products.length ?? "—"}
          </span>
        </Link>
        <Link to="/stock" className="stat-card stat-card-link" data-tone="danger">
          <span className="label">Overdue</span>
          <span className="value">
            {volatile.data?.overdue_products.length ?? "—"}
          </span>
        </Link>
        <Link
          to="/shopping"
          className="stat-card stat-card-link"
          data-tone="ok"
        >
          <span className="label">Below minimum</span>
          <span className="value">
            {volatile.data?.missing_products.length ?? "—"}
          </span>
        </Link>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-inner">
            <h2>Needs attention</h2>
            <ul className="link-list">
              <li>
                <Link to="/reviews">
                  {proposals.data?.length ?? 0} nutrition proposals to review
                </Link>
              </li>
              <li>
                <Link to="/household">
                  {openTasks} open tasks · {dueChores} chores on schedule
                </Link>
              </li>
              <li>
                <Link to="/household">{batteryCount} batteries tracked</Link>
              </li>
            </ul>
          </div>
        </section>
        <section className="panel">
          <div className="panel-inner">
            <h2>Shortcuts</h2>
            <div className="shortcut-grid">
              <Link to="/barcode" className="shortcut-card">Scan barcode</Link>
              <Link to="/locations" className="shortcut-card">By location</Link>
              <Link to="/journal" className="shortcut-card">Stock journal</Link>
              <Link to="/labels" className="shortcut-card">Print labels</Link>
              <Link to="/meal-plan" className="shortcut-card">Meal plan</Link>
              <Link to="/shopping" className="shortcut-card">Shopping list</Link>
              <Link to="/manage" className="shortcut-card">Manage data</Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
