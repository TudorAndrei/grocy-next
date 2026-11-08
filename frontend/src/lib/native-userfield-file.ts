/** Table labels use PHP's non-strict base64 decode, independently of the internal token. */
export function nativeUserfieldFileDisplay(
  value: string,
  context: "text" | "attribute" = "text",
): string {
  let encoded = (value.split("_")[1] ?? "").replace(/[^A-Za-z0-9+/]/g, "");

  if (encoded.length % 4 === 1) encoded = encoded.slice(0, -1);

  const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  // Source HTML keeps a BOM and normalizes CRs; NUL handling differs by context.
  return new TextDecoder("utf-8", { ignoreBOM: true })
    .decode(bytes)
    .replace(/\r\n?/g, "\n")
    .replaceAll("\0", context === "attribute" ? "\uFFFD" : "");
}
