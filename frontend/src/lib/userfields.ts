import { uploadId } from "@/lib/upload-id";
import { z } from "zod";
import { filePath, request } from "./api";

export const userfieldSchema = z.object({
  id: z.number(),
  name: z.string(),
  caption: z.string(),
  type: z.string(),
  input_required: z.number(),
  default_value: z.string().nullable(),
  config: z.string().nullable(),
});

const customFieldsSchema = z.array(
  userfieldSchema.extend({
    entity: z.string(),
    sort_number: z.union([z.number(), z.string()]).nullable().optional(),
    show_as_column_in_tables: z.number().optional(),
  }),
);

export const userfieldsQuery = {
  queryKey: ["entity-manager-userfields"],
  // SQL must sort before PDO turns stored empty TEXT into null, losing its storage class.
  queryFn: async ({ signal }: { signal: AbortSignal }) =>
    customFieldsSchema.parse(await request("/api/v2/custom-data/fields", { signal })),
};

export type UserfieldDefinition = z.infer<typeof userfieldSchema>;

export type FieldEdit = {
  value: string;
  // A native single select without a selected option serializes as null.
  nativeValue?: string | null;
  dirty: boolean;
  upload?: { name: string; file: File };
  readFile?: () => File | undefined;
  remove?: string;
};

export type FieldEdits = Record<string, FieldEdit>;

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
  id: number | string,
  fields: UserfieldDefinition[],
  edits: FieldEdits,
  onSaved: (name: string, edit: FieldEdit) => void,
  signal?: AbortSignal,
) {
  for (const field of fields) {
    signal?.throwIfAborted();
    const edit = edits[field.name];

    if (!edit?.dirty) continue;
    await request(
      `/api/userfields/${encodeURIComponent(entity)}/${encodeURIComponent(String(id))}`,
      {
        method: "PUT",
        body: JSON.stringify({ [field.name]: edit.value }),
        signal,
      },
    );
    signal?.throwIfAborted();

    if (edit.remove) {
      await request(filePath("userfiles", edit.remove), { method: "DELETE", signal });
      signal?.throwIfAborted();
      onSaved(field.name, { value: edit.value, dirty: true, upload: edit.upload });
    }

    if (edit.upload)
      await request(filePath("userfiles", edit.upload.name), {
        method: "PUT",
        body: edit.upload.file,
        signal,
      });
    signal?.throwIfAborted();
    onSaved(field.name, { value: edit.value, dirty: false });
  }
}
