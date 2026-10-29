import { z } from "zod";
import { request } from "./api";
import { stockEntriesSchema } from "./stock-entries";

const entry = stockEntriesSchema.shape.rows.element.pick({
  amount: true,
  best_before_date: true,
  purchased_date: true,
  price: true,
  open: true,
  location_id: true,
  shopping_location_id: true,
  note: true,
  product_id: true,
});

const name = z.object({ name: z.string() });

const product = z.object({
  product: z.object({ disable_open: z.number() }),
  qu_conversion_factor_purchase_to_stock: z.number(),
  default_quantity_unit_purchase: name,
  quantity_unit_stock: name,
});

export type EntryRefresh = Partial<z.infer<typeof entry>> & {
  at: number;
  location_name?: string;
  shopping_location_name?: string;
  purchase_qu_name?: string;
  qu_factor_purchase_to_stock?: number;
  qu_name?: string;
  openDisabled?: boolean;
};

export async function refreshEntry(id: number, update: (value: EntryRefresh | null) => void) {
  const saved = entry.nullable().parse(await request(`/api/stock/entry/${id}`));

  if (!saved || saved.amount === 0) {
    update(null);

    return;
  }

  const at = Date.now();
  update({ ...saved, at, openDisabled: saved.open === 1 });

  const reads = await Promise.allSettled([
    request(`/api/objects/locations/${saved.location_id}`).then((value) => {
      update({ at, location_name: name.parse(value).name });
    }),
    request(`/api/stock/products/${saved.product_id}`).then((value) => {
      const details = product.parse(value);

      const valueUpdate: EntryRefresh = {
        at,
        purchase_qu_name: details.default_quantity_unit_purchase.name,
        qu_factor_purchase_to_stock: details.qu_conversion_factor_purchase_to_stock,
        qu_name: details.quantity_unit_stock.name,
      };

      if (details.product.disable_open === 1) valueUpdate.openDisabled = true;
      update(valueUpdate);
    }),
    saved.shopping_location_id
      ? request(`/api/objects/shopping_locations/${saved.shopping_location_id}`).then((value) =>
          update({ at, shopping_location_name: name.parse(value).name }),
        )
      : Promise.resolve(update({ at, shopping_location_name: "" })),
  ]);

  for (const read of reads) if (read.status === "rejected") throw read.reason;
}
