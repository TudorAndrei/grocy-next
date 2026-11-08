import { z } from "zod";
import { request } from "./api";
import type { JsonObject, JsonValue } from "./json";

const objectSchema = z.record(z.string(), z.json());

function enabled(value: JsonValue | undefined): boolean {
  return value !== false && value !== null && value !== 0 && value !== "" && value !== "0";
}

function formData(payload: JsonObject): string {
  const values: string[] = [];
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");

  const add = (name: string, value: JsonValue | undefined) => {
    values.push(`${encode(name)}=${encode(value == null ? "" : String(value))}`);
  };

  function append(name: string, value: JsonValue | undefined): void {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (name.endsWith("[]")) add(name, item);
        else {
          const suffix =
            Array.isArray(item) || objectSchema.safeParse(item).success ? String(index) : "";

          append(`${name}[${suffix}]`, item);
        }
      }

      return;
    }

    const object = objectSchema.safeParse(value);

    if (object.success) {
      for (const [key, item] of Object.entries(object.data)) append(`${name}[${key}]`, item);
    } else add(name, value);
  }

  for (const [name, value] of Object.entries(payload)) append(name, value);

  return values.join("&");
}

export async function printLabel(
  path: string,
  config: JsonObject,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const payload = objectSchema.parse(await request<JsonValue>(path, { signal }));
  signal?.throwIfAborted();

  await postLabelWebhook(payload, config, signal);
}

/** Native print actions supply no error callback for their label GET. */
export async function printNativeLabel(
  path: string,
  config: JsonObject,
  onWebhookError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  let payload: JsonObject;

  try {
    payload = objectSchema.parse(await request<JsonValue>(path, { signal }));
  } catch {
    return;
  }

  if (signal?.aborted) return;

  try {
    await postLabelWebhook(payload, config, signal);
  } catch (error) {
    if (!signal?.aborted && error instanceof Error) onWebhookError(error);
  }
}

/** Send an existing snapshot without reading mutable label data from the API. */
export async function postLabelWebhook(
  payload: JsonObject,
  config: JsonObject,
  signal?: AbortSignal,
): Promise<void> {
  if (config.LABEL_PRINTER_RUN_SERVER === undefined || enabled(config.LABEL_PRINTER_RUN_SERVER))
    return;

  const hook = z.string().parse(config.LABEL_PRINTER_WEBHOOK ?? "");
  const parameters = objectSchema.parse(config.LABEL_PRINTER_PARAMS ?? {});
  const data = { ...payload, ...parameters };

  const json =
    config.LABEL_PRINTER_HOOK_JSON === undefined || enabled(config.LABEL_PRINTER_HOOK_JSON);

  const response = await fetch(hook, {
    method: "POST",
    headers: {
      "Content-Type": json
        ? "application/json"
        : "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: json ? JSON.stringify(data) : formData(data),
    signal,
  });

  if (!response.ok) throw new Error("Error while executing WebHook");
}
