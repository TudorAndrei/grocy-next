import { useI18n } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, queryKeys } from "@/lib/api";
import { stockAmount, stockMinimumAmount, useCatalog } from "@/lib/catalog";
import { daysUntil, relativeTime, todayLine } from "@/lib/format";
import { useStockMove } from "@/lib/stockActions";
import { usePreferences } from "@/lib/preferences";
import { stockVolatileQuery } from "@/hooks/queries";
import { useChoreActions } from "@/lib/householdActions";
import { useCommandBar } from "@/components/CommandBar";
import { DueBar, DUE_WINDOW_DAYS } from "@/components/DueBar";
import { ErrorBlock } from "@/components/ErrorBlock";
import { ActorTag, bookingVerb } from "@/components/ActorTag";
import { Gauge } from "@/components/Gauge";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { QuickMoves } from "@/components/QuickMoves";
import { useNotify } from "@/components/Toaster";
import type { Domain } from "@/components/SiteNav";
import { useFeatures } from "@/lib/features";

export const Route = createFileRoute("/today")({
  component: TodayPage,
});

type DueItem = {
  key: string;
  domain: Domain;
  name: string;
  detail: string;
  days: number;
  action: { label: string; run: () => void; busy: boolean } | null;
  link?: { to: "/products/$productId"; productId: number };
};

function TodayPage() {
  const { t: tr } = useI18n();

  const { dueSoonDays } = usePreferences();
  const features = useFeatures();
  const stockEnabled = features.enabled("STOCK");
  const shoppingEnabled = features.enabled("SHOPPINGLIST");
  const choresEnabled = features.enabled("CHORES");
  const tasksEnabled = features.enabled("TASKS");
  const datesEnabled = stockEnabled && features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const catalog = useCatalog(stockEnabled || shoppingEnabled);
  const command = useCommandBar();
  const notify = useNotify();
  const queryClient = useQueryClient();

  const stock = useQuery({
    queryKey: queryKeys.stockOverview,
    queryFn: api.listStock,
    enabled: stockEnabled,
  });

  const volatile = useQuery({ ...stockVolatileQuery(dueSoonDays), enabled: stockEnabled });

  const chores = useQuery({
    queryKey: queryKeys.chores,
    queryFn: api.listChores,
    enabled: choresEnabled,
  });

  const tasks = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => api.listTasks(false),
    enabled: tasksEnabled,
  });

  const proposals = useQuery({
    queryKey: queryKeys.proposalsPending,
    queryFn: api.listPendingProposals,
    enabled: stockEnabled,
  });

  const log = useQuery({
    queryKey: queryKeys.stockLog,
    queryFn: api.listStockLog,
    enabled: stockEnabled,
  });

  const shopping = useQuery({
    queryKey: queryKeys.shopping(1),
    queryFn: () => api.getShoppingList(1),
    enabled: shoppingEnabled,
  });

  const me = useQuery({ queryKey: queryKeys.currentUser, queryFn: api.getCurrentUser });
  const toBuy = (shopping.data?.items ?? []).filter((item) => !item.done);

  const consume = useStockMove("consume", stockEnabled);
  const { execute: executeChore, complete: completeTask } = useChoreActions();

  const addMissing = useMutation({
    mutationFn: () => api.addMissingToShoppingList(1),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["shopping"] });
      notify({ message: tr("Added every product below its minimum to the shopping list") });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const amounts = useMemo(
    () => new Map((stock.data ?? []).map((item) => [item.product_id, item])),
    [stock.data],
  );

  const low = useMemo(() => {
    if (!stockEnabled) return [];

    return (volatile.data?.missing_products ?? []).map((missing) => {
      const product = catalog.product(missing.id);
      const entry = amounts.get(missing.id);

      return {
        id: missing.id,
        name: missing.name,
        min: (entry ? stockMinimumAmount(entry) : 0) + missing.amount_missing,
        amount: entry ? stockAmount(entry) : 0,
        minimumAmount: entry ? stockMinimumAmount(entry) : 0,
        missing: missing.amount_missing,
        location: catalog.location(product?.location_id)?.name,
      };
    });
  }, [volatile.data, catalog, amounts, stockEnabled]);

  const due = useMemo<DueItem[]>(() => {
    const items: DueItem[] = [];

    for (const entry of datesEnabled ? (stock.data ?? []) : []) {
      const days = daysUntil(entry.best_before_date);

      if (days === null || days > DUE_WINDOW_DAYS || entry.amount <= 0) continue;
      items.push({
        key: `s${entry.product_id}`,
        domain: "stock",
        name: entry.product.name,
        detail: `${catalog.amountText(entry.product_id, entry.amount)} · ${days < 0 ? tr("expired") : tr("best before")}`,
        days,
        link: { to: "/products/$productId", productId: entry.product_id },
        action: {
          label: tr("Consume"),
          busy: consume.isPending && consume.variables?.productId === entry.product_id,
          run: () => consume.mutate({ productId: entry.product_id, amount: 1 }),
        },
      });
    }

    for (const chore of choresEnabled ? (chores.data ?? []) : []) {
      const days = daysUntil(chore.next_estimated_execution_time);

      if (days === null || days > DUE_WINDOW_DAYS) continue;
      items.push({
        key: `c${chore.id}`,
        domain: "home",
        name: chore.name,
        detail: chore.period_type ? `${tr("Chore")} · ${tr(chore.period_type)}` : tr("Chore"),
        days,
        action: {
          label: tr("Done"),
          busy: executeChore.isPending && executeChore.variables === chore.id,
          run: () => executeChore.mutate(chore.id),
        },
      });
    }

    for (const task of tasksEnabled ? (tasks.data ?? []) : []) {
      const days = daysUntil(task.due_date);

      if (days === null || days > DUE_WINDOW_DAYS) continue;
      items.push({
        key: `t${task.id}`,
        domain: "home",
        name: task.name,
        detail: tr("Task"),
        days,
        action: {
          label: tr("Complete"),
          busy: completeTask.isPending && completeTask.variables === task.id,
          run: () => completeTask.mutate(task.id),
        },
      });
    }

    return items.sort((a, b) => a.days - b.days);
  }, [
    stock.data,
    chores,
    tasks,
    catalog,
    consume,
    executeChore,
    completeTask,
    datesEnabled,
    choresEnabled,
    tasksEnabled,
    tr,
  ]);

  const recent = useMemo(
    () =>
      (log.data ?? [])
        .filter((entry) => !entry.undone)
        .sort((a, b) => b.id - a.id)
        .filter(
          (entry, i, all) => all.findIndex((e) => e.transaction_id === entry.transaction_id) === i,
        )
        .slice(0, 4),
    [log.data],
  );

  const undo = useMutation({
    mutationFn: (transactionId: string) => api.undoTransaction(transactionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      notify({ message: tr("Booking undone") });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const pendingCount = stockEnabled ? (proposals.data?.length ?? 0) : 0;
  const needsYou = low.length + due.filter((d) => d.days <= 5).length + pendingCount;
  const loading = stock.isLoading || volatile.isLoading;

  return (
    <>
      <PageHeader
        title={tr("Today")}
        lead={
          <>
            {todayLine()}
            {loading
              ? null
              : needsYou === 0
                ? tr(" · nothing needs you")
                : tr(" · %s things need you", String(needsYou))}
          </>
        }
        actions={
          <>
            {stockEnabled && shoppingEnabled ? (
              <button
                type="button"
                className="btn"
                disabled={addMissing.isPending || low.length === 0}
                onClick={() => addMissing.mutate()}
              >
                {tr("Add missing to list")}
              </button>
            ) : null}
            {stockEnabled ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => command.open("purchase")}
              >
                {tr("Purchase")}
              </button>
            ) : null}
          </>
        }
      />

      {stock.isError ? <ErrorBlock message={stock.error.message} /> : null}

      <div className="today">
        <div className="today-main">
          {stockEnabled ? (
            <section className="panel today-low" aria-labelledby="low-heading">
              <h2 className="panel-head" id="low-heading">
                {tr("Running low")}
                <span>
                  {low.length === 0
                    ? tr("all above minimum")
                    : tr("%s below minimum", String(low.length))}
                </span>
              </h2>
              {loading ? <LoadingBlock label={tr("Checking stock…")} /> : null}
              {!loading && low.length === 0 ? (
                <p className="panel-empty">
                  {tr("Every product with a minimum has enough on hand.")}
                </p>
              ) : null}
              <ul className="stock-rows">
                {low.map((item) => (
                  <li key={item.id} className="stock-row">
                    <Link
                      to="/products/$productId"
                      params={{ productId: String(item.id) }}
                      className="stock-name"
                    >
                      {item.name}
                      <small>
                        {features.enabled("STOCK_LOCATION_TRACKING")
                          ? `${item.location ?? "No location"} · `
                          : ""}
                        {tr("min")} {catalog.amountText(item.id, item.min)} {tr("· missing")}{" "}
                        {catalog.amountText(item.id, item.missing)}
                      </small>
                    </Link>
                    <Gauge amount={item.minimumAmount} min={item.min} label={item.name} />
                    <span className="amount">{catalog.amountText(item.id, item.amount)}</span>
                    <span className="row-actions">
                      <QuickMoves productId={item.id} name={item.name} amount={item.amount} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {datesEnabled || choresEnabled || tasksEnabled ? (
            <section className="panel" aria-labelledby="due-heading">
              <h2 className="panel-head" id="due-heading">
                {tr("Use first")}
                <span>
                  {tr("next")} {DUE_WINDOW_DAYS} {tr("days")}
                </span>
              </h2>
              {!loading && due.length === 0 ? (
                <p className="panel-empty">
                  {tr("Nothing expires or falls due in the next two weeks.")}
                </p>
              ) : null}
              <ul className="due-rows">
                {due.map((item) => (
                  <li key={item.key} className="due-row" data-domain={item.domain}>
                    <span className="due-name">
                      {item.link ? (
                        <Link to={item.link.to} params={{ productId: String(item.link.productId) }}>
                          {item.name}
                        </Link>
                      ) : (
                        item.name
                      )}
                      <small>{item.detail}</small>
                    </span>
                    <DueBar days={item.days} />
                    {item.action ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={item.action.busy}
                        onClick={item.action.run}
                      >
                        {item.action.label}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="today-side">
          {shoppingEnabled ? (
            <section className="panel" aria-labelledby="list-heading" data-domain="shopping">
              <h2 className="panel-head" id="list-heading">
                {tr("Shopping list")}
                <span>
                  {toBuy.length === 0 ? tr("empty") : tr("%s to buy", String(toBuy.length))}
                </span>
              </h2>
              {toBuy.length > 0 ? (
                <ul className="list-preview">
                  {toBuy.slice(0, 8).map((item) => (
                    <li key={item.id}>
                      {item.product_id != null ? (
                        <>
                          <b>{catalog.amountText(item.product_id, item.amount)}</b>{" "}
                          {catalog.productName(item.product_id)}
                        </>
                      ) : (
                        item.note
                      )}
                    </li>
                  ))}
                  {toBuy.length > 8 ? (
                    <li>
                      +{toBuy.length - 8} {tr("more")}
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="panel-empty">
                  {tr("Nothing on the list. Add missing pulls in everything below its minimum.")}
                </p>
              )}
              <div className="panel-actions">
                <Link to="/shopping" className="btn btn-sm btn-primary">
                  {tr("Go shopping")}
                </Link>
                {stockEnabled ? (
                  <button type="button" className="btn btn-sm" onClick={() => command.open("list")}>
                    {tr("Add to list")}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {stockEnabled ? (
            <section className="panel" aria-labelledby="review-heading">
              <h2 className="panel-head" id="review-heading">
                {tr("Review and undo")}
                <span>
                  {pendingCount === 0
                    ? tr("no proposals waiting")
                    : tr("%s waiting", String(pendingCount))}
                </span>
              </h2>
              {pendingCount > 0 ? (
                <ul className="review-rows">
                  {(proposals.data ?? []).slice(0, 3).map((proposal) => {
                    const fromAgent = proposal.payload.origin !== "web";

                    return (
                      <li key={proposal.id}>
                        <span className="tag" data-domain={fromAgent ? "agent" : undefined}>
                          {fromAgent ? tr("Agent") : tr("Web")}
                        </span>
                        <span className="review-what">
                          <b>{catalog.productName(proposal.product_id)}</b> {tr("nutrition")}
                          {proposal.payload.nutrients.energy_kcal != null
                            ? tr(
                                " · %1$s kcal / %2$s %3$s",
                                String(proposal.payload.nutrients.energy_kcal),
                                String(proposal.payload.basis.quantity),
                                String(proposal.payload.basis.unit),
                              )
                            : ""}
                        </span>
                        <Link to="/reviews" className="btn btn-sm btn-primary">
                          {tr("Review")}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {recent.length > 0 ? (
                <>
                  <h3 className="panel-sub">{tr("Recent bookings")}</h3>
                  <ul className="review-rows">
                    {recent.map((entry) => (
                      <li key={entry.id}>
                        <ActorTag userId={entry.user_id} currentUserId={me.data?.id} />
                        <span className="review-what">
                          {bookingVerb(entry.transaction_type)}{" "}
                          <b>{catalog.amountText(entry.product_id, Math.abs(entry.amount))}</b>{" "}
                          {catalog.productName(entry.product_id)}
                          <small>{relativeTime(entry.row_created_timestamp)}</small>
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={undo.isPending}
                          onClick={() => undo.mutate(entry.transaction_id)}
                        >
                          {tr("Undo")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {pendingCount === 0 && recent.length === 0 ? (
                <p className="panel-empty">{tr("No proposals and no bookings yet.")}</p>
              ) : (
                <Link to="/activity" className="panel-more">
                  {tr("All activity")}
                </Link>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
