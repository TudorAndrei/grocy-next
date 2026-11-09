import { Text, View } from "nsh";
import { Api, type Row } from "../api";
import type { components } from "../generated/server";
import { remote, operations, Feedback, LoadState } from "../data";
import { Action, Empty, Icon, Note, Subheading, Surface } from "../ui";
type Proposal = components["schemas"]["NutritionProposalView"];
type Record = components["schemas"]["NutritionRecord"];
type Revision = components["schemas"]["NutritionRevisionView"];

/** Nutrients in label order, with the unit each value is measured in. */
const nutrients: [key: string, label: string, unit: string][] = [
  ["energy_kcal", "Energy", "kcal"],
  ["energy_kj", "Energy", "kJ"],
  ["fat_g", "Fat", "g"],
  ["saturated_fat_g", "Saturated fat", "g"],
  ["carbohydrates_g", "Carbohydrates", "g"],
  ["sugars_g", "Sugars", "g"],
  ["fiber_g", "Fibre", "g"],
  ["protein_g", "Protein", "g"],
  ["salt_g", "Salt", "g"],
];
const sources: { [type: string]: string } = {
  packaging_label: "Packaging label",
  manual: "Entered by hand",
  external_database: "Food database",
};
const amount = (value: unknown, unit: string) =>
  value == null || value === "" ? "—" : `${value} ${unit}`;
const basis = (quantity: string | number, unit: string) =>
  unit === "serving"
    ? `per ${quantity} ${Number(quantity) === 1 ? "serving" : "servings"}`
    : `per ${quantity} ${unit}`;
const same = (a: unknown, b: unknown) =>
  a == null || b == null || a === "" || b === ""
    ? (a ?? "") === (b ?? "")
    : Number(a) === Number(b);

export function Nutrition(p: { api: Api; onReviewed?: () => void }) {
  const state = remote(async (s) => {
    const [proposals, products] = await Promise.all([
      p.api.request<Proposal[]>("/api/v2/nutrition/proposals", "GET", undefined, s),
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
  const product = (id: number) =>
    state.data()?.products.find((i) => Number(i.id) === id)?.name ?? `Product ${id}`;
  return (
    <View class="gap-4 max-w-[720px]">
      <Feedback error={op.error()} success={op.success()} />
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      {!state.loading() && !state.error() && !state.data()?.proposals.length ? (
        <Empty
          plain
          title="Nothing to review"
          detail="When an assistant proposes nutrition for a product, it appears here to compare and approve."
        />
      ) : null}
      <Each of={state.data()?.proposals ?? []}>
        {(r) => (
          <ProposalCard
            proposal={r()}
            product={product(r().product_id)}
            current={state.data()?.current.get(r().product_id) ?? null}
            only={(state.data()?.proposals.length ?? 0) === 1}
            busy={op.busy()}
            onApprove={() =>
              void op.run(
                () => p.api.post(`/api/v2/nutrition/proposals/${r().id}/approve`),
                "Nutrition approved.",
              )
            }
            onReject={() =>
              void op.run(
                () => p.api.post(`/api/v2/nutrition/proposals/${r().id}/reject`),
                "Proposal rejected.",
              )
            }
          />
        )}
      </Each>
    </View>
  );
}

function ProposalCard(p: {
  proposal: Proposal;
  product: string;
  current: Record | null;
  only: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const payload = () => p.proposal.payload;
  const proposed = () => payload().nutrients as Row;
  const was = () => (p.current?.nutrients ?? {}) as Row;
  const rows = () => nutrients.filter(([key]) => proposed()[key] != null || was()[key] != null);
  const sameBasis = () =>
    !p.current ||
    (p.current.basis_unit === payload().basis.unit &&
      Number(p.current.basis_quantity) === Number(payload().basis.quantity));
  const note = () => payload().source?.note || payload().note || "";
  return (
    <Surface class="p-0">
      <View class="px-4 pt-4 pb-3 md:px-5 gap-1">
        <Text class="text-[15px] font-semibold text-foreground">{p.product}</Text>
        <Text class="text-[13px] text-muted-foreground tabular-nums">
          {[
            sources[payload().source?.type ?? ""] ?? payload().source?.type,
            payload().origin ? `from ${payload().origin}` : "",
            basis(payload().basis.quantity, payload().basis.unit),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {note() ? <Text class="text-[13px] leading-5 text-ink-soft">{note()}</Text> : null}
      </View>
      <View class="mx-4 md:mx-5">
        <View class="flex-row items-center gap-3 py-2 border-b border-border">
          <Text class="flex-1 text-[13px] text-muted-foreground">Nutrient</Text>
          <Text class="w-24 text-right text-[13px] text-muted-foreground">Current</Text>
          <Text class="w-24 text-right text-[13px] text-muted-foreground">Proposed</Text>
        </View>
        <Each of={rows()}>
          {(n) => (
            <View class="flex-row items-center gap-3 min-h-10 py-2 border-b border-border">
              <Text
                class={`flex-1 text-sm ${same(was()[n()[0]], proposed()[n()[0]]) ? "text-muted-foreground" : "text-foreground"}`}
              >
                {n()[1]}
              </Text>
              <Text class="w-24 text-right text-sm tabular-nums text-muted-foreground">
                {amount(was()[n()[0]], n()[2])}
              </Text>
              <Text
                class={`w-24 text-right text-sm tabular-nums ${same(was()[n()[0]], proposed()[n()[0]]) ? "text-muted-foreground" : "font-medium text-foreground"}`}
              >
                {amount(proposed()[n()[0]], n()[2])}
              </Text>
            </View>
          )}
        </Each>
      </View>
      <View class="px-4 md:px-5 py-3 gap-3">
        {!p.current ? (
          <Note>No nutrition is recorded for this product yet.</Note>
        ) : !sameBasis() ? (
          <Note>
            {`Current values are ${basis(p.current.basis_quantity, p.current.basis_unit)}; proposed values are ${basis(payload().basis.quantity, payload().basis.unit)}.`}
          </Note>
        ) : null}
        {p.proposal.conflict_reason ? (
          <View class="flex-row items-start gap-2">
            <Icon name="alert" size={15} tint="destructive" />
            <View class="flex-1 min-w-0">
              <Note error>{p.proposal.conflict_reason}</Note>
            </View>
          </View>
        ) : null}
        <View class="flex-row justify-end gap-2">
          <Action label="Reject" quiet disabled={p.busy} onPress={p.onReject} />
          <Action
            label="Approve"
            icon="check"
            primary={p.only}
            disabled={p.busy}
            onPress={p.onApprove}
          />
        </View>
      </View>
    </Surface>
  );
}

export function NutritionHistory(p: { api: Api; productId: number }) {
  const state = remote(async (s) => {
    const revisions = await p.api.request<Revision[]>(
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
  const record = () => state.data()?.record ?? null;
  const values = () =>
    nutrients.filter(([key]) => (record()?.nutrients as Row | undefined)?.[key] != null);
  return (
    <View class="gap-3">
      <Subheading
        title="Nutrition"
        detail={record() ? basis(record()!.basis_quantity, record()!.basis_unit) : undefined}
      />
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      <Feedback error={op.error()} success={op.success()} />
      {record() ? (
        <View class="border-t border-border">
          <Each of={values()}>
            {(n) => (
              <View class="flex-row items-center justify-between min-h-9 py-1.5 border-b border-border">
                <Text class="text-sm text-muted-foreground">{n()[1]}</Text>
                <Text class="text-sm tabular-nums text-foreground">
                  {amount((record()!.nutrients as Row)[n()[0]], n()[2])}
                </Text>
              </View>
            )}
          </Each>
        </View>
      ) : !state.loading() && !state.error() ? (
        <Note>No nutrition recorded yet. Approved proposals from Review appear here.</Note>
      ) : null}
      {state.data()?.revisions.length ? (
        <View class="gap-1 pt-2">
          <Text class="text-[13px] text-muted-foreground">Revisions</Text>
          <View class="border-t border-border">
            <Each of={(state.data()?.revisions ?? []).toSorted((a, b) => b.revision - a.revision)}>
              {(r) => (
                <View class="flex-row items-center gap-3 min-h-11 py-1.5 border-b border-border">
                  <View class="flex-1 min-w-0">
                    <Text class="text-sm tabular-nums text-foreground">
                      {`Revision ${r().revision}`}
                    </Text>
                    <Text style={{ numberOfLines: 1 }} class="text-[13px] text-muted-foreground">
                      {[r().origin, r().change_summary].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {r().revision === record()?.revision ? (
                    <Text class="px-2.5 text-[13px] text-muted-foreground">Current</Text>
                  ) : (
                    <Action
                      label="Restore"
                      accessibilityLabel={`Restore ${r().revision}`}
                      icon="undo"
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
                  )}
                </View>
              )}
            </Each>
          </View>
        </View>
      ) : null}
    </View>
  );
}
