declare module "jsdom" {
  export class JSDOM {
    constructor(
      html: string,
      options: { url: string; runScripts: "outside-only"; pretendToBeVisual: boolean },
    );
    readonly window: Window & typeof globalThis;
  }
}
