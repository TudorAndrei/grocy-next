import { uploadId } from "@/lib/upload-id";
import { z } from "zod";
import { filePath, request } from "./api";

export const shoppingSearchSchema = z.object({
  list: z.coerce.number().int().optional().catch(undefined),
});

export type ShoppingSearch = z.infer<typeof shoppingSearchSchema>;

const fieldSchema = z.object({
  id: z.number(),
  name: z.string(),
  caption: z.string(),
  type: z.string(),
  input_required: z.number(),
  default_value: z.string().nullable(),
  config: z.string().nullable(),
});

export const shoppingEditorSchema = z.object({
  list: z.object({ id: z.number(), name: z.string() }).nullable(),
  fields: z.array(fieldSchema),
  values: z.record(z.string(), z.string().nullable()),
});

export type UserfieldDefinition = z.infer<typeof fieldSchema>;

export type FieldEdit = {
  value: string;
  dirty: boolean;
  upload?: { name: string; file: File };
  remove?: string;
};

export type FieldEdits = Record<string, FieldEdit>;

export type ShoppingListSummary = {
  id: number;
  name: string;
  description: string | null;
  item_count: number;
};

function cleanFileName(name: string) {
  return name
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/\s+/g, "")
    .replace(/[^\p{ASCII}]/gu, "");
}

export function userfieldUpload(file: File) {
  const original = cleanFileName(file.name);
  const name = `${uploadId()}.${cleanFileName(file.name.split(".").at(-1) ?? "")}`;

  return { value: `${btoa(name)}_${btoa(original)}`, upload: { file, name }, dirty: true };
}

export function userfieldFile(value: string) {
  const [source, display = ""] = value.split("_");

  try {
    return { name: atob(source), display: atob(display) };
  } catch {
    return { name: value, display: value };
  }
}

export function initialUserfields(
  fields: UserfieldDefinition[],
  values: Record<string, string | null>,
  creating: boolean,
): FieldEdits {
  return Object.fromEntries(
    fields.map((field) => {
      let value = creating ? "" : (values[field.name] ?? "");

      if (
        creating &&
        field.default_value === "now" &&
        (field.type === "date" || field.type === "datetime")
      ) {
        const date = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

        if (field.type === "datetime")
          value += ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      }

      return [field.name, { value, dirty: false }];
    }),
  );
}

export async function saveUserfields(
  entity: string,
  id: number,
  fields: UserfieldDefinition[],
  edits: FieldEdits,
  onSaved: (name: string, edit: FieldEdit) => void,
) {
  for (const field of fields) {
    const edit = edits[field.name];

    if (!edit?.dirty) continue;
    await request(`/api/userfields/${encodeURIComponent(entity)}/${id}`, {
      method: "PUT",
      body: JSON.stringify({ [field.name]: edit.value }),
    });

    if (edit.remove) {
      await request(filePath("userfiles", edit.remove), { method: "DELETE" });
      onSaved(field.name, { value: edit.value, dirty: true, upload: edit.upload });
    }

    if (edit.upload)
      await request(filePath("userfiles", edit.upload.name), {
        method: "PUT",
        body: edit.upload.file,
      });
    onSaved(field.name, { value: edit.value, dirty: false });
  }
}

export async function shoppingEditor(id?: number) {
  return shoppingEditorSchema.parse(
    await request(`/api/v2/shopping-lists/editor${id === undefined ? "" : `?list_id=${id}`}`),
  );
}

export const shoppingListsQuery = {
  queryKey: ["shopping-lists"] as const,
  queryFn: () => request<ShoppingListSummary[]>("/api/v2/shopping-lists"),
};

export const shoppingItemEditorSchema = z.object({
  item: z
    .object({
      id: z.number(),
      shopping_list_id: z.number(),
      product_id: z.number().nullable(),
      amount: z.number(),
      qu_id: z.number().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
  lists: z.array(z.object({ id: z.number(), name: z.string() })),
  products: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      qu_id_stock: z.number(),
      qu_id_purchase: z.number(),
    }),
  ),
  units: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      name_plural: z.string().nullable(),
      plural_forms: z.string().nullable().optional(),
    }),
  ),
  conversions: z.array(
    z.object({
      product_id: z.number(),
      from_qu_id: z.number(),
      to_qu_id: z.number(),
      factor: z.coerce.number(),
      to_qu_name: z.string(),
      to_qu_name_plural: z.string().nullable(),
    }),
  ),
  fields: z.array(fieldSchema),
  values: z.record(z.string(), z.string().nullable()),
});

export type ShoppingItemEditor = z.infer<typeof shoppingItemEditorSchema>;

export async function shoppingItemEditor(itemId?: number) {
  return shoppingItemEditorSchema.parse(
    await request(
      `/api/v2/shopping-lists/items/editor${itemId === undefined ? "" : `?item_id=${itemId}`}`,
    ),
  );
}
