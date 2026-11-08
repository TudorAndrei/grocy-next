import { z } from "zod";

/** PHP serializes dense numeric field names as a list, including null placeholders. */
export const userfieldValuesSchema = z
  .record(z.string(), z.string().nullable())
  .or(
    z
      .array(z.string().nullable())
      .transform((values) =>
        Object.fromEntries(values.map((value, index) => [String(index), value])),
      ),
  );
