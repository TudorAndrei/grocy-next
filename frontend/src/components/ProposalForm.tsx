import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { api, queryKeys, request } from "@/lib/api";
import { NUTRIENTS } from "@/lib/nutrients";
import type { Nutrients, NutritionRecord } from "@/lib/types";
import { useNotify } from "./Toaster";

type ProposalFormProps = {
  productId: number;
  nutrition: NutritionRecord | null;
};

function initialValues(nutrition: NutritionRecord | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of NUTRIENTS) {
    const value = nutrition?.nutrients?.[n.key];
    out[n.key] = value === null || value === undefined ? "" : String(value);
  }
  return out;
}

export function ProposalForm({ productId, nutrition }: ProposalFormProps) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [basisQuantity, setBasisQuantity] = useState(String(nutrition?.basis_quantity ?? "100"));
  const [basisUnit, setBasisUnit] = useState(nutrition?.basis_unit ?? "g");
  const [values, setValues] = useState(() => initialValues(nutrition));
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      // Blank stays unknown (null); never turn a missing value into zero.
      const nutrients: Nutrients = {};
      for (const n of NUTRIENTS) {
        const raw = values[n.key]?.trim().replace(",", ".");
        const num = raw ? Number(raw) : NaN;
        nutrients[n.key] = Number.isFinite(num) ? num : null;
      }
      let photoPath: string | undefined;
      if (photo) {
        const name = `${productId}-${Date.now()}-${photo.name}`;
        await request(`/api/v2/files/nutrition/${encodeURIComponent(name)}`, {
          method: "PUT",
          body: photo,
        });
        photoPath = `nutrition/${name}`;
      }
      return api.createProposal({
        product_id: productId,
        expected_revision: nutrition?.revision ?? 0,
        basis: { quantity: Number(basisQuantity), unit: basisUnit },
        nutrients,
        source: { type: "packaging_label", note: note.trim() || null, photo_path: photoPath },
        note: note.trim() || null,
        origin: "web",
      });
    },
    onSuccess: async () => {
      notify({ message: "Proposal sent to the review queue" });
      setNote("");
      setPhoto(null);
      if (photoInput.current) photoInput.current.value = "";
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposalsPending });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <section className="panel" aria-labelledby="propose-heading">
      <h2 className="panel-head" id="propose-heading">
        Propose nutrition
        <span>staged until approved</span>
      </h2>
      <form className="panel-body proposal-form" onSubmit={onSubmit}>
        <p className="field-hint">
          Leave unknown values blank. Blank is stored as unknown, never as zero.
        </p>
        <div className="field-row">
          <label className="field">
            <span>Per</span>
            <input
              value={basisQuantity}
              onChange={(e) => setBasisQuantity(e.target.value)}
              inputMode="decimal"
              required
            />
          </label>
          <label className="field">
            <span>Unit</span>
            <select value={basisUnit} onChange={(e) => setBasisUnit(e.target.value)}>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="serving">serving</option>
            </select>
          </label>
        </div>
        <div className="nutrient-inputs">
          {NUTRIENTS.map((n) => (
            <label
              key={n.key}
              className="nutrient-input"
              data-indent={n.indent ? "true" : undefined}
            >
              <span>{n.label}</span>
              <span className="amount-field">
                <input
                  value={values[n.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [n.key]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="—"
                />
                <span className="unit">{n.unit}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Where the values come from"
          />
        </label>
        <label className="field">
          <span>Label photo</span>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Sending…" : "Send for review"}
        </button>
      </form>
    </section>
  );
}
