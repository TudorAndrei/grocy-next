import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useChoreActions } from "@/lib/householdActions";
import type { Battery } from "@/lib/types";
import { ErrorBlock } from "@/components/ErrorBlock";
import { HouseholdTable } from "@/components/HouseholdTable";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/batteries")({
  component: BatteriesPage,
});

function nextCharge(battery: Battery): string | null {
  if (battery.next_estimated_charge_time) return battery.next_estimated_charge_time;
  if (!battery.last_tracked_time || !battery.charge_interval_days) return null;
  const next = new Date(battery.last_tracked_time);
  next.setDate(next.getDate() + battery.charge_interval_days);
  return next.toISOString();
}

function BatteriesPage() {
  const batteries = useQuery({ queryKey: queryKeys.batteries, queryFn: api.listBatteries });
  const { charge } = useChoreActions();

  return (
    <>
      <PageHeader
        title="Batteries"
        lead="Rechargeable and replaceable batteries, with their charge cycle."
      />
      {batteries.isLoading ? <LoadingBlock label="Loading batteries…" /> : null}
      {batteries.isError ? <ErrorBlock message={(batteries.error as Error).message} /> : null}
      {batteries.isSuccess && batteries.data.length === 0 ? (
        <p className="empty-state">No batteries tracked.</p>
      ) : null}
      {batteries.data?.length ? (
        <HouseholdTable
          dueLabel="Next charge"
          rows={batteries.data.map((battery) => ({
            id: battery.id,
            name: battery.name,
            detail: [
              battery.used_in,
              battery.description,
              battery.charge_interval_days ? `every ${battery.charge_interval_days} d` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            due: nextCharge(battery),
            dueEmpty: battery.last_tracked_time ? "No interval" : "Never charged",
            action: (
              <button
                type="button"
                className="btn btn-sm"
                disabled={charge.isPending && charge.variables === battery.id}
                onClick={() => charge.mutate(battery.id)}
              >
                Charged
              </button>
            ),
          }))}
        />
      ) : null}
    </>
  );
}
