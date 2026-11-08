import { saveCustomObjectFields } from "./custom-object-form";
import { userfieldUpload, type FieldEdits, type UserfieldDefinition } from "./userfields";

/** Capture native field values when their host reaches the UserfieldsForm.Save stage. */
export async function saveNativeObjectFields({
  namespace,
  id,
  fields,
  readEdits,
  fileError,
  signal,
  settled,
}: {
  namespace: string;
  // Native User create leaves EditObjectId undefined after its primary204.
  id: number | string | undefined;
  fields: UserfieldDefinition[];
  readEdits: () => FieldEdits;
  fileError: (error: Error) => void;
  signal: AbortSignal;
  settled: () => void;
}): Promise<void> {
  signal.throwIfAborted();

  const edits = Object.fromEntries(
    Object.entries(readEdits()).map(([name, edit]) => {
      const file = edit.readFile ? edit.readFile() : edit.upload?.file;

      return [name, file && edit.dirty ? { ...edit, ...userfieldUpload(file) } : edit];
    }),
  );

  const dirty = fields.filter((field) => edits[field.name]?.dirty);

  // Earlier callbacks can settle after the last one has replaced their document.
  const jobs = dirty.map((field) =>
    saveCustomObjectFields(namespace, id, [field], edits, () => {}, fileError, signal).finally(
      settled,
    ),
  );

  for (const job of jobs.slice(0, -1)) void job.catch(() => {});
  await jobs.at(-1);
  signal.throwIfAborted();
}
