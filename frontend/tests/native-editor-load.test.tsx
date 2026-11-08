import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import type { JsonObject } from "@/lib/json";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "@/components/UserfieldsEditor";
import { initialUserfields } from "@/lib/userfields";

// These are the actual native callers of the four selected-object Load wrappers.
const editors = [
  { route: "equipment", entity: "equipment" },
  { route: "battery", entity: "batteries" },
  { route: "task", entity: "tasks" },
  { route: "taskcategory", entity: "task_categories" },
  { route: "location", entity: "locations" },
  { route: "productgroup", entity: "product_groups" },
  { route: "shoppinglocation", entity: "shopping_locations" },
  { route: "quantityunit", entity: "quantity_units" },
  { route: "quantityunitconversion", entity: "quantity_unit_conversions" },
  { route: "userobject/tools", entity: "userentity-tools" },
] as const;

type Editor = (typeof editors)[number];

function deferredResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountLoad(
  editor: Editor,
  options: {
    required?: boolean;
    numeric?: boolean;
    response?: Response;
    callbackType?: string;
    strictWarm?: boolean;
    config?: JsonObject;
  } = {},
) {
  const load = deferredResponse();

  const field = (name: string, caption: string, type = "text-single-line", required = 0) => ({
    ...notesField(editor.entity),
    id: Number(name) + 1,
    name,
    caption,
    type,
    input_required: required,
    sort_number: Number(name),
    show_as_column_in_tables: 1,
    row_created_timestamp: null,
  });

  const fields = options.callbackType
    ? [
        field("0", "Late note"),
        field("1", "Packed control", options.callbackType),
        field("2", "Later note"),
      ]
    : options.numeric
      ? [field("0", "Late note"), field("1", "Second note")]
      : [
          field("0", "Late note"),
          field("1", "Returned flag", "checkbox", options.required ? 1 : 0),
          field("2", "Omitted flag", "checkbox", options.required ? 1 : 0),
          field("3", "Clean field"),
          field("4", "Attachment", "file"),
        ];

  const entity = {
    id: 8,
    name: "tools",
    caption: "Tools",
    description: null,
    show_in_sidebar_menu: 0,
    icon_css_class: null,
  };

  const unit = {
    id: 9,
    name: "Selected record",
    name_plural: "Selected records",
    plural_forms: "",
    active: 1,
    description: "",
  };

  const primaryEntity = editor.entity.startsWith("userentity-") ? "userobjects" : editor.entity;

  const selected = {
    ...unit,
    instruction_manual_file_name: null,
    userentity_id: 8,
    used_in: "Camera",
    charge_interval_days: 0,
    due_date: null,
    category_id: null,
    assigned_to_user_id: 7,
    is_freezer: 0,
    from_qu_id: 9,
    to_qu_id: 2,
    factor: 2,
    product_id: null,
  };

  const reads: { id: number; signal?: AbortSignal | null }[] = [];
  const writes: { path: string; body: JsonObject }[] = [];
  const files: { path: string; method: string; body: BodyInit | null | undefined }[] = [];
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mountNativeEditor(
    `/${editor.route}/9?embedded&qu-unit=9`,
    (url, init) => {
      if (url.startsWith("/api/files/") && (init?.method === "PUT" || init?.method === "DELETE")) {
        files.push({ path: url, method: init.method, body: init.body });

        return new Response(null, { status: 204 });
      }

      if (url === "/api/objects/userfields" || url === "/api/v2/custom-data/fields")
        return Response.json(fields);

      if (url === "/api/v2/custom-data/userobjects/tools")
        return Response.json({ userentity: entity, fields, rows: [] });

      if (url === "/api/objects/userentities") return Response.json([entity]);

      if (url === "/api/objects/quantity_units")
        return Response.json([unit, { ...unit, id: 2, name: "Bottle", name_plural: "Bottles" }]);

      if (url === "/api/objects/quantity_unit_conversions") return Response.json([]);

      if (/^\/api\/v2\/content\/equipment(?:\/\d+)?$/.test(url))
        return Response.json(url.endsWith("/9") ? { html: "" } : []);

      if (url === "/api/v2/content/equipment/editor")
        return new Response("<!doctype html><html><body>Notes</body></html>", {
          headers: { "Content-Type": "text/html" },
        });

      if (url === `/api/objects/${primaryEntity}/9` && init?.method !== "PUT")
        return Response.json(selected);

      if (url === `/api/objects/${primaryEntity}/10` && init?.method !== "PUT")
        return Response.json({ ...selected, id: 10, name: "Replacement record" });

      if (url.startsWith(`/api/userfields/${editor.entity}/`) && init?.method !== "PUT") {
        const id = Number(url.split("/").at(-1));
        reads.push({ id, signal: init?.signal });

        return id === 9
          ? (options.response?.clone() ?? load.promise.then((response) => response.clone()))
          : Response.json({ "0": "Replacement loaded" });
      }

      if (
        init?.method === "PUT" &&
        (url.startsWith("/api/objects/") || url.startsWith("/api/userfields/"))
      ) {
        writes.push({ path: url, body: JSON.parse(String(init.body)) });

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
      ...options.config,
    },
    {},
    options.strictWarm
      ? {
          strictMode: true,
          prepareClient: (client) => {
            client.setQueryDefaults(["household-object-editor", editor.entity, 9], {
              staleTime: Infinity,
            });
            client.setQueryData(["household-object-editor", editor.entity, 9], selected);
            client.setQueryDefaults(["entity-manager-userfields"], { staleTime: Infinity });
            client.setQueryData(["entity-manager-userfields"], fields);
          },
        }
      : {},
  );

  async function ready() {
    const note = await screen.findByLabelText<HTMLInputElement>("Late note");

    if (editor.route === "equipment") {
      const frame = await screen.findByTitle<HTMLIFrameElement>("Notes");
      await act(async () =>
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
        ),
      );
    }

    return note;
  }

  return { ...app, ready, load, reads, writes, files, parent, logger, fields };
}

test.each([
  { type: "file", script: "/index.php", rewriting: true, extension: "pdf" },
  { type: "image", script: "", rewriting: false, extension: "png" },
])(
  "selected native $type Load keeps the complete packed named-resource binding",
  async ({ type, script, rewriting, extension }) => {
    const app = mountLoad(editors[9], {
      callbackType: type,
      config: { BASE_URL: "https://grocy.invalid/house.hold/", DISABLE_URL_REWRITING: rewriting },
    });

    await app.ready();
    const input = screen.getByLabelText<HTMLInputElement>("Packed control");
    const control = within(input.parentElement!);
    const user = userEvent.setup();
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(control.queryByRole("link", { name: "Show" })).toBeNull();
    expect(control.queryByRole("button", { name: "Show" })).toBeNull();
    const early = new File(["Early bytes"], `Early.${extension}`);
    await user.upload(input, early);
    const packed = `${btoa(`fixed-internal.${extension}`)}_${btoa(`user-visible.${extension}`)}_extra_token`;
    await act(async () => app.load.release(Response.json({ "1": packed })));
    await control.findByText(`user-visible.${extension}`);
    expect(input.files?.[0]).toBe(early);
    const url = `https://grocy.invalid/house.hold${script}/files/userfiles/${packed}`;
    let preview: HTMLAnchorElement | HTMLImageElement;

    if (type === "file") {
      const show = control.getByRole<HTMLAnchorElement>("link", { name: "Show" });
      preview = show;
      expect(show.getAttribute("href")).toBe(url);
      expect(show.target).toBe("_blank");
      const clicks: { ctrl: boolean; meta: boolean; prevented: boolean }[] = [];
      const auxiliary: { button: number; prevented: boolean }[] = [];

      const observe = (event: MouseEvent) => {
        if (event.target === show)
          clicks.push({
            ctrl: event.ctrlKey,
            meta: event.metaKey,
            prevented: event.defaultPrevented,
          });
      };

      const observeAuxiliary = (event: MouseEvent) => {
        if (event.target === show)
          auxiliary.push({ button: event.button, prevented: event.defaultPrevented });
      };

      document.addEventListener("click", observe);
      document.addEventListener("auxclick", observeAuxiliary);
      onTestFinished(() => document.removeEventListener("click", observe));
      onTestFinished(() => document.removeEventListener("auxclick", observeAuxiliary));
      await user.click(show);
      await user.keyboard("{Control>}");
      await user.click(show);
      await user.keyboard("{/Control}{Meta>}");
      await user.click(show);
      await user.keyboard("{/Meta}");
      await user.pointer({ keys: "[MouseMiddle]", target: show });
      expect(clicks).toEqual([
        { ctrl: false, meta: false, prevented: false },
        { ctrl: true, meta: false, prevented: false },
        { ctrl: false, meta: true, prevented: false },
      ]);
      expect(auxiliary).toEqual([{ button: 1, prevented: false }]);
    } else {
      expect(control.queryByRole("link", { name: "Show" })).toBeNull();
      expect(control.queryByRole("button", { name: "Show" })).toBeNull();
      const picture = control.getByRole<HTMLImageElement>("img", { name: "1" });
      preview = picture;
      expect(picture.getAttribute("href")).toBe(url);
      expect(picture.getAttribute("src")).toBe(
        `${url}?force_serve_as=picture&best_fit_width=250&best_fit_height=250`,
      );
      await user.click(picture);
    }

    expect(
      app.fetchMock.mock.calls.filter(([path]) => String(path).startsWith("/api/files/")),
    ).toEqual([]);
    expect(opened).not.toHaveBeenCalled();
    const replacement = new File(["Replacement bytes"], `Replacement.${extension}`);
    await user.upload(input, replacement);
    expect(control.queryByRole("link", { name: "Show" })).toBeNull();
    expect(control.queryByRole("img")).toBeNull();
    expect(preview.isConnected).toBe(true);
    expect(preview.getAttribute("href")).toBe(url);

    if (type === "image")
      expect(preview.getAttribute("src")).toBe(
        `${url}?force_serve_as=picture&best_fit_width=250&best_fit_height=250`,
      );
    await user.click(control.getByRole("button", { name: "Delete" }));
    expect(control.getByText("No file selected")).toBeTruthy();
    expect(input.files?.[0]).toBe(replacement);
    expect(input.getAttribute("data-old-file")).toBe(`fixed-internal.${extension}`);
    expect(preview.isConnected).toBe(true);
    expect(preview.getAttribute("href")).toBe(url);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.files).toHaveLength(2));
    expect(app.files[0]).toMatchObject({
      path: `/api/files/userfiles/${encodeURIComponent(btoa(`fixed-internal.${extension}`))}`,
      method: "DELETE",
    });
    expect(app.files[1]).toMatchObject({ method: "PUT", body: replacement });

    const value = app.writes.find((row) => row.path === "/api/userfields/userentity-tools/9")!.body[
      "1"
    ];

    expect(value).toEqual(expect.any(String));
    expect(String(value).split("_")[1]).toBe(btoa(`replacement.${extension}`));
    expect(String(value)).not.toBe(packed);
    expect(app.logger).not.toHaveBeenCalled();
  },
);

test("repeated falsy native file Load retains its last URL snapshot and file metadata", async () => {
  const fields = [
    { ...notesField("userentity-tools"), name: "attachment", caption: "Attachment", type: "file" },
  ];

  const editor = createRef<UserfieldsEditorHandle>();
  const client = new QueryClient();

  function Harness() {
    const [values, setValues] = useState(() => initialUserfields(fields, {}, false));

    return (
      <UserfieldsEditor
        ref={editor}
        fields={fields}
        values={values}
        creating={false}
        disabled={false}
        nativeFiles
        nativeDirty
        nativeLoadPending
        onChange={(name, edit) => setValues((current) => ({ ...current, [name]: edit }))}
      />
    );
  }

  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    view.unmount();
    client.clear();
  });
  const input = screen.getByLabelText<HTMLInputElement>("Attachment");
  const user = userEvent.setup();
  const selected = new File(["Kept bytes"], "Keep.txt");
  await user.upload(input, selected);
  const earlier = `${btoa("earlier.txt")}_${btoa("Earlier.txt")}_older`;
  const packed = `${btoa("latest.txt")}_${btoa("Latest.txt")}_extra_token`;
  act(() => editor.current!.load({ attachment: earlier }));
  act(() => editor.current!.load({ attachment: packed }));
  const show = screen.getByRole("link", { name: "Show" });
  expect(show.getAttribute("href")).toBe(`/files/userfiles/${packed}`);

  for (const value of ["", null]) {
    act(() => editor.current!.load({ attachment: value }));
    expect(screen.getByRole("link", { name: "Show" })).toBe(show);
    expect(show.getAttribute("href")).toBe(`/files/userfiles/${packed}`);
    expect(screen.getByText("Latest.txt")).toBeTruthy();
    expect(input.files?.[0]).toBe(selected);
  }

  expect(editor.current!.snapshot().attachment.dirty).toBe(true);
  const label = screen.getByText("Latest.txt");
  const descriptor = Object.getOwnPropertyDescriptor(window, "value");
  onTestFinished(() => {
    if (descriptor) Object.defineProperty(window, "value", descriptor);
    else Reflect.deleteProperty(window, "value");
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(fields));
  vi.stubGlobal("fetch", fetch);
  Reflect.deleteProperty(window, "value");
  await act(async () => {
    await expect(editor.current!.clear("userentity-tools")).rejects.toThrow(ReferenceError);
  });
  expect(label.textContent).toBe("");
  expect(screen.getByRole("link", { name: "Show" })).toBe(show);
  expect(show.getAttribute("href")).toBe(`/files/userfiles/${packed}`);
  expect(input.files?.[0]).toBe(selected);
  Object.defineProperty(window, "value", {
    configurable: true,
    writable: true,
    value: "clear-source",
  });
  await act(async () => editor.current!.clear("userentity-tools"));
  expect(fetch.mock.calls.map(([path]) => String(path))).toEqual([
    "/api/objects/userfields?query[]=entity=userentity-tools",
    "/api/objects/userfields?query[]=entity=userentity-tools",
  ]);
  expect(screen.getByRole("link", { name: "Show" }).getAttribute("href")).toBe(
    "/files/userfiles/clear-source",
  );
  act(() => editor.current!.load({ attachment: "" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(input.getAttribute("data-old-file")).toBe("");
  expect(input.files?.[0]).toBe(selected);
  const afterClear = `${btoa("after-clear.txt")}_${btoa("After clear.txt")}_extra_token`;
  act(() => editor.current!.load({ attachment: afterClear }));
  expect(screen.getByRole("link", { name: "Show" }).getAttribute("href")).toBe(
    `/files/userfiles/${afterClear}`,
  );
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.queryByRole("link", { name: "Show" })).toBeNull();
  expect(input.getAttribute("data-old-file")).toBe("after-clear.txt");
  expect(input.files?.[0]).toBe(selected);
  expect(editor.current!.snapshot().attachment).toMatchObject({
    dirty: true,
    remove: "after-clear.txt",
    upload: { file: selected },
  });
  act(() => editor.current!.load({ attachment: afterClear }));
  // Dispatch an empty FileList change; this is not a browser picker Cancel action.
  await user.upload(input, []);
  expect(input.files).toHaveLength(0);
  expect(label.textContent).toBe("");
  expect(screen.queryByRole("link", { name: "Show" })).toBeNull();
  expect(show.isConnected).toBe(true);
  expect(show.getAttribute("href")).toBe(`/files/userfiles/${afterClear}`);
  expect(editor.current!.snapshot().attachment.readFile?.()).toBeUndefined();
  expect(editor.current!.snapshot().attachment.upload?.file).toBe(selected);
});

test.each(editors)(
  "selected $route stays usable while native Load overwrites only returned controls and preserves dirty edits",
  async (editor) => {
    const app = mountLoad(editor, { required: true });
    const note = await app.ready();
    const form = note.closest("form")!;
    const user = userEvent.setup();

    const save = within(form).getByRole<HTMLButtonElement>("button", {
      name: /^(Save|Save & close|Save & return to quantity units)$/,
    });

    expect(save.disabled).toBe(false);
    expect(note.value).toBe("");

    if (editor.route !== "userobject/tools" && editor.route !== "quantityunitconversion")
      expect(
        screen.getByLabelText<HTMLInputElement>(
          editor.route === "quantityunit" ? "Name in singular form" : "Name",
        ).value,
      ).toBe("Selected record");
    const returned = screen.getByLabelText<HTMLInputElement>("Returned flag");
    const omitted = screen.getByLabelText<HTMLInputElement>("Omitted flag");
    expect(returned.required).toBe(true);
    expect(returned.indeterminate).toBe(false);
    expect(omitted.required).toBe(true);
    await user.type(note, "Natural local draft");
    await user.click(returned);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
    await act(async () =>
      app.load.release(Response.json({ "0": "Stored text", "1": "0", "3": "Clean loaded" })),
    );
    await waitFor(() => expect(note.value).toBe("Stored text"));
    expect(screen.getByLabelText("Late note")).toBe(note);
    expect(note.closest("form")).toBe(form);
    expect(returned.checked).toBe(true);
    expect(returned.required).toBe(false);
    expect(omitted.required).toBe(true);
    expect(omitted.validity.valueMissing).toBe(true);
    await user.click(omitted);
    await user.click(save);
    await waitFor(() =>
      expect(app.writes.filter((row) => row.path.startsWith("/api/userfields/"))).toHaveLength(3),
    );
    expect(app.writes[0].path).toBe(
      `/api/objects/${editor.entity.startsWith("userentity-") ? "userobjects" : editor.entity}/9`,
    );
    expect(
      app.writes.filter((row) => row.path.startsWith("/api/userfields/")).map((row) => row.body),
    ).toEqual([{ "0": "Stored text" }, { "1": "1" }, { "2": "1" }]);
    expect(app.logger).not.toHaveBeenCalled();
  },
);

test.each(
  editors.filter((editor) =>
    ["equipment", "battery", "quantityunit", "quantityunitconversion", "userobject/tools"].includes(
      editor.route,
    ),
  ),
)("selected $route custom-value failure logs and leaves the same form savable", async (editor) => {
  const app = mountLoad(editor);
  const note = await app.ready();
  const user = userEvent.setup();
  await user.type(note, "Retained after read failure");
  await act(async () =>
    app.load.release(Response.json({ error_message: "Private Load failure" }, { status: 503 })),
  );
  await waitFor(() => expect(app.logger).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Late note")).toBe(note);
  expect(note.value).toBe("Retained after read failure");
  expect(screen.queryByText("Private Load failure")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
  await user.click(
    within(note.closest("form")!).getByRole("button", {
      name: /^(Save|Save & close|Save & return to quantity units)$/,
    }),
  );
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes[1]).toEqual({
    path: `/api/userfields/${editor.entity}/9`,
    body: { "0": "Retained after read failure" },
  });
});

test.each(
  editors.filter((editor) =>
    ["battery", "quantityunit", "quantityunitconversion"].includes(editor.route),
  ),
)("selected $route accepts PHP numeric custom-value arrays", async (editor) => {
  const app = mountLoad(editor, { numeric: true });
  const note = await app.ready();
  expect(note.value).toBe("");
  await act(async () => app.load.release(Response.json(["Numeric first", null])));
  await waitFor(() => expect(note.value).toBe("Numeric first"));
  expect(screen.getByLabelText<HTMLInputElement>("Second note").value).toBe("");
  expect(app.logger).not.toHaveBeenCalled();
});

test("warm selected custom values wait for the fresh initial reply and later refetches preserve the draft", async () => {
  const app = mountLoad(editors[1]);
  const key = ["household-object-userfields", "batteries", 9];
  app.client.setQueryData(key, { "0": "Stale cached text" });
  const note = await app.ready();
  expect(note.value).toBe("");
  await act(async () => app.load.release(Response.json({ "0": "Fresh loaded text" })));
  await waitFor(() => expect(note.value).toBe("Fresh loaded text"));
  const user = userEvent.setup();
  await user.clear(note);
  await user.type(note, "Current unsaved draft");
  await act(async () => app.client.refetchQueries({ queryKey: key }));
  expect(note.value).toBe("Current unsaved draft");
  expect(app.reads.filter((read) => read.id === 9)).toHaveLength(2);
  expect(app.writes).toEqual([]);
  expect(app.logger).not.toHaveBeenCalled();
  expect(app.parent).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
});

test("StrictMode warm-ready native form applies its held Load after effect replay", async () => {
  const app = mountLoad(editors[1], { strictWarm: true });
  const note = await app.ready();
  expect(note.value).toBe("");
  await act(async () => app.load.release(Response.json({ "0": "Loaded after replay" })));
  await waitFor(() => expect(note.value).toBe("Loaded after replay"));
  expect(app.logger).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
});

test.each([
  { name: "primitive link", type: "link-with-title", packed: "7", stops: false },
  { name: "null link", type: "link-with-title", packed: "null", stops: true },
  { name: "malformed link", type: "link-with-title", packed: "{", stops: true },
  { name: "malformed file", type: "file", packed: "%_ZGlzcGxheQ==", stops: true },
  { name: "file missing display", type: "file", packed: "ZmlsZS5wZGY=", stops: true },
])(
  "Userobject Load $name preserves native partial callback progression",
  async ({ type, packed, stops }) => {
    const app = mountLoad(editors[9], { callbackType: type });
    const first = await app.ready();
    const later = screen.getByLabelText<HTMLInputElement>("Later note");
    const user = userEvent.setup();
    await user.type(later, "Later local draft");

    if (type === "link-with-title") {
      await user.type(screen.getByLabelText("Title"), "Local title");
      await user.type(screen.getByLabelText("Link"), "https://local.test");
    }

    await act(async () =>
      app.load.release(
        Response.json({ "0": "Earlier applied", "1": packed, "2": "Later applied" }),
      ),
    );
    await waitFor(() => expect(first.value).toBe("Earlier applied"));
    expect(later.value).toBe(stops ? "Later local draft" : "Later applied");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(
      within(first.closest("form")!).getByRole<HTMLButtonElement>("button", { name: "Save" })
        .disabled,
    ).toBe(false);

    if (stops) expect(app.logger).toHaveBeenCalledOnce();
    else {
      expect(app.logger).not.toHaveBeenCalled();
      expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("");
      expect(screen.getByLabelText<HTMLInputElement>("Link").value).toBe("");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(app.writes).toHaveLength(3));
      expect(app.writes[1].body).toEqual({ "1": "7" });
      expect(app.writes[2].body).toEqual({ "2": "Later applied" });
    }
  },
);

test.each(editors.filter((editor) => ["battery", "userobject/tools"].includes(editor.route)))(
  "departed $route Load cannot overwrite the replacement document",
  async (editor) => {
    const app = mountLoad(editor);
    const note = await app.ready();
    const user = userEvent.setup();
    await user.type(note, "Old local draft");
    await act(async () => app.router.navigate({ href: `/${editor.route}/10?embedded` }));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Late note").value).toBe("Replacement loaded"),
    );
    const replacement = screen.getByLabelText<HTMLInputElement>("Late note");
    await user.type(replacement, " live");
    await act(async () =>
      app.load.release(
        Response.json({ "0": "Obsolete loaded", "4": `${btoa("old.pdf")}_${btoa("Old.pdf")}` }),
      ),
    );
    expect(screen.getByLabelText("Late note")).toBe(replacement);
    expect(replacement.value).toBe("Replacement loaded live");
    expect(screen.queryByText("Old.pdf")).toBeNull();
    expect(app.reads.find((read) => read.id === 9)?.signal?.aborted).toBe(true);
    expect(app.writes).toEqual([]);
    expect(app.parent).not.toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    );
    expect(app.logger).not.toHaveBeenCalled();
  },
);
