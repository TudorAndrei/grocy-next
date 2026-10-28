import { z } from "zod";

const choice = z.object({ id: z.number(), name: z.string().nullable() });

export const stockJournalSchema = z.object({
  products: z.array(choice),
  locations: z.array(choice),
  users: z.array(choice),
  transaction_types: z.array(z.string()),
  rows: z.array(
    z.object({
      id: z.number(),
      product_id: z.number(),
      product_name: z.string().nullable(),
      amount: z.number(),
      qu_name: z.string().nullable(),
      qu_name_plural: z.string().nullable(),
      row_created_timestamp: z.string().nullable(),
      transaction_type: z.string().nullable(),
      location_id: z.number(),
      location_name: z.string().nullable(),
      user_display_name: z.string().nullable(),
      note: z.string().nullable(),
      stock_id: z.string(),
      spoiled: z.number(),
      undone: z.number(),
      undone_timestamp: z.string().nullable(),
      correlation_id: z.string().nullable(),
      custom_values: z.record(z.string(), z.string().nullable()),
    }),
  ),
});

export const stockJournalSearch = z.object({
  product: z.coerce.string().optional().catch(undefined),
  months: z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
});

export type JournalSearch = z.infer<typeof stockJournalSearch>;

export type JournalRow = z.infer<typeof stockJournalSchema>["rows"][number];

export const stockSummarySearch = z.object({
  product_id: z.coerce.string().optional().catch(undefined),
  user_id: z.coerce.string().optional().catch(undefined),
  transaction_type: z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
});

export const stockSummarySchema = z.object({
  products: z.array(choice),
  users: z.array(choice),
  transaction_types: z.array(z.string()),
  rows: z.array(
    z.object({
      product_id: z.number(),
      product_name: z.string().nullable(),
      user_id: z.number(),
      user_display_name: z.string().nullable(),
      transaction_type: z.string().nullable(),
      amount: z.number(),
      qu_name: z.string().nullable(),
      qu_name_plural: z.string().nullable(),
    }),
  ),
});

export type SummarySearch = z.infer<typeof stockSummarySearch>;
