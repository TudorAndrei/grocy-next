/** The pinned GetUriParam distinguishes a bare flag from an explicitly empty value. */
export function nativeQueryFlag(search: string, name: string) {
  return Boolean(nativeQueryParameter(search, name));
}

/** Native GetUriParam preserves the first raw-key match and a bare flag's boolean value. */
export function nativeQueryParameter(search: string, name: string): string | true | undefined {
  for (const part of search.replace(/^\?/, "").split("&")) {
    const [key, value] = part.split("=");

    if (key === name) return value === undefined ? true : decodeURIComponent(value);
  }

  return undefined;
}

/** Top-level PHP query-key presence; browser GetUriParam intentionally uses the raw matcher above. */
export function nativeQueryParameterPresent(search: string, name: string) {
  return Array.from(new URLSearchParams(search).keys()).some((key) => {
    const trimmed = key.replace(/^ +/, "");
    const bracket = trimmed.indexOf("[");
    const base = (bracket < 0 ? trimmed : trimmed.slice(0, bracket)).replace(/[ .]/g, "_");

    if (!base) return false;

    if (bracket < 0) return base === name;

    const remaining = trimmed.slice(bracket + 1);

    // A valid first bracket registers its base even if a later nested bracket is malformed.
    if (remaining.includes("]")) return base === name;

    // PHP turns an unclosed first bracket into an underscore in the top-level key.
    return base + "_" + remaining.replace(/[ .]/g, "_").replaceAll("[", "_") === name;
  });
}
