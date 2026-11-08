import { z } from "zod";
import { request } from "./api";
import type { JsonValue } from "./json";
import { compareSqliteNames } from "./collation";
import { userfieldValuesSchema } from "./userfield-values";

export const equipmentRecordSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  instruction_manual_file_name: z.string().nullable(),
  userfields: userfieldValuesSchema.nullable().optional().default(null),
});

export type EquipmentRecord = z.infer<typeof equipmentRecordSchema>;

export async function getEquipmentRecords(signal?: AbortSignal): Promise<EquipmentRecord[]> {
  return z
    .array(equipmentRecordSchema)
    .parse(await request("/api/objects/equipment", { signal }))
    .sort((left, right) => compareSqliteNames(left.name ?? "", right.name ?? ""));
}

export function getEquipmentDetailResponse(id: number, signal?: AbortSignal): Promise<JsonValue> {
  return request<JsonValue>(`/api/objects/equipment/${id}`, { signal });
}

export function decodeEquipmentDetail(response: JsonValue) {
  return equipmentRecordSchema.parse(response);
}

/** Only returned legacy definition names participate in the native file callback. */
export function decodeEquipmentFileDefinitions(response: JsonValue) {
  return z.array(z.object({ name: z.string() })).parse(response);
}
