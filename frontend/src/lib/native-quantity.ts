function nativeNumberValue(value: string, minimum: number, maximum: number): string {
  const input = document.createElement("input");
  input.type = "number";
  input.value = value;

  if (!input.value) return "";

  return Number.parseFloat(input.value).toLocaleString("en", {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
    useGrouping: false,
  });
}

/** Numeric .val() sanitation followed by the pinned quantity locale refresh. */
export function nativeQuantityValue(value: string, precision: number): string {
  return nativeNumberValue(value, 0, precision);
}

/** Currency-class inputs use the input precision for both rounding and padding. */
export function nativeCurrencyValue(value: string, precision: number): string {
  return nativeNumberValue(value, precision, precision);
}
