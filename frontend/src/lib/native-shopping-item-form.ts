import type { QueryClient } from "@tanstack/react-query";
import Translator from "gettext-translator/src/translator.js";
import { vsprintf } from "sprintf-js";

/** The quantity domain formats bare placeholders before the outer native sprintf. */
export function nativeShoppingReceiptUnit(
  units: readonly { name: string; plural_forms?: string | null }[],
  singular: string,
  plural: string | null,
  count: number,
  pluralIndex: (count: number) => number,
) {
  if (!singular) return "";

  // The shopping context contains active units, as does LocalizationStringsQu.
  const catalog = {
    domain: "grocy/quantity_units",
    "plural-forms": null,
    fn: pluralIndex,
    messages: {
      "": Object.fromEntries(
        units.map((unit) => [
          unit.name,
          [unit.name, ...(unit.plural_forms ?? "").split(/\r\n|\r|\n/)],
        ]),
      ),
    },
  };

  const translator = new Translator(catalog);
  const amount = Math.abs(count);

  return vsprintf(translator.n__(singular, plural || singular, amount, amount), [
    amount.toLocaleString(),
  ]);
}

/** Native completion never waits for active lists or independent field writes. */
export function invalidateNativeShoppingItem(client: QueryClient) {
  for (const queryKey of [
    ["shopping"],
    ["shopping-lists"],
    ["shopping-item-editor"],
    ["objects", "shopping_list"],
    ["objects", "product_barcodes"],
    ["objects", "product_barcodes_view"],
    ["entity-manager", "shopping_list"],
    ["entity-manager", "product_barcodes"],
    ["product-related"],
    ["product-barcode-form"],
    ["product-overview"],
    ["native-products"],
    ["stock"],
    ["recipe-fulfillment"],
    ["recipe-view"],
    ["recipe-overview"],
    ["mealplan-calendar"],
  ])
    void client.invalidateQueries({ queryKey, refetchType: "none" });
}
