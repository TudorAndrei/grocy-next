import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { filePath, request } from "./api";
import type { FieldEdit, FieldEdits, UserfieldDefinition } from "./userfields";
import { userfieldValuesSchema } from "./userfield-values";

export const customObjectSearch = z
  .object({ embedded: z.string().optional().catch(undefined) })
  .passthrough();

export const userentitySchema = z.object({
  id: z.number(),
  name: z.string(),
  caption: z.string(),
  description: z.string().nullable(),
  show_in_sidebar_menu: z.number(),
  icon_css_class: z.string().nullable(),
});

export type UserentityRecord = z.infer<typeof userentitySchema>;

export async function getUserentity(id: number, signal?: AbortSignal) {
  return userentitySchema.parse(await request(`/api/objects/userentities/${id}`, { signal }));
}

export async function getUserobject(id: number, signal?: AbortSignal) {
  return z
    .object({ id: z.number(), userentity_id: z.number() })
    .parse(await request(`/api/objects/userobjects/${id}`, { signal }));
}

export async function getCustomObjectValues(
  namespace: string,
  id: number | string,
  signal?: AbortSignal,
) {
  const response = await request(`/api/userfields/${encodeURIComponent(namespace)}/${id}`, {
    signal,
  });

  signal?.throwIfAborted();

  return userfieldValuesSchema.parse(response);
}

export async function invalidateCustomObjects(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["custom-data-entities"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["custom-data-catalog"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["custom-data-objects"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["userentities"] }),
    client.invalidateQueries({ queryKey: ["objects", "userentities"] }),
    client.invalidateQueries({ queryKey: ["objects", "userobjects"] }),
  ]);
}

/** Native definition completion must not wait for active sidebar/list reads. */
export async function invalidateUserentityDefinitions(client: QueryClient) {
  await Promise.all(
    [
      ["custom-data-entities"],
      ["custom-data-catalog"],
      ["custom-data-objects"],
      ["userentity-editor"],
      ["objects", "userentities"],
      ["objects", "userobjects"],
      ["entity-manager", "userentities"],
    ].map((queryKey) => client.invalidateQueries({ queryKey, refetchType: "none" })),
  );
}

/** Native custom-object forms return when the last dirty field's callback finishes. */
export async function saveCustomObjectFields(
  namespace: string,
  id: number | string | undefined,
  fields: UserfieldDefinition[],
  edits: FieldEdits,
  onSaved: (name: string, edit: FieldEdit) => void,
  onFileError: (error: Error) => void,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const dirty = fields.filter((field) => edits[field.name]?.dirty);

  const saveField = async (field: UserfieldDefinition) => {
    signal?.throwIfAborted();
    const edit = edits[field.name]!;
    const fileField = field.type === "file" || field.type === "image";
    const selectedFile = fileField && Boolean(edit.readFile ? edit.readFile() : edit.upload);

    const metadata =
      !fileField || selectedFile
        ? {
            [field.name]:
              !fileField && edit.nativeValue !== undefined ? edit.nativeValue : edit.value,
          }
        : edit.remove
          ? { [field.name]: "" }
          : {};

    await request(`/api/userfields/${encodeURIComponent(namespace)}/${id}`, {
      method: "PUT",
      body: JSON.stringify(metadata),
      signal,
    });
    signal?.throwIfAborted();

    try {
      if (edit.remove !== undefined) {
        await request(filePath("userfiles", edit.remove), { method: "DELETE", signal });
        signal?.throwIfAborted();
        onSaved(field.name, {
          value: edit.value,
          dirty: true,
          upload: edit.upload,
          readFile: edit.readFile,
        });
      }

      if (edit.upload && selectedFile) {
        await request(filePath("userfiles", edit.upload.name), {
          method: "PUT",
          body: edit.readFile ? edit.readFile() : edit.upload.file,
          signal,
        });
        signal?.throwIfAborted();
      }
    } catch (error) {
      if (!signal?.aborted && error instanceof Error) onFileError(error);
      throw error;
    }

    onSaved(field.name, { value: edit.value, dirty: false });
  };

  const requests = dirty.map((field) => saveField(field));

  for (const request of requests.slice(0, -1)) void request.catch(() => {});
  await requests.at(-1);
}
