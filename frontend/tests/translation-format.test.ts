import { expect, test } from "vitest";
import { createTranslations } from "@/lib/localization";
import { unitLabel } from "@/lib/format";

const text = createTranslations({
  domain: "grocy/strings",
  "plural-forms":
    "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  messages: {
    "": {
      "%s product": ["%s товар", "%s товара", "%s товаров"],
      "%1$s at %2$s": ["%2$s: %1$s"],
      Missing: [""],
    },
    action: { Open: ["Открыть"] },
    state: { Open: ["Открыто"] },
  },
});

test.each([
  [1, "1 товар"],
  [2, "2 товара"],
  [5, "5 товаров"],
  [21, "21 товар"],
  [-2, "2 товара"],
])("legacy plural rules select the form for %s", (count, expected) => {
  expect(text.n(Number(count), "%s product", "%s products")).toBe(expected);
});

test("translation contexts and positional parameters use the legacy formatter", () => {
  expect(text.p("action", "Open")).toBe("Открыть");
  expect(text.p("state", "Open")).toBe("Открыто");
  expect(text.t("%1$s at %2$s", "Milk", "Fridge")).toBe("Fridge: Milk");
  expect(text.t("Missing")).toBe("Missing");
  expect(text.t("Unknown %s", "Milk")).toBe("Unknown Milk");
  expect(text.t("Invalid %q", "Milk")).toBe("Invalid %q");
  expect(text.t("%1$s, %2$s%% of minimum", "Milk", 200)).toBe("Milk, 200% of minimum");
});

test.each([
  [1, "штука"],
  [2, "штуки"],
  [5, "штук"],
  [21, "штука"],
  [-2, "штуки"],
])("quantity units use the saved forms for %s", (count, expected) => {
  const unit = { name: "штука", name_plural: "pieces", plural_forms: "штуки\r\nштук" };

  expect(unitLabel(unit, Number(count), text.pluralIndex)).toBe(expected);
});

test("an empty quantity-unit form uses the saved plural name", () => {
  const unit = { name: "штука", name_plural: "pieces", plural_forms: "штуки\n" };

  expect(unitLabel(unit, 5, text.pluralIndex)).toBe("pieces");
  expect(unitLabel({ ...unit, active: 0 }, 2, text.pluralIndex)).toBe("pieces");
});
