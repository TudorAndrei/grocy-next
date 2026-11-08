import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";
import { DescriptionEditor } from "@/components/DescriptionEditor";

function mount() {
  let reads = 0;
  const change = vi.fn<(html: string) => void>();
  const ready = vi.fn<(value: boolean) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => {
      reads++;

      return new Response(
        "<!doctype html><html><body><textarea id='description'></textarea></body></html>",
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Editor({ pasteHtml }: { pasteHtml?: string }) {
    const [value, setValue] = useState("<p>Typed draft</p>");

    return (
      <DescriptionEditor
        entity="products"
        value={value}
        pasteHtml={pasteHtml}
        onChange={(html) => {
          change(html);
          setValue(html);
        }}
        onReady={ready}
      />
    );
  }

  const view = (pasteHtml?: string) => (
    <QueryClientProvider client={client}>
      <Editor pasteHtml={pasteHtml} />
    </QueryClientProvider>
  );

  const app = render(view());
  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return { ...app, client, change, ready, view, reads: () => reads };
}

async function bootEditor() {
  const frame = await screen.findByTitle<HTMLIFrameElement>("Description");
  const transport = frame.contentWindow!;

  const child = new JSDOM(frame.srcdoc, {
    url: "http://editor.invalid/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  const browser = child.window;
  Object.defineProperty(browser, "parent", { value: window });
  // Supply missing layout/font APIs only; all rich-text parsing and insertion is upstream.
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
  vi.spyOn(transport, "postMessage").mockImplementation((data) => {
    queueMicrotask(() =>
      browser.dispatchEvent(new browser.MessageEvent("message", { data, source: window })),
    );
  });
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent("message", { data, source: transport, origin: "null" }),
      ),
    );
  });
  const assets = resolve("../backend/src/grocy");

  for (const name of ["jquery.min.js", "bootstrap.bundle.min.js", "summernote.min.js"])
    browser.eval(readFileSync(resolve(assets, "_vendor/summernote", name), "utf8"));
  browser.eval(readFileSync(resolve(assets, "domains/content_editor.js"), "utf8"));
  onTestFinished(() => browser.close());

  const initialize = () =>
    browser.eval(`window.initializeRichTextEditor({
    initial:'<p>Typed draft</p>',locale:'en-US',label:'Description',sourceLabel:'Code view',
    channel:'grocy-description'
  })`);

  return { browser, frame, initialize };
}

test("late copy pastes at the current cursor in the existing editor and accepts only its parent", async () => {
  const app = mount();
  const { browser, frame, initialize } = await bootEditor();
  await act(async () => initialize());
  await waitFor(() => expect(app.ready).toHaveBeenLastCalledWith(true));
  browser.eval(`
    var editor = jQuery('#description');
    editor.summernote('focus');
    var text = document.querySelector('.note-editable p').firstChild;
    var cursor = document.createRange(); cursor.setStart(text, 6); cursor.collapse(true);
    var selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(cursor);
    editor.summernote('editor.setLastRange');
  `);
  await act(async () => {
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: browser,
        data: { channel: "grocy-description", command: "paste", html: "Foreign" },
      }),
    );
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: window,
        data: { channel: "wrong", command: "paste", html: "Wrong channel" },
      }),
    );
  });
  expect(app.change).not.toHaveBeenCalled();
  app.rerender(app.view("<strong>Copied</strong>"));
  await waitFor(() =>
    expect(app.change).toHaveBeenLastCalledWith("<p>Typed <strong>Copied</strong>draft</p>"),
  );
  expect(screen.getByTitle("Description")).toBe(frame);
  expect(app.reads()).toBe(1);
  expect(browser.document.querySelector(".note-editable")?.textContent).toBe("Typed Copieddraft");
});

test("copy waits for ready, posts once, and is not replayed on editor document replacement or after departure", async () => {
  const app = mount();
  const { frame, initialize } = await bootEditor();
  const post = vi.mocked(frame.contentWindow!.postMessage);
  app.rerender(app.view("<em>Queued copy</em>"));
  expect(post.mock.calls.filter(([data]) => data.command === "paste")).toHaveLength(0);
  await act(async () => initialize());
  await waitFor(() =>
    expect(post.mock.calls.filter(([data]) => data.command === "paste")).toHaveLength(1),
  );
  app.rerender(app.view("<em>Queued copy</em>"));
  await act(async () => {
    await app.client.refetchQueries({ queryKey: ["description-editor"] });
  });
  expect(app.reads()).toBe(2);
  await waitFor(() => expect(screen.getByTitle("Description")).not.toBe(frame));
  const next = screen.getByTitle<HTMLIFrameElement>("Description");
  const nextPost = vi.spyOn(next.contentWindow!, "postMessage");
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: next.contentWindow,
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
    ),
  );
  expect(nextPost.mock.calls.filter(([data]) => data.command === "paste")).toHaveLength(0);
  const changes = app.change.mock.calls.length;
  app.unmount();
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: next.contentWindow,
        origin: "null",
        data: {
          channel: "grocy-description",
          kind: "change",
          html: "Departed",
          empty: false,
          height: 390,
          fullscreen: false,
        },
      }),
    ),
  );
  expect(app.change).toHaveBeenCalledTimes(changes);
});
