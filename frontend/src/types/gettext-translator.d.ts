declare module "gettext-translator/src/translator.js" {
  type Catalog = {
    domain: string;
    "plural-forms": string | null;
    messages: Record<string, Record<string, string[]>>;
  };

  export default class Translator {
    constructor(catalog: Catalog);
    __(message: string, ...values: Array<string | number>): string;
    p__(context: string, message: string, ...values: Array<string | number>): string;
    n__(singular: string, plural: string, count: number, ...values: Array<string | number>): string;
    getPluralIndex(domain: string | undefined, count: number): number;
  }
}
