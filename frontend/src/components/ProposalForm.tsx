import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, request } from "@/lib/api";
import type { Nutrients, NutritionRecord } from "@/lib/types";
import { ErrorBlock } from "./ErrorBlock";
export const nutrientLabels: Record<keyof Nutrients, string> = {
  energy_kj: "Energy (kJ)",
  energy_kcal: "Energy (kcal)",
  protein_g: "Protein (g)",
  carbohydrates_g: "Carbohydrates (g)",
  sugars_g: "Sugars (g)",
  fat_g: "Fat (g)",
  saturated_fat_g: "Saturated fat (g)",
  fiber_g: "Fibre (g)",
  salt_g: "Salt (g)",
};
export function ProposalForm({
  productId,
  nutrition,
}: {
  productId: number;
  nutrition: NutritionRecord | null;
}) {
  const client = useQueryClient();
  const [quantity, setQuantity] = useState(
    String(nutrition?.basis_quantity ?? 100),
  );
  const [unit, setUnit] = useState(nutrition?.basis_unit ?? "g");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.keys(nutrientLabels).map((key) => [
        key,
        String(nutrition?.nutrients[key as keyof Nutrients] ?? ""),
      ]),
    ),
  );
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const nutrients: Nutrients = {};
      for (const key of Object.keys(nutrientLabels) as (keyof Nutrients)[])
        nutrients[key] = values[key] ? Number(values[key]) : null;
      let photoPath: string | undefined;
      if (photo) {
        const name = `${productId}-${Date.now()}-${photo.name}`;
        await request(`/api/files/nutrition/${encodeURIComponent(name)}`, {
          method: "PUT",
          body: photo,
        });
        photoPath = `nutrition/${name}`;
      }
      return api.createProposal({
        product_id: productId,
        expected_revision: nutrition?.revision ?? 0,
        basis: { quantity: Number(quantity), unit },
        nutrients,
        source: {
          type: "packaging_label",
          note: note || null,
          photo_path: photoPath,
        },
        note: note || null,
        origin: "web",
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["proposals", "pending"] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };
  return (
    <section className="panel panel-inner" aria-labelledby="propose-heading">
      <h2 id="propose-heading">Propose nutrition update</h2>
      <p className="muted">
        Enter the values on the label. Leave unknown values blank. Review the
        proposal before approval.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="nutrition-quantity">Label quantity</label>
            <input
              id="nutrition-quantity"
              type="number"
              min="0.000001"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="nutrition-unit">Label unit</label>
            <select
              id="nutrition-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option value="g">Grams</option>
              <option value="ml">Millilitres</option>
              <option value="serving">Servings</option>
            </select>
          </div>
          {(Object.keys(nutrientLabels) as (keyof Nutrients)[]).map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`nutrient-${key}`}>{nutrientLabels[key]}</label>
              <input
                id={`nutrient-${key}`}
                type="number"
                min="0"
                step="any"
                value={values[key]}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              />
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="nutrition-photo">Label photo</label>
          <input
            id="nutrition-photo"
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="field">
          <label htmlFor="nutrition-note">Note</label>
          <input
            id="nutrition-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving proposal..." : "Submit proposal"}
        </button>
        {mutation.error && <ErrorBlock message={mutation.error.message} />}
        {mutation.isSuccess && <p role="status">Proposal saved for review.</p>}
      </form>
    </section>
  );
}
