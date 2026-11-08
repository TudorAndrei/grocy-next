import { vsprintf } from "sprintf-js";

type Unit = {
  name: string | null;
  name_plural: string | null;
  plural_forms: string | null;
  active: number;
};

/** The pinned browser quantity domain, including its throwing sprintf behavior. */
export function nativeQuantityUnit(
  unit: Unit,
  amount: number,
  pluralIndex: (count: number) => number,
) {
  if (!unit.name) return "";
  const count = Math.abs(amount);
  const index = unit.active === 1 ? pluralIndex(count) : count === 1 ? 0 : 1;
  const forms = [unit.name, ...(unit.plural_forms ?? "").split(/\r\n|\r|\n/)];

  const label =
    unit.active === 1 && forms[index]
      ? forms[index]!
      : index === 0
        ? unit.name
        : unit.name_plural || unit.name;

  return vsprintf(label, [count.toLocaleString()]);
}
