import { z } from "zod";
import Translator from "gettext-translator/src/translator.js";
import { vsprintf } from "sprintf-js";

const catalogSchema = z.object({
  domain: z.string(),
  "plural-forms": z.string().nullable(),
  messages: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
});

export const localizationSchema = z.object({
  locale: z.string(),
  direction: z.enum(["ltr", "rtl"]),
  languages: z.array(z.string()),
  catalog: catalogSchema,
});

export type Localization = z.infer<typeof localizationSchema>;

export function createTranslations(catalog: z.infer<typeof catalogSchema>) {
  const translator = new Translator(catalog);

  function format(message: string, values: Array<string | number>) {
    try {
      return vsprintf(message, values);
    } catch {
      // The legacy browser helper retains the translated text when formatting fails.
      return message;
    }
  }

  return {
    t: (message: string, ...values: Array<string | number>) =>
      format(translator.__(message, ...values), values),
    p: (context: string, message: string, ...values: Array<string | number>) =>
      format(translator.p__(context, message, ...values), values),
    n: (count: number, singular: string, plural = singular) => {
      const value = Math.abs(count);

      return format(translator.n__(singular, plural || singular, value, value), [
        value.toLocaleString(),
      ]);
    },
    pluralIndex: (count: number) => translator.getPluralIndex(undefined, Math.abs(count)),
  };
}

export const englishTranslations = createTranslations({
  domain: "grocy/strings",
  "plural-forms": null,
  messages: { "": {} },
});
