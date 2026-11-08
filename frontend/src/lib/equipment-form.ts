import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";

const equipment = z.object({
  id: z.number(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  instruction_manual_file_name: z.string().nullable(),
});

export type EquipmentRecord = z.infer<typeof equipment>;

export type EquipmentPayload = {
  name: string;
  description: string;
  instruction_manual_file_name?: string | null;
};

export async function getEquipmentRecord(id: number, signal?: AbortSignal) {
  return equipment.parse(await request(`/api/objects/equipment/${id}`, { signal }));
}

/** The native equipment form makes the manual name when Save is clicked. */
export function equipmentManualFilename(file: File) {
  const random =
    Math.random().toString(36).substring(2, 100) + Math.random().toString(36).substring(2, 100);

  const clean = file.name
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/\s+/g, "")
    .replace(/[^\p{ASCII}]/gu, "");

  return random + clean;
}

export async function invalidateEquipment(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["equipment"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["equipment-page"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["objects", "equipment"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["equipment-editor"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["equipment-editor-fields"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["entity-manager", "equipment"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["content", "equipment"], refetchType: "none" }),
  ]);
}
