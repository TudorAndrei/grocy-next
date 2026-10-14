import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys } from "@/lib/api";
import type { Nutrients, NutritionRecord } from "@/lib/types";

type ProposalFormProps = {
  productId: number;
  nutrition: NutritionRecord | null;
};

const DEFAULT_NUTRIENT_KEYS = [
  "energy_kcal",
  "protein_g",
  "carbohydrates_g",
  "sugars_g",
  "fat_g",
  "saturated_fat_g",
  "fiber_g",
  "salt_g",
] as const;

function parseNutrients(text: string): Nutrients {
  const out: Nutrients = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [key, rawValue] = trimmed.split(/[:=]/).map((s) => s.trim());
    if (!key) continue;
    if (!rawValue) {
      (out as Record<string, number | null>)[key] = null;
      continue;
    }
    const num = Number(rawValue);
    (out as Record<string, number | null>)[key] = Number.isFinite(num) ? num : null;
  }
  return out;
}

export function ProposalForm({ productId, nutrition }: ProposalFormProps) {
  const queryClient = useQueryClient();
  const [basisQuantity, setBasisQuantity] = useState(
    nutrition?.basis_quantity?.toString() ?? "100",
  );
  const [basisUnit, setBasisUnit] = useState(nutrition?.basis_unit ?? "g");
  const [nutrientText, setNutrientText] = useState(() => {
    if (nutrition?.nutrients && Object.keys(nutrition.nutrients).length > 0) {
      return Object.entries(nutrition.nutrients)
        .map(([k, v]) => `${k}: ${v ?? ""}`)
        .join("\n");
    }
    return DEFAULT_NUTRIENT_KEYS.map((key) => `${key}: `).join("\n");
  });
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.createProposal({
        product_id: productId,
        expected_revision: nutrition?.revision ?? 0,
        basis: {
          quantity: Number(basisQuantity),
          unit: basisUnit,
        },
        nutrients: parseNutrients(nutrientText),
        source: { type: "packaging_label", note: note.trim() || null },
        note: note.trim() || null,
        origin: "web",
      }),
    onSuccess: async () => {
      setFeedback("Proposal submitted for review.");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.proposalsPending,
      });
    },
    onError: (err: Error) => {
      setFeedback(err.message);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    mutation.mutate();
  }

  return (
    <section className="panel" aria-labelledby="propose-heading">
      <div className="panel-inner">
        <h2 id="propose-heading" className="page-title" style={{ fontSize: "1.25rem" }}>
          Propose nutrition update
        </h2>
        <p className="muted" style={{ marginTop: "-0.25rem" }}>
          Values stay staged until approved. Leave unknowns blank (null), never invent zero.
        </p>
        <form className="stack" onSubmit={onSubmit}>
          <div className="field-row">
            <label>
              Basis quantity
              <input
                value={basisQuantity}
                onChange={(e) => setBasisQuantity(e.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Basis unit
              <select value={basisUnit} onChange={(e) => setBasisUnit(e.target.value)}>
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="serving">serving</option>
              </select>
            </label>
          </div>
          <label>
            Nutrients (one per line, `key: value`)
            <textarea
              rows={10}
              value={nutrientText}
              onChange={(e) => setNutrientText(e.target.value)}
            />
          </label>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? "Submitting…" : "Submit proposal"}
          </button>
          {feedback ? <p className="muted">{feedback}</p> : null}
        </form>
      </div>
    </section>
  );
}
