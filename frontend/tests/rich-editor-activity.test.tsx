import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";
import { DescriptionEditor } from "@/components/DescriptionEditor";
import { ShoppingNotes } from "@/components/ShoppingNotes";

type Kind = "description" | "notes";

type InteractionMessage = { channel: string; kind: "activity" | "dirty"; event: string };

async function mount(kind: Kind) {
  const html = "<!doctype html><html><body><textarea id='description'></textarea></body></html>";
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(html)),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const change = vi.fn();
  const ready = vi.fn();
  const activity = vi.fn();
  window.addEventListener("grocy-native-activity", activity);

  const app = render(
    <QueryClientProvider client={client}>
      <form aria-label="Unrelated form">
        <input aria-label="Unrelated field" />
      </form>
      {kind === "description" ? (
        <form aria-label="Product draft">
          <DescriptionEditor
            entity="products"
            value="<p>Draft</p>"
            onChange={change}
            onReady={ready}
          />
        </form>
      ) : (
        <ShoppingNotes
          listId={1}
          description="<p>Draft</p>"
          onDraft={change}
          initialDocument={html}
        />
      )}
    </QueryClientProvider>,
  );

  const frame = await screen.findByTitle<HTMLIFrameElement>(
    kind === "description" ? "Description" : "Notes",
  );

  const transport = frame.contentWindow!;

  const child = new JSDOM(frame.srcdoc, {
    url: "http://editor.invalid/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  const browser = child.window;
  Object.defineProperty(browser, "parent", { value: window });
  // JSDOM lacks layout/font rendering; execute the unchanged editor and upstream rich-text runtime.
  Object.assign(browser, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.assign(browser.document, { execCommand: () => false });
  Object.assign(browser.HTMLCanvasElement.prototype, {
    getContext: () => ({ clearRect() {}, fillText() {}, getImageData: () => ({ data: [] }) }),
  });
  Object.assign(browser.Range.prototype, {
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => [],
  });
  vi.spyOn(transport, "postMessage").mockImplementation((data) =>
    queueMicrotask(() =>
      browser.dispatchEvent(new browser.MessageEvent("message", { data, source: window })),
    ),
  );
  vi.spyOn(window, "postMessage").mockImplementation((data) =>
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent("message", { data, source: transport, origin: "null" }),
      ),
    ),
  );
  const assets = resolve("../backend/src/grocy");

  for (const file of ["jquery.min.js", "bootstrap.bundle.min.js", "summernote.min.js"])
    browser.eval(readFileSync(resolve(assets, "_vendor/summernote", file), "utf8"));
  browser.eval(readFileSync(resolve(assets, "domains/content_editor.js"), "utf8"));
  const channel = kind === "description" ? "grocy-description" : "grocy-shopping-notes";
  await act(async () =>
    browser.eval(
      `window.initializeRichTextEditor({initial:'<p>Draft</p>',locale:'en-US',label:'Editor',sourceLabel:'Code view',channel:'${channel}'})`,
    ),
  );

  if (kind === "description") await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true));
  onTestFinished(() => {
    app.unmount();
    client.clear();
    browser.close();
    window.removeEventListener("grocy-native-activity", activity);
  });

  return { ...app, frame, transport, browser, change, activity, channel };
}

test("rich editor forwards native idle events without treating contenteditable edits as a dirty form", async () => {
  const app = await mount("description");
  const rich = app.browser.document.querySelector<HTMLElement>(".note-editable")!;
  await act(async () => {
    for (const type of ["mousemove", "mousedown", "click"])
      rich.dispatchEvent(new app.browser.MouseEvent(type, { bubbles: true }));
    app.browser.dispatchEvent(new app.browser.Event("scroll"));
    rich.dispatchEvent(new app.browser.KeyboardEvent("keypress", { key: "a", bubbles: true }));
  });
  expect(app.activity).toHaveBeenCalledTimes(5);
  await act(async () => {
    rich.dispatchEvent(new app.browser.Event("scroll"));
    rich.dispatchEvent(new app.browser.KeyboardEvent("keyup", { key: "a", bubbles: true }));
    app.browser.eval("jQuery('#description').summernote('pasteHTML','<strong>Rich edit</strong>')");
  });
  expect(app.activity).toHaveBeenCalledTimes(5);
  expect(app.change).toHaveBeenCalled();
  expect(screen.getByRole("form", { name: "Product draft" }).classList.contains("is-dirty")).toBe(
    false,
  );
  await act(async () => {
    app.browser.eval("jQuery('#description').summernote('codeview.toggle')");
    app.browser.document
      .querySelector<HTMLTextAreaElement>(".note-codable")!
      .dispatchEvent(new app.browser.KeyboardEvent("keyup", { key: "x", bubbles: true }));
  });
  expect(app.frame.classList.contains("is-dirty")).toBe(true);
  expect(screen.getByRole("form", { name: "Product draft" }).classList.contains("is-dirty")).toBe(
    true,
  );
  expect(screen.getByRole("form", { name: "Unrelated form" }).classList.contains("is-dirty")).toBe(
    false,
  );
  expect(app.activity).toHaveBeenCalledTimes(5);
});

test("shopping notes forwards activity and codeview dirtiness without dirtying an unrelated parent form", async () => {
  const app = await mount("notes");
  await act(async () => {
    app.browser.eval("jQuery('#description').summernote('codeview.toggle')");
    const code = app.browser.document.querySelector<HTMLTextAreaElement>(".note-codable")!;
    code.dispatchEvent(new app.browser.Event("change", { bubbles: true }));
  });
  expect(app.frame.classList.contains("is-dirty")).toBe(true);
  expect(document.querySelector("form.is-dirty")).toBeNull();
  expect(app.activity).not.toHaveBeenCalled();
  await act(async () => app.browser.dispatchEvent(new app.browser.MouseEvent("mousemove")));
  expect(app.activity).toHaveBeenCalledOnce();
});

test.each<Kind>(["description", "notes"])(
  "%s accepts interaction messages only from its current opaque editor with an allowed event",
  async (kind) => {
    const app = await mount(kind);

    const post = (
      data: InteractionMessage,
      source: MessageEventSource | null = app.transport,
      origin = "null",
    ) => window.dispatchEvent(new MessageEvent("message", { data, source, origin }));

    await act(async () => {
      post({ channel: app.channel, kind: "activity", event: "mousemove" }, window);
      post(
        { channel: app.channel, kind: "dirty", event: "keyup" },
        app.transport,
        "https://foreign.invalid",
      );
      post({ channel: "foreign", kind: "activity", event: "mousemove" });
      post({ channel: app.channel, kind: "activity", event: "keyup" });
      post({ channel: app.channel, kind: "dirty", event: "mousemove" });
    });
    expect(app.activity).not.toHaveBeenCalled();
    expect(app.frame.classList.contains("is-dirty")).toBe(false);
    app.unmount();
    await act(async () => post({ channel: app.channel, kind: "activity", event: "mousemove" }));
    expect(app.activity).not.toHaveBeenCalled();
  },
);
