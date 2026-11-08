import { z } from "zod";
import { request } from "./api";
import { nativeQueryParameter } from "./native-query-flag";

export const aboutContextSchema = z.object({
  system_info: z
    .object({
      grocy_version: z.object({ Version: z.string(), ReleaseDate: z.string() }),
      php_version: z.string(),
      python_version: z.string(),
      sqlite_version: z.string(),
      db_version: z.number().nullable(),
      os: z.string(),
      client: z.string(),
    })
    .passthrough(),
  changelog: z.object({
    newest_release_number: z.number(),
    changelog_items: z.array(
      z.object({
        release_number: z.number(),
        version: z.string(),
        release_date: z.string(),
        body_html: z.string(),
      }),
    ),
  }),
});

export type AboutContext = z.infer<typeof aboutContextSchema>;

export type ChangelogRelease = AboutContext["changelog"]["changelog_items"][number];

export async function getAboutContext(signal?: AbortSignal) {
  return aboutContextSchema.parse(await request("/api/v2/system/about", { signal }));
}

export function initialAboutTab(search: string): "system-info" | "changelog" {
  try {
    return nativeQueryParameter(search, "tab") === "changelog" ? "changelog" : "system-info";
  } catch {
    // The native script fails after the default System info markup is already visible.
    return "system-info";
  }
}
