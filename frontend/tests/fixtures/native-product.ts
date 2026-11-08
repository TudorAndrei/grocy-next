import type { JsonObject } from "@/lib/json";
import type { UserSettings } from "@/lib/types";
import type { UserfieldDefinition } from "@/lib/userfields";

type Row = JsonObject & { id: number };

type ProductRow = Row & { userfields: Record<string, string | null> | null };

type References = {
  locations: Row[];
  quantity_units: Row[];
  shopping_locations: Row[];
  product_groups: Row[];
  products: Row[];
};

/** Explicit controller fixture data; this never intercepts unrelated API reads. */
export function nativeProductContext({
  product = null,
  references,
  fields = [],
  user_settings = {},
  config = {},
  options,
}: {
  product?: ProductRow | null;
  references: References;
  fields?: (UserfieldDefinition & { entity: string })[];
  user_settings?: UserSettings;
  config?: JsonObject;
  options?: {
    references: Record<string, number[]>;
    parent_disabled: boolean;
    conversions: JsonObject[];
  };
}) {
  return {
    mode: product === null ? "create" : "edit",
    product,
    references,
    options: options ?? {
      references: {
        location_id: references.locations.map((row) => row.id),
        default_consume_location_id: references.locations.map((row) => row.id),
        shopping_location_id: references.shopping_locations.map((row) => row.id),
        product_group_id: references.product_groups.map((row) => row.id),
        parent_product_id: references.products.map((row) => row.id),
        qu_id_stock: references.quantity_units.map((row) => row.id),
        qu_id_purchase: references.quantity_units.map((row) => row.id),
        qu_id_consume: references.quantity_units.map((row) => row.id),
        qu_id_price: references.quantity_units.map((row) => row.id),
      },
      parent_disabled: false,
      conversions: [],
    },
    fields,
    user_settings,
    config,
    locale: "en",
  };
}
