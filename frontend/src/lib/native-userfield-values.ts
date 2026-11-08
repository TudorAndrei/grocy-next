type Value = {
  object_id: string | number | null;
  name: string;
  value: string | null;
};

/** Collection APIs fill absent definitions with null; normal native writes cannot store null/empty. */
export function nativeObjectUserfieldPresent(
  values: Readonly<Record<string, string | null>> | null | undefined,
  name: string,
) {
  return Boolean(values && Object.hasOwn(values, name) && values[name] !== null);
}

function numeric(value: string) {
  const trimmed = value.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, "");

  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed) ? Number(trimmed) : undefined;
}

function sameName(left: string, right: string) {
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);

  return leftNumber !== undefined && rightNumber !== undefined
    ? leftNumber === rightNumber
    : left === right;
}

/** The native template filters IDs with PHP ==, then takes the first matching field. */
export function nativeUserfieldValues(
  fields: readonly { name: string }[],
  values: readonly Value[],
  id: number | null,
) {
  const entries: [string, string | null][] = [];

  if (id === null || fields.length === 0) return Object.fromEntries(entries);

  const matching = values.filter((row) => {
    const identity = row.object_id;

    const number = identity === null ? 0 : numeric(String(identity));

    return number === id;
  });

  for (const field of fields) {
    const value = matching.find((row) => sameName(row.name, field.name));

    if (value) entries.push([field.name, value.value]);
  }

  return Object.fromEntries(entries);
}
