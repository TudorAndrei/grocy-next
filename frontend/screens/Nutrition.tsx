import { Text, View } from "nsh";
import { Api, type Row } from "../api";
import type { components } from "../generated/server";
import { remote, operations, Feedback, LoadState } from "../data";
import { Action, Heading, Line, Note } from "../ui";
type Proposal = components["schemas"]["NutritionProposalView"];
type Record = components["schemas"]["NutritionRecord"];
export function Nutrition(p: { api: Api; onReviewed?: () => void }) {
  const state = remote(async (s) => {
    const [proposals, products] = await Promise.all([
      p.api.request<Proposal[]>(
        "/api/v2/nutrition/proposals",
        "GET",
        undefined,
        s,
      ),
      p.api.request<Row[]>("/api/objects/products", "GET", undefined, s),
    ]);
    const current: Map<number, Record | null> = new Map();
    for (const proposal of proposals) {
      if (!current.has(proposal.product_id)) {
        const revisions = await p.api.request<Row[]>(
          `/api/v2/products/${proposal.product_id}/nutrition/revisions`,
          "GET",
          undefined,
          s,
        );
        current.set(
          proposal.product_id,
          revisions.length
            ? await p.api.request<Record>(
                `/api/v2/products/${proposal.product_id}/nutrition`,
                "GET",
                undefined,
                s,
              )
            : null,
        );
      }
    }
    return { proposals, products, current };
  });
  const op = operations(async () => {
    await state.refresh();
    p.onReviewed?.();
  });
  return (
    <View class="gap-4">
      <Note>
        Compare each change with the current record before approving it.
      </Note>
      <Feedback error={op.error()} success={op.success()} />
      <LoadState
        loading={state.loading()}
        error={state.error()}
        retry={state.refresh}
      />
      {!state.loading() && !state.error() && !state.data()?.proposals.length ? (
        <Note>All caught up. No changes need review.</Note>
      ) : null}
      <Each of={state.data()?.proposals ?? []}>
        {(r) => (
          <Line>
            <Heading
              title={
                state
                  .data()
                  ?.products.find((i) => Number(i.id) === r().product_id)
                  ?.name ?? `Product ${r().product_id}`
              }
            />
            <Note>
              Per {r().payload.basis.quantity} {r().payload.basis.unit} ·
              Source: {r().payload.source?.type}
            </Note>
            <Note>
              {r().payload.source?.note ||
                r().payload.note ||
                "No source note supplied."}
            </Note>
            <Note>
              Current record:{" "}
              {state.data()?.current.get(r().product_id)
                ? `per ${state.data()!.current.get(r().product_id)!.basis_quantity} ${state.data()!.current.get(r().product_id)!.basis_unit}`
                : "not recorded"}
              . Proposed values use the basis shown above.
            </Note>
            <View class="flex-row gap-2">
              <Text class="flex-1 text-sm text-[#5e625f]">Nutrient</Text>
              <Text class="w-20 text-sm text-[#5e625f]">Current</Text>
              <Text class="w-20 text-sm text-[#5e625f]">Proposed</Text>
            </View>
            <Each of={Object.keys(r().payload.nutrients)}>
              {(key) => (
                <View class="flex-row gap-2 py-2 border-b border-[#e4e4e0]">
                  <Text class="flex-1 text-sm text-[#1b1d1c]">
                    {key().replace(/_/g, " ")}
                  </Text>
                  <Text class="w-20 text-sm text-[#5e625f]">
                    {String(
                      (
                        state.data()?.current.get(r().product_id)?.nutrients as
                          | Row
                          | undefined
                      )?.[key()] ?? "—",
                    )}
                  </Text>
                  <Text class="w-20 text-sm font-semibold text-[#1b1d1c]">
                    {String((r().payload.nutrients as Row)[key()] ?? "—")}
                  </Text>
                </View>
              )}
            </Each>
            {r().conflict_reason ? (
              <Note error>{r().conflict_reason}</Note>
            ) : null}
            <View class="flex-row gap-2">
              <Action
                label="Approve"
                primary
                disabled={op.busy()}
                onPress={() =>
                  void op.run(
                    () =>
                      p.api.post(
                        `/api/v2/nutrition/proposals/${r().id}/approve`,
                      ),
                    "Nutrition approved.",
                  )
                }
              />
              <Action
                label="Reject"
                disabled={op.busy()}
                onPress={() =>
                  void op.run(
                    () =>
                      p.api.post(
                        `/api/v2/nutrition/proposals/${r().id}/reject`,
                      ),
                    "Proposal rejected.",
                  )
                }
              />
            </View>
          </Line>
        )}
      </Each>
    </View>
  );
}
export function NutritionHistory(p: { api: Api; productId: number }) {
  const state = remote(async (s) => {
    const revisions = await p.api.request<Row[]>(
      `/api/v2/products/${p.productId}/nutrition/revisions`,
      "GET",
      undefined,
      s,
    );
    return {
      revisions,
      record: revisions.length
        ? await p.api.request<Record>(
            `/api/v2/products/${p.productId}/nutrition`,
            "GET",
            undefined,
            s,
          )
        : null,
    };
  });
  const op = operations(state.refresh);
  return (
    <View class="gap-3">
      <Text class="text-base font-semibold text-[#1b1d1c]">Nutrition</Text>
      <LoadState
        loading={state.loading()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback error={op.error()} success={op.success()} />
      {state.data()?.record ? (
        <View class="gap-2">
          <Note>
            Per {state.data()!.record!.basis_quantity}{" "}
            {state.data()!.record!.basis_unit}
          </Note>
          <Each
            of={Object.entries(state.data()!.record!.nutrients).filter(
              ([, v]) => v != null,
            )}
          >
            {(n) => (
              <View class="flex-row justify-between">
                <Text class="text-sm text-[#5e625f]">
                  {n()[0].replace(/_/g, " ")}
                </Text>
                <Text class="text-sm text-[#1b1d1c]">{String(n()[1])}</Text>
              </View>
            )}
          </Each>
        </View>
      ) : !state.loading() && !state.error() ? (
        <Note>No nutrition recorded yet.</Note>
      ) : null}
      <Each of={state.data()?.revisions ?? []}>
        {(r) => (
          <View class="flex-row justify-between items-center">
            <Note>
              Revision {r().revision} · {r().origin}
            </Note>
            <Action
              label={`Restore ${r().revision}`}
              quiet
              disabled={op.busy()}
              onPress={() =>
                void op.run(
                  () =>
                    p.api.post(
                      `/api/v2/products/${p.productId}/nutrition/revisions/${r().revision}/restore`,
                    ),
                  "Revision restored.",
                )
              }
            />
          </View>
        )}
      </Each>
    </View>
  );
}
