import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import { cookieSessionSelected, selectCookieSession } from "@/lib/config";
import type { JsonObject } from "@/lib/json";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

const definitions = [
  {
    ...notesField("equipment"),
    name: "first",
    caption: "First",
    sort_number: 1,
    show_as_column_in_tables: 1,
  },
  {
    ...notesField("equipment"),
    id: 2,
    name: "last",
    caption: "Last",
    sort_number: 2,
    show_as_column_in_tables: 1,
  },
];

type Call = { path: string; method: string; body?: JsonObject; file?: BodyInit | null };

function noteMessage(kind: "ready" | "change", html = "") {
  const frame = screen.getByTitle<HTMLIFrameElement>("Notes");
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      origin: "null",
      data: {
        channel: "grocy-description",
        kind,
        html,
        empty: !html,
        height: 390,
        fullscreen: false,
      },
    }),
  );
}

type EquipmentFixtureOptions = {
  holdPrimary?: boolean;
  heldField?: string;
  holdDelete?: boolean;
  holdUpload?: boolean;
  denied?: boolean;
  failDelete?: boolean;
  failUploadOnce?: boolean;
  failField?: string;
  fields?: typeof definitions;
  manualName?: string | null;
  basepath?: string;
  imported?: boolean;
  cookieSession?: boolean;
  browserSession?: boolean;
  config?: JsonObject;
};

function mountEquipment(
  path = "/equipment/9",
  {
    holdPrimary = false,
    heldField = "",
    holdDelete = false,
    holdUpload = false,
    denied = false,
    failDelete = false,
    failUploadOnce = false,
    failField = "",
    fields = definitions,
    manualName = "old.pdf",
    basepath = "/",
    imported = false,
    cookieSession = false,
    browserSession = false,
    config = {},
  }: EquipmentFixtureOptions = {},
) {
  if (cookieSession) selectCookieSession();

  const documentReads: string[] = [];

  const records = [
    {
      id: 9,
      name: imported ? "Imported\rEquipment\nName" : "Mixer",
      description: "<p>Keep dry</p>",
      instruction_manual_file_name: manualName,
    },
  ];

  const values = new Map<number, Record<string, string | null>>([
    [9, { first: "Existing first", last: "Existing last" }],
  ]);

  const calls: Call[] = [];
  const drafts: JsonObject[] = [];
  const signals: { path: string; method: string; signal?: AbortSignal | null }[] = [];
  const primary = deferred();
  const metadata = deferred();
  const deletion = deferred();
  const upload = deferred();
  let failUpload = failUploadOnce;
  const BrowserURL = URL;
  let blobNumber = 0;
  vi.stubGlobal(
    "URL",
    class extends BrowserURL {
      static createObjectURL() {
        return `blob:equipment-${++blobNumber}`;
      }
      static revokeObjectURL() {}
    },
  );
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => parent.mockRestore());
  const seen = new WeakSet<HTMLIFrameElement>();

  const observer = new MutationObserver(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[title="Notes"]')) {
      if (seen.has(frame)) continue;
      seen.add(frame);
      window.setTimeout(() => {
        if (frame.isConnected) noteMessage("ready");
      }, 0);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  onTestFinished(() => observer.disconnect());

  const app = mountNativeEditor(
    path,
    (url, options) => {
      if (cookieSession) expect(new Headers(options?.headers).get("GROCY-API-KEY")).toBeNull();

      if (url === "/api/v2/user/permissions")
        return Response.json({ MASTER_DATA_EDIT: !denied, EQUIPMENT: !denied });

      if (url === "/api/objects/userfields?query[]=entity=equipment") return Response.json(fields);

      if (url === "/api/v2/custom-data/fields" || url === "/api/objects/userfields")
        return Response.json(fields);

      if (url === "/api/v2/content/equipment/editor" && options?.method === "POST") {
        drafts.push(JSON.parse(String(options.body)));

        return new Response("<!doctype html><html><body>Notes editor</body></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (url === "/api/v2/content/equipment")
        return Response.json(records.map((row) => ({ id: row.id, html: row.description ?? "" })));

      if (/^\/api\/v2\/content\/equipment\/\d+$/.test(url))
        return Response.json({
          html: records.find((row) => row.id === Number(url.split("/").at(-1)))?.description ?? "",
        });

      if (url.startsWith("/api/userfields/equipment/") && !options?.method)
        return Response.json(values.get(Number(url.split("/").at(-1))) ?? {});

      if (url.startsWith("/api/userfields/equipment/") && options?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(options.body));
        calls.push({ path: url, method: "PUT", body });
        signals.push({ path: url, method: "PUT", signal: options?.signal });
        const name = Object.keys(body)[0]!;

        return (async () => {
          if (name === heldField) await metadata.promise;

          if (name === failField)
            return Response.json({ error_message: "Field failed" }, { status: 500 });
          const id = Number(url.split("/").at(-1));
          const current = values.get(id) ?? {};
          current[name] = String(body[name]);
          values.set(id, current);

          return new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/files/equipmentmanuals/")) {
        if (options?.method === "DELETE" || options?.method === "PUT") {
          calls.push({ path: url, method: options.method, file: options.body });
          signals.push({ path: url, method: options.method, signal: options.signal });

          return (async () => {
            if (options.method === "DELETE") {
              if (holdDelete) await deletion.promise;

              if (failDelete)
                return Response.json({ error_message: "Delete failed" }, { status: 500 });
            } else {
              if (holdUpload) await upload.promise;

              if (failUpload) {
                failUpload = false;

                return Response.json({ error_message: "Upload failed" }, { status: 500 });
              }
            }

            return new Response(null, { status: 204 });
          })();
        }

        documentReads.push(url);

        return new Response("%PDF-old", { headers: { "Content-Type": "application/pdf" } });
      }

      if (
        (url === "/api/objects/equipment" || /^\/api\/objects\/equipment\/\d+$/.test(url)) &&
        ["POST", "PUT"].includes(options?.method ?? "")
      ) {
        const body: JsonObject = JSON.parse(String(options?.body));
        calls.push({ path: url, method: options!.method!, body });
        signals.push({ path: url, method: options!.method!, signal: options?.signal });

        return (async () => {
          if (holdPrimary) await primary.promise;

          if (denied)
            return Response.json(
              { error_message: "Permission denied: MASTER_DATA_EDIT" },
              { status: 403 },
            );

          if (options?.method === "POST") {
            if (records.some((row) => row.name === body.name))
              return Response.json({ error_message: "Equipment already exists" }, { status: 400 });
            const id = 31 + records.filter((record) => record.id >= 31).length;
            records.push({
              id,
              name: String(body.name),
              description: String(body.description),
              instruction_manual_file_name:
                body.instruction_manual_file_name === undefined
                  ? null
                  : body.instruction_manual_file_name === null
                    ? null
                    : String(body.instruction_manual_file_name),
            });

            return Response.json({ created_object_id: String(id) });
          }

          Object.assign(
            records.find((row) => row.id === Number(url.split("/").at(-1)))!,
            body,
          );

          return new Response(null, { status: 204 });
        })();
      }

      if (url === "/api/objects/equipment")
        return Response.json(
          records.map((row) => ({ ...row, userfields: values.get(row.id) ?? null })),
        );

      if (/^\/api\/objects\/equipment\/\d+$/.test(url)) {
        const row = records.find((row) => row.id === Number(url.split("/").at(-1)));

        return row
          ? Response.json({ ...row, userfields: values.get(row.id) ?? null })
          : Response.json({ error_message: "Equipment not found" }, { status: 404 });
      }

      return undefined;
    },
    { FEATURE_FLAG_EQUIPMENT: true, ...config },
    { basepath },
    { browserSession },
  );

  return {
    ...app,
    documentReads,
    records,
    values,
    calls,
    drafts,
    parent,
    primary,
    metadata,
    deletion,
    upload,
    signals,
  };
}

async function ready() {
  const name = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false),
  );

  return name;
}

test("selected equipment uses its own Name, rich Notes and custom fields and omits an unchanged manual", async () => {
  const app = mountEquipment();
  const user = userEvent.setup();
  const name = await ready();
  expect(name.value).toBe("Mixer");
  expect(app.drafts[0]).toEqual({ html: "<p>Keep dry</p>", paste: false });
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "First" }).value).toBe(
    "Existing first",
  );
  await user.clear(name);
  await user.type(name, "Mixer updated");
  await act(async () => noteMessage("change", "<p><strong>Keep dry</strong></p>"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls).toEqual([
    {
      path: "/api/objects/equipment/9",
      method: "PUT",
      body: { name: "Mixer updated", description: "<p><strong>Keep dry</strong></p>" },
    },
  ]);
  expect(app.records[0]?.instruction_manual_file_name).toBe("old.pdf");
});

test("create saves primary then parallel fields and reads the live manual after the last callback", async () => {
  const app = mountEquipment("/equipment/new?embedded", { holdPrimary: true, heldField: "last" });
  const user = userEvent.setup();
  await user.type(await ready(), "Toaster");
  await user.type(screen.getByRole("textbox", { name: "First" }), "A");
  await user.type(screen.getByRole("textbox", { name: "Last" }), "B");
  const first = new File(["first PDF"], "Ä Manual.PDF", { type: "application/pdf" });
  const second = new File(["second PDF"], "replacement.pdf", { type: "application/pdf" });
  const input = screen.getByLabelText<HTMLInputElement>("Instruction manual");
  await user.upload(input, first);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  const filename = String(app.calls[0]?.body?.instruction_manual_file_name);
  expect(filename).toMatch(/^[a-z0-9]+aemanual\.pdf$/);
  expect(input.disabled).toBe(false);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).closest("fieldset")?.disabled,
  ).toBe(true);
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.calls).toHaveLength(3));
  expect(app.calls.slice(1).map((call) => call.body)).toEqual([{ first: "A" }, { last: "B" }]);
  await user.upload(input, second);
  expect(app.calls.some((call) => call.path.startsWith("/api/files/equipmentmanuals/"))).toBe(
    false,
  );
  await act(async () => app.metadata.release());
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls[3]).toEqual({
    path: `/api/files/equipmentmanuals/${encodeURIComponent(btoa(filename))}`,
    method: "PUT",
    file: second,
  });
  expect(app.parent).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
});

test("old manual deletion starts before PUT and does not gate return while selection cannot clear the delete flag", async () => {
  const app = mountEquipment("/equipment/9", { holdDelete: true });
  const user = userEvent.setup();
  await ready();
  await screen.findByLabelText("Instruction manual: Mixer");
  await user.click(screen.getByRole("button", { name: "Delete current instruction manual" }));
  expect(screen.getByText("The current file will be deleted on save")).toBeTruthy();
  await user.upload(
    screen.getByLabelText("Instruction manual"),
    new File(["replacement"], "new.pdf", { type: "application/pdf" }),
  );
  expect(screen.queryByText("The current file will be deleted on save")).toBeNull();
  expect(screen.getByLabelText("Instruction manual: Mixer").closest("[hidden]")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls).toEqual([
    { path: "/api/files/equipmentmanuals/b2xkLnBkZg%3D%3D", method: "DELETE", file: undefined },
    {
      path: "/api/objects/equipment/9",
      method: "PUT",
      body: { name: "Mixer", description: "<p>Keep dry</p>", instruction_manual_file_name: null },
    },
  ]);
  await waitFor(() =>
    expect(document.querySelector(".equipment-selected .rich-content")).not.toBeNull(),
  );
  const keys = warmEquipmentReads(app);
  expect(app.signals[0]!.signal?.aborted).toBe(true);
  await act(async () => app.deletion.release());

  for (const key of keys)
    expect(app.client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(true);
});

test("choosing a replacement leaves the stored PDF preview visible and selecting a file after submit does not add an upload", async () => {
  const app = mountEquipment("/equipment/9", { holdPrimary: true, fields: [] });
  const user = userEvent.setup();
  await ready();
  const preview = await screen.findByLabelText("Instruction manual: Mixer");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  await user.upload(
    screen.getByLabelText("Instruction manual"),
    new File(["new"], "new.pdf", { type: "application/pdf" }),
  );
  expect(preview.closest("[hidden]")).toBeNull();
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls).toHaveLength(1);
  expect(app.calls[0]?.body).not.toHaveProperty("instruction_manual_file_name");
});

test("fresh production auth-disabled selected editor uses its direct stored PDF without choosing a cookie session", async () => {
  expect(localStorage.length).toBe(0);
  const base = `${window.location.origin}/house.hold/`;

  const app = mountEquipment("/equipment/9", {
    fields: [],
    browserSession: true,
    manualName: "aa>.pdf",
    config: { MODE: "production", DISABLE_AUTH: true, BASE_URL: base, DISABLE_URL_REWRITING: true },
  });

  await ready();

  const preview = await screen.findByLabelText<HTMLEmbedElement>("Instruction manual: Mixer", {
    selector: "embed",
  });

  expect(preview.getAttribute("src")).toBe(
    `${base}index.php/api/files/equipmentmanuals/YWE+LnBkZg==`,
  );
  expect(preview.type).toBe("application/pdf");
  expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  expect(app.documentReads).toEqual([]);
  expect(app.calls).toEqual([]);
  expect(cookieSessionSelected()).toBe(false);
  expect(localStorage.length).toBe(0);
});

test("cookie stored manual embed survives replacement and hides without rebinding on Delete", async () => {
  const app = mountEquipment("/equipment/9", { cookieSession: true, fields: [] });
  const user = userEvent.setup();
  await ready();

  const preview = screen.getByLabelText<HTMLEmbedElement>("Instruction manual: Mixer", {
    selector: "embed",
  });

  const source = "/api/files/equipmentmanuals/b2xkLnBkZg==";
  expect(preview.getAttribute("src")).toBe(source);
  expect(preview.type).toBe("application/pdf");
  expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  const file = new File(["replacement bytes"], "replacement.pdf", { type: "application/pdf" });
  const input = screen.getByLabelText<HTMLInputElement>("Instruction manual");
  await user.upload(input, file);
  expect(input.files?.[0]).toBe(file);
  expect(screen.getByLabelText("Instruction manual: Mixer", { selector: "embed" })).toBe(preview);
  expect(preview.getAttribute("src")).toBe(source);
  expect(preview.closest("[hidden]")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Delete current instruction manual" }));
  expect(preview.closest("[hidden]")).not.toBeNull();
  expect(preview.getAttribute("src")).toBe(source);
  expect(app.documentReads).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls).toEqual([
    { path: "/api/files/equipmentmanuals/b2xkLnBkZg%3D%3D", method: "DELETE", file: undefined },
    {
      path: "/api/objects/equipment/9",
      method: "PUT",
      body: { name: "Mixer", description: "<p>Keep dry</p>", instruction_manual_file_name: null },
    },
  ]);
});

test("manual upload failure unlocks and a retry repeats dirty field writes and generates a new manual name", async () => {
  const app = mountEquipment("/equipment/9", { failUploadOnce: true });
  const user = userEvent.setup();
  await ready();
  await user.type(screen.getByRole("textbox", { name: "Last" }), " changed");
  await user.upload(
    screen.getByLabelText("Instruction manual"),
    new File(["manual"], "manual.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  await within(screen.getByRole("dialog", { name: "Error details" })).findByText(/Upload failed/);
  await user.click(
    within(screen.getByRole("dialog", { name: "Error details" })).getByRole("button", {
      name: "OK",
    }),
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(
    app.calls.map((call) =>
      call.path.startsWith("/api/userfields/")
        ? "field"
        : call.path.startsWith("/api/files/")
          ? "upload"
          : "primary",
    ),
  ).toEqual(["primary", "field", "upload", "primary", "field", "upload"]);
  expect(app.calls[0]?.body?.instruction_manual_file_name).not.toBe(
    app.calls[3]?.body?.instruction_manual_file_name,
  );
});

test("deleting the manual while primary is pending suppresses upload without changing its submitted filename", async () => {
  const app = mountEquipment("/equipment/9", { holdPrimary: true, fields: [] });
  const user = userEvent.setup();
  await ready();
  await user.upload(
    screen.getByLabelText("Instruction manual"),
    new File(["manual"], "manual.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  const submittedName = app.calls[0]?.body?.instruction_manual_file_name;
  expect(submittedName).toEqual(expect.any(String));
  await user.click(screen.getByRole("button", { name: "Delete current instruction manual" }));
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls).toHaveLength(1);
  expect(app.records[0]?.instruction_manual_file_name).toBe(submittedName);
});

test("an independent manual-delete error does not prevent the equipment update and later navigation", async () => {
  const app = mountEquipment("/equipment/9", { failDelete: true, holdPrimary: true });
  const user = userEvent.setup();
  await ready();
  await user.click(screen.getByRole("button", { name: "Delete current instruction manual" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  await within(screen.getByRole("dialog", { name: "Error details" })).findByText(/Delete failed/);
  expect(app.calls[1]?.path).toBe("/api/objects/equipment/9");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false);
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
});

test("native readers see Notes and can submit before the primary API denies their write", async () => {
  const app = mountEquipment("/equipment/9", { denied: true });
  const user = userEvent.setup();
  const name = await ready();
  expect(name.closest("fieldset")?.disabled).toBe(false);
  await user.type(name, " denied");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  await within(screen.getByRole("dialog", { name: "Error details" })).findByText(
    /Permission denied: MASTER_DATA_EDIT/,
  );
  expect(app.calls).toHaveLength(1);
  expect(name.value).toBe("Mixer denied");
  expect(name.closest("fieldset")?.disabled).toBe(false);
});

test("required Name blocks a new record while Notes and instruction manual remain optional", async () => {
  const app = mountEquipment("/equipment/new", { fields: [] });
  const user = userEvent.setup();
  const name = await ready();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.calls).toHaveLength(0);
  await user.type(name, "Kettle");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls[0]?.body).toEqual({ name: "Kettle", description: "" });
});

test("a failed final custom-field metadata write remains silently busy and never starts the manual upload", async () => {
  const app = mountEquipment("/equipment/9", { failField: "last" });
  const user = userEvent.setup();
  await ready();
  await user.type(screen.getByRole("textbox", { name: "Last" }), " changed");
  await user.upload(
    screen.getByLabelText("Instruction manual"),
    new File(["manual"], "manual.pdf", { type: "application/pdf" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(2));
  await act(async () => {});
  expect(app.router.state.location.pathname).toBe("/equipment/9");
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  expect(app.calls.some((call) => call.path.startsWith("/api/files/"))).toBe(false);
});

test.each(["primary", "field", "upload"])(
  "departure during held %s suppresses later equipment stages and navigation",
  async (stage) => {
    const app = mountEquipment("/equipment/9", {
      holdPrimary: stage === "primary",
      heldField: stage === "field" ? "last" : "",
      holdUpload: stage === "upload",
    });

    const user = userEvent.setup();
    await ready();
    await user.type(screen.getByRole("textbox", { name: "Last" }), " changed");
    await user.upload(
      screen.getByLabelText("Instruction manual"),
      new File(["manual"], "manual.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.calls).toHaveLength(stage === "primary" ? 1 : stage === "field" ? 2 : 3),
    );
    await act(async () => app.router.navigate({ href: "/equipment/new" }));
    const keys = warmEquipmentReads(app);
    expect(app.signals.at(-1)!.signal?.aborted).toBe(true);
    await act(async () => {
      app.primary.release();
      app.metadata.release();
      app.upload.release();
    });
    expect(app.calls).toHaveLength(stage === "primary" ? 1 : stage === "field" ? 2 : 3);

    for (const key of keys)
      expect(app.client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(true);
    expect(app.router.state.location.pathname).toBe("/equipment/new");
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
  },
);

test("missing selected equipment never falls back to an unselected create form", async () => {
  const app = mountEquipment("/equipment/999");
  await screen.findByText("Equipment not found");
  expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  expect(app.calls).toHaveLength(0);
});

function warmEquipmentReads(app: ReturnType<typeof mountEquipment>) {
  const values = [
    { key: ["objects", "equipment"], value: app.records },
    { key: ["equipment-editor-fields", 9], value: { first: "Fresh field value" } },
    { key: ["content", "equipment", 9], value: { html: "<p>Fresh equipment notes</p>" } },
  ];

  for (const { key, value } of values) {
    app.client.setQueryData(key, value);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  return values.map(({ key }) => key);
}

test("Equipment unchanged Arrow is native dirty and main rich HTML uses CRLF while metadata keeps LF", async () => {
  const fields = [{ ...definitions[0]!, type: "text-multi-line" }, { ...definitions[1]! }];
  const app = mountEquipment("/equipment/9", { imported: true, fields });
  app.values.get(9)!.first = "Stored line1\nStored line2";
  const name = await ready();
  expect(name.value).toBe("ImportedEquipmentName");
  const first = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "First" });
  const user = userEvent.setup();
  await user.click(first);
  await user.keyboard("{ArrowLeft}");
  await act(async () => noteMessage("change", "<p>Line one</p>\n<p><strong>Line two</strong></p>"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls).toEqual([
    {
      path: "/api/objects/equipment/9",
      method: "PUT",
      body: {
        name: "ImportedEquipmentName",
        description: "<p>Line one</p>\r\n<p><strong>Line two</strong></p>",
      },
    },
    {
      path: "/api/userfields/equipment/9",
      method: "PUT",
      body: { first: "Stored line1\nStored line2" },
    },
  ]);
});

test("Equipment common field stage reads actual disabled DOM after primary success, not a submit snapshot", async () => {
  const app = mountEquipment("/equipment/new", { holdPrimary: true });
  await userEvent.type(await ready(), "Stage-probe equipment");
  const first = screen.getByRole<HTMLInputElement>("textbox", { name: "First" });
  await userEvent.type(first, "Before primary");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  expect(first.matches(":disabled")).toBe(true);
  // Deliberate disabled-DOM mutation isolates source callback timing; it is not natural user input.
  first.value = "After primary live DOM";
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(app.calls).toEqual([
    {
      path: "/api/objects/equipment",
      method: "POST",
      body: { name: "Stage-probe equipment", description: "" },
    },
    {
      path: "/api/userfields/equipment/31",
      method: "PUT",
      body: { first: "After primary live DOM" },
    },
  ]);
});

test("Equipment earlier field settlement after the native return stales freshly read object and Notes caches", async () => {
  const app = mountEquipment("/equipment/9", { heldField: "first" });
  await ready();
  await userEvent.type(screen.getByRole("textbox", { name: "First" }), " earlier");
  await userEvent.type(screen.getByRole("textbox", { name: "Last" }), " final");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  const earlier = app.signals.find((request) => request.path.startsWith("/api/userfields/"))!;
  expect(earlier.signal?.aborted).toBe(true);
  await waitFor(() =>
    expect(document.querySelector(".equipment-selected .rich-content")).not.toBeNull(),
  );
  const keys = warmEquipmentReads(app);
  const count = app.calls.length;
  await act(async () => app.metadata.release());

  for (const key of keys)
    expect(app.client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(true);
  expect(app.calls).toHaveLength(count);
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
});

test("Equipment fresh create after manual-upload failure uses the newly created ID for still-dirty fields", async () => {
  const app = mountEquipment("/equipment/new", { failUploadOnce: true });
  const user = userEvent.setup();
  const name = await ready();
  await user.type(name, "First equipment");
  await user.type(screen.getByRole("textbox", { name: "First" }), "Retained dirty note");
  const file = new File(["Create retry manual"], "manual.pdf", { type: "application/pdf" });
  await user.upload(screen.getByLabelText("Instruction manual"), file);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: /Error while saving/ });
  await waitFor(() => expect(name.matches(":disabled")).toBe(false));
  await user.clear(name);
  await user.type(name, "Second equipment");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/equipment"));
  expect(
    app.calls.map((call) => (call.path.startsWith("/api/files/") ? "manual" : call.path)),
  ).toEqual([
    "/api/objects/equipment",
    "/api/userfields/equipment/31",
    "manual",
    "/api/objects/equipment",
    "/api/userfields/equipment/32",
    "manual",
  ]);
  expect(app.calls[1]!.body).toEqual({ first: "Retained dirty note" });
  expect(app.calls[4]!.body).toEqual({ first: "Retained dirty note" });
  expect(app.calls[2]!.file).toBe(file);
  expect(app.calls[5]!.file).toBe(file);
  expect(app.calls[0]!.body!.instruction_manual_file_name).not.toBe(
    app.calls[3]!.body!.instruction_manual_file_name,
  );
});
