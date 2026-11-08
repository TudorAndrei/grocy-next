import { z } from "zod";

const part = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .transform((value) =>
    value === null || value === false ? "" : value === true ? "1" : String(value),
  )
  .catch("");

const titledLink = z.object({ title: part, link: part });

/** Native table anchors exist even when a present titled binding cannot be decoded. */
export function nativeUserfieldLink(type: "link" | "link-with-title", value: string | null) {
  if (type === "link") return { title: value ?? "", link: value ?? "" };

  try {
    const result = titledLink.safeParse(JSON.parse(value ?? ""));

    if (result.success) return result.data;
  } catch {
    // The source renders an empty anchor after a failed JSON decode.
  }

  return { title: "", link: "" };
}
