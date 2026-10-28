import { onTestFinished, vi } from "vitest";

// jsdom does not run the sandbox document. Unrelated form owners supply only
// the document-ready event; description behavior has its own message tests.
export function supportDescriptionEditors() {
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (
      init?.method === "POST" &&
      /\/api\/v2\/content\/(products|recipes|equipment)\/editor$/.test(String(input))
    )
      return Promise.resolve(new Response("<!doctype html><html><body>Editor</body></html>"));

    return transport(input, init);
  });
  const seen = new WeakSet<HTMLIFrameElement>();

  const observer = new MutationObserver(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      'iframe[title="Description"]',
    )) {
      if (seen.has(frame)) continue;
      seen.add(frame);
      setTimeout(() => {
        if (!frame.isConnected) return;
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            origin: "null",
            data: {
              channel: "grocy-description",
              kind: "ready",
              html: "",
              empty: true,
              height: 390,
              fullscreen: false,
            },
          }),
        );
      }, 0);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  onTestFinished(() => observer.disconnect());
}
