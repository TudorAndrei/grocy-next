import { vi } from "vitest";
import { z } from "zod";

// Other form owners allow their fixture catalog IDs. The selection owner supplies
// explicit native option sets and checks the restrictions separately.
export function supportProductOptions() {
  const transport = globalThis.fetch;
  const rows = z.array(z.object({ id: z.number() }));

  const conversions = z.array(
    z.object({
      product_id: z.number(),
      from_qu_id: z.number(),
      to_qu_id: z.number(),
      factor: z.number(),
    }),
  );

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://test.invalid");
    const match = /^(.*)\/api\/v2\/products\/form-options$/.exec(url.pathname);

    if (!match) return transport(input, init);

    const tables = [
      "locations",
      "shopping_locations",
      "product_groups",
      "products",
      "quantity_units",
    ];

    const entries = await Promise.all(
      tables.map(async (table) => {
        const response = await transport(`${match[1]}/api/objects/${table}`, {
          headers: init?.headers,
        });

        return [table, rows.parse(await response.json()).map((row) => row.id)] as const;
      }),
    );

    const ids = Object.fromEntries(entries);

    const response = await transport(`${match[1]}/api/objects/quantity_unit_conversions_resolved`, {
      headers: init?.headers,
    });

    return Response.json({
      parent_disabled: false,
      references: {
        location_id: ids.locations,
        default_consume_location_id: ids.locations,
        shopping_location_id: ids.shopping_locations,
        product_group_id: ids.product_groups,
        parent_product_id: ids.products,
        qu_id_stock: ids.quantity_units,
        qu_id_purchase: ids.quantity_units,
        qu_id_consume: ids.quantity_units,
        qu_id_price: ids.quantity_units,
      },
      conversions: conversions
        .parse(await response.json())
        .filter((row) => row.product_id === Number(url.searchParams.get("product_id"))),
    });
  });
}
