import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "@/components/UserfieldsEditor";
import { initialUserfields, type UserfieldDefinition } from "@/lib/userfields";
import { saveCustomObjectFields } from "@/lib/custom-object-form";
import {
  NativeScriptBindingsProvider,
  useNativeScriptBindings,
} from "@/lib/native-script-bindings";

function field(id: number, name: string, type = "text-single-line"): UserfieldDefinition {
  return { id, name, caption: name, type, input_required: 0, default_value: null, config: null };
}

function heldResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mount(
  fields: UserfieldDefinition[],
  response?: Promise<Response>,
  scope?: { physical: boolean; dateClear?: boolean },
) {
  const reads: string[] = [];
  const writes: { path: string; body: BodyInit | null | undefined; method: string }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);

    if (init?.method === "PUT" || init?.method === "DELETE") {
      writes.push({ path, body: init.body, method: init.method });

      return new Response(null, { status: 204 });
    }

    if (path.startsWith("/api/objects/userfields?")) {
      reads.push(path);

      return response ?? Response.json(fields);
    }

    throw new Error(`Unexpected fetch ${path}`);
  });

  function Editor() {
    const editor = useRef<UserfieldsEditorHandle>(null);
    const bindings = useNativeScriptBindings();
    const [values, setValues] = useState(() => initialUserfields(fields, {}, true));
    const [status, setStatus] = useState("");

    return (
      <>
        {scope?.dateClear ? (
          <button onClick={() => bindings?.clearDate()}>Clear native date</button>
        ) : null}
        <UserfieldsEditor
          ref={editor}
          fields={fields}
          values={values}
          creating
          disabled={false}
          nativeFiles
          onChange={(name, edit) => setValues((current) => ({ ...current, [name]: edit }))}
        />
        <button
          onClick={async () => {
            setStatus("Clearing");

            try {
              await editor.current?.clear("stock");
              setStatus("Cleared");
            } catch (error) {
              setStatus(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
            }
          }}
        >
          Clear fields
        </button>
        <button
          onClick={async () => {
            if (!editor.current) return;
            await saveCustomObjectFields(
              "stock",
              "next-transaction",
              fields,
              editor.current.snapshot(),
              () => {},
              () => {},
            );
            setStatus("Saved fields");
          }}
        >
          Save fields
        </button>
        <output>{status}</output>
      </>
    );
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const view = render(
    <QueryClientProvider client={client}>
      {scope ? (
        <NativeScriptBindingsProvider physical={scope.physical}>
          <Editor />
        </NativeScriptBindingsProvider>
      ) : (
        <Editor />
      )}
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    view.unmount();
    client.clear();
  });

  return { reads, writes, view };
}

function metadata(app: ReturnType<typeof mount>) {
  return app.writes
    .filter((write) => write.path.includes("/userfields/"))
    .map((write) => JSON.parse(String(write.body)));
}

test("native Clear waits for definitions, clears current controls, and retains dirty fields for the next transaction", async () => {
  const pending = heldResponse();

  const fields = [
    field(1, "Before"),
    field(2, "Accepted", "checkbox"),
    { ...field(3, "Choices", "preset-checklist"), config: "A\nB" },
    { ...field(4, "Recorded", "datetime"), default_value: "now" },
    field(5, "Untouched"),
    field(6, "After"),
  ];

  const app = mount(fields, pending.promise);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Before"), "First count");
  await user.click(screen.getByLabelText("Accepted"));
  await user.selectOptions(screen.getByLabelText("Choices"), ["A", "B"]);
  const recorded = screen.getByLabelText<HTMLInputElement>("Recorded");
  expect(recorded.value).not.toBe("");
  await user.click(screen.getByRole("button", { name: "Clear fields" }));
  expect(app.reads).toEqual(["/api/objects/userfields?query[]=entity=stock"]);
  expect(screen.getByLabelText<HTMLInputElement>("Before").value).toBe("First count");
  await user.type(screen.getByLabelText("After"), "Typed during reset");
  await act(async () => {
    pending.release(Response.json(fields));
  });
  await screen.findByText("Cleared");
  expect(screen.getByLabelText<HTMLInputElement>("Before").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("After").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Accepted").checked).toBe(false);
  expect([...screen.getByLabelText<HTMLSelectElement>("Choices").selectedOptions]).toEqual([]);
  expect(recorded.value).toBe("");
  await user.click(screen.getByRole("button", { name: "Save fields" }));
  await screen.findByText("Saved fields");
  expect(metadata(app)).toEqual([
    { Before: "" },
    { Accepted: "0" },
    { Choices: "" },
    { After: "" },
  ]);
});

test.each(["file", "image"])(
  "native %s Clear blanks the label, retains selected bytes, and stops at the missing value binding",
  async (type) => {
    const app = mount([
      field(1, "Before"),
      { ...field(2, "Attachment", type), input_required: 1 },
      field(3, "After"),
    ]);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Before"), "First");
    await user.type(screen.getByLabelText("After"), "Later");
    const input = screen.getByLabelText<HTMLInputElement>("Attachment");
    const upload = new File(["Selected document bytes"], "Count.txt", { type: "text/plain" });
    await user.upload(input, upload);
    expect(within(input.parentElement!).getByText("Count.txt")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear fields" }));
    await screen.findByText("ReferenceError: value is not defined");
    expect(screen.getByLabelText<HTMLInputElement>("Before").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("After").value).toBe("Later");
    expect(within(input.parentElement!).queryByText("Count.txt")).toBeNull();
    expect(input.files?.[0]).toBe(upload);
    expect(input.required).toBe(true);
    expect(within(input.parentElement!).queryByRole("button", { name: "Show" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save fields" }));
    await screen.findByText("Saved fields");
    expect(metadata(app)[0]).toEqual({ Before: "" });
    expect(metadata(app)[2]).toEqual({ After: "Later" });
    expect(app.writes.find((write) => write.path.includes("/files/"))?.body).toBe(upload);
  },
);

test("native link Clear stops at its missing data binding in the returned definition order", async () => {
  const fields = [field(1, "Before"), field(2, "Reference", "link-with-title"), field(3, "After")];
  const app = mount(fields, Promise.resolve(Response.json([fields[2], fields[1], fields[0]])));
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Before"), "First");
  await user.type(screen.getByLabelText("Title"), "Manual");
  await user.type(screen.getByLabelText("Link"), "https://example.test/manual");
  await user.type(screen.getByLabelText("After"), "Last");
  await user.click(screen.getByRole("button", { name: "Clear fields" }));
  await screen.findByText("ReferenceError: data is not defined");
  expect(screen.getByLabelText<HTMLInputElement>("Before").value).toBe("First");
  expect(screen.getByLabelText<HTMLInputElement>("After").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("Manual");
  await user.click(screen.getByRole("button", { name: "Save fields" }));
  await screen.findByText("Saved fields");
  expect(metadata(app)).toEqual([
    { Before: "First" },
    { Reference: JSON.stringify({ title: "Manual", link: "https://example.test/manual" }) },
    { After: "" },
  ]);
});

test.each(["external-document.txt", ""])(
  "native Clear resolves the real global file binding '%s' without inventing file or link errors",
  async (source) => {
    vi.stubGlobal("value", source);
    vi.stubGlobal("data", { title: "External title", link: "https://example.test/external" });

    const app = mount([
      { ...field(1, "Attachment", "file"), input_required: 1 },
      field(2, "Reference", "link-with-title"),
      field(3, "After"),
    ]);

    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>("Attachment");
    const upload = new File(["Same file"], "Keep.txt", { type: "text/plain" });
    await user.upload(input, upload);
    await user.type(screen.getByLabelText("Title"), "Draft");
    await user.type(screen.getByLabelText("After"), "Last");
    await user.click(screen.getByRole("button", { name: "Clear fields" }));
    await screen.findByText("Cleared");
    expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("External title");
    expect(screen.getByLabelText<HTMLInputElement>("Link").value).toBe(
      "https://example.test/external",
    );
    expect(screen.getByLabelText<HTMLInputElement>("After").value).toBe("");
    expect(input.files?.[0]).toBe(upload);
    expect(input.required).toBe(true);
    expect(
      within(input.parentElement!).getByRole("link", { name: "Show" }).getAttribute("href"),
    ).toBe(`/files/userfiles/${source}`);
    await user.click(screen.getByRole("button", { name: "Save fields" }));
    await screen.findByText("Saved fields");
    expect(metadata(app)[1]).toEqual({ Reference: "" });
    expect(app.writes.find((write) => write.path.includes("/files/"))?.body).toBe(upload);
  },
);

test("native Clear has no definition request when no userfield controls are rendered", async () => {
  const app = mount([]);
  await userEvent.click(screen.getByRole("button", { name: "Clear fields" }));
  await screen.findByText("Cleared");
  expect(screen.queryByRole("group", { name: "Userfields" })).toBeNull();
  expect(app.reads).toEqual([]);
});

test("retiring a physical date script restores its real external binding and logical siblings cannot inherit its owned publication", async () => {
  vi.stubGlobal("value", "external-parent.txt");
  const original = Object.getOwnPropertyDescriptor(globalThis, "value");
  const parent = mount([], undefined, { physical: true, dateClear: true });
  await userEvent.click(
    within(parent.view.container).getByRole("button", { name: "Clear native date" }),
  );
  expect(Object.getOwnPropertyDescriptor(globalThis, "value")?.value).toBe("");

  const child = mount([field(1, "Child attachment", "file"), field(2, "Child text")], undefined, {
    physical: false,
  });

  await userEvent.type(screen.getByLabelText("Child text"), "Draft");
  await userEvent.click(within(child.view.container).getByRole("button", { name: "Clear fields" }));
  await within(child.view.container).findByText("Cleared");
  expect(
    within(child.view.container).getByRole("link", { name: "Show" }).getAttribute("href"),
  ).toBe("/files/userfiles/external-parent.txt");
  expect(screen.getByLabelText<HTMLInputElement>("Child text").value).toBe("");
  expect(Object.getOwnPropertyDescriptor(globalThis, "value")?.value).toBe("");
  child.view.unmount();
  parent.view.unmount();
  expect(Object.getOwnPropertyDescriptor(globalThis, "value")).toEqual(original);
});

test("a fresh logical child cannot reuse a retired child's date value or an owned physical parent's value", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "value");
  Reflect.deleteProperty(globalThis, "value");
  onTestFinished(() => {
    if (original) Object.defineProperty(globalThis, "value", original);
    else Reflect.deleteProperty(globalThis, "value");
  });
  const parent = mount([], undefined, { physical: true, dateClear: true });
  await userEvent.click(
    within(parent.view.container).getByRole("button", { name: "Clear native date" }),
  );

  const old = mount([field(1, "Attachment", "file"), field(2, "Later")], undefined, {
    physical: false,
    dateClear: true,
  });

  await userEvent.click(
    within(old.view.container).getByRole("button", { name: "Clear native date" }),
  );
  await userEvent.click(within(old.view.container).getByRole("button", { name: "Clear fields" }));
  await within(old.view.container).findByText("Cleared");
  expect(within(old.view.container).getByRole("link", { name: "Show" }).getAttribute("href")).toBe(
    "/files/userfiles/",
  );
  old.view.unmount();

  const next = mount([field(1, "Attachment", "file"), field(2, "Later")], undefined, {
    physical: false,
  });

  await userEvent.type(screen.getByLabelText("Later"), "Fresh child draft");
  await userEvent.click(within(next.view.container).getByRole("button", { name: "Clear fields" }));
  await within(next.view.container).findByText("ReferenceError: value is not defined");
  expect(screen.getByLabelText<HTMLInputElement>("Later").value).toBe("Fresh child draft");
  expect(within(next.view.container).queryByRole("link", { name: "Show" })).toBeNull();
  expect(Object.getOwnPropertyDescriptor(globalThis, "value")?.value).toBe("");
  next.view.unmount();
  parent.view.unmount();
  expect(Object.getOwnPropertyDescriptor(globalThis, "value")).toBeUndefined();
});

test("Delete after Clear with an empty live FileList sends empty metadata and a defined empty delete without uploading the cached file", async () => {
  vi.stubGlobal("value", "");
  const app = mount([field(1, "Attachment", "file")]);
  const input = screen.getByLabelText<HTMLInputElement>("Attachment");
  await userEvent.upload(
    input,
    new File(["Previously selected bytes"], "Earlier.pdf", { type: "application/pdf" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Clear fields" }));
  await screen.findByText("Cleared");
  expect(screen.getByRole("link", { name: "Show" }).getAttribute("href")).toBe("/files/userfiles/");
  await userEvent.click(within(input.parentElement!).getByRole("button", { name: "Delete" }));
  expect(input.getAttribute("data-old-file")).toBe("");
  await userEvent.upload(input, []);
  expect(input.files).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Save fields" }));
  await screen.findByText("Saved fields");
  expect(metadata(app)).toEqual([{}]);
  expect(
    app.writes
      .filter((write) => write.path.includes("/files/"))
      .map(({ path, method }) => ({ path, method })),
  ).toEqual([{ path: "/api/files/userfiles/", method: "DELETE" }]);
});
