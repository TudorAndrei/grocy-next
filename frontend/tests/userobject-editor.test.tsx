import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { CustomDataField } from "@/lib/custom-data-context";
import type { JsonObject } from "@/lib/json";

function field(
  name: string,
  type = "text-single-line",
  id = 1,
  required = 0,
  config: string | null = null,
): CustomDataField {
  return {
    id,
    name,
    caption: name,
    type,
    input_required: required,
    config,
    default_value: null,
    entity: "userentity-tools",
    sort_number: id,
    show_as_column_in_tables: 1,
    row_created_timestamp: null,
  };
}

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function mountObject(
  path = "/userobject/tools/new",
  {
    fields = [field("First"), field("Last", "text-single-line", 2)],
    values = {},
    wrongNamespace = false,
    holdPrimary = false,
    heldField = "",
    failField = "",
    holdDelete = false,
    failUpload = false,
    denied = false,
  }: {
    fields?: CustomDataField[];
    values?: Record<string, string | null>;
    wrongNamespace?: boolean;
    holdPrimary?: boolean;
    heldField?: string;
    failField?: string;
    holdDelete?: boolean;
    failUpload?: boolean;
    denied?: boolean;
  } = {},
) {
  const entity = {
    id: 8,
    name: "tools",
    caption: "Tools",
    description: "Workshop",
    show_in_sidebar_menu: 0,
    icon_css_class: null,
  };

  const records = [{ id: 9, userentity_id: wrongNamespace ? 99 : 8 }];
  const savedValues = new Map<number, Record<string, string | null>>([[9, { ...values }]]);
  const writes: Array<{ path: string; body: JsonObject }> = [];
  const files: Array<{ path: string; method: string; body: BodyInit | null | undefined }> = [];
  const signals: { path: string; signal?: AbortSignal | null }[] = [];
  const primary = deferred();
  const metadata = deferred();
  const deletion = deferred();
  let pendingContext: ReturnType<typeof deferred> | undefined;
  const contextReads: number[] = [];
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => messages.mockRestore());

  const app = mountNativeEditor(path, (url, options) => {
    if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: !denied });

    if (url === "/api/objects/userentities") return Response.json([entity]);

    if (url === "/api/objects/userfields?query[]=entity=userentity-tools")
      return Response.json(fields);

    if (url === "/api/objects/userfields") return Response.json(fields);

    if (url === "/api/v2/custom-data/catalog")
      return Response.json({ entities: ["userentity-tools"], field_types: [] });

    if (url === "/api/v2/custom-data/userobjects/tools") {
      const gate = pendingContext;
      contextReads.push(contextReads.length + 1);

      const response = Response.json({
        userentity: entity,
        fields,
        rows: records.flatMap((row) =>
          row.userentity_id === 8 ? [{ ...row, values: savedValues.get(row.id) ?? {} }] : [],
        ),
      });

      return gate ? gate.promise.then(() => response) : response;
    }

    if (url === "/api/v2/custom-data/userobjects/missing")
      return Response.json({ error_message: "Userentity not found" }, { status: 404 });

    if (url === "/api/objects/userobjects/999")
      return Response.json({ error_message: "Object not found" }, { status: 404 });

    if (url === "/api/objects/userobjects/9" && !options?.method)
      return Response.json({ ...records[0], userfields: null });

    if (url.startsWith("/api/userfields/userentity-tools/") && !options?.method) {
      const values = savedValues.get(Number(url.split("/").at(-1))) ?? {};

      return Response.json(
        fields.every((field, index) => field.name === String(index))
          ? fields.map((field) => values[field.name] ?? null)
          : values,
      );
    }

    if (
      (url === "/api/objects/userobjects" || url === "/api/objects/userobjects/9") &&
      options?.method
    ) {
      const body: JsonObject = JSON.parse(String(options.body));
      writes.push({ path: url, body });
      signals.push({ path: url, signal: options.signal });

      return (async () => {
        if (holdPrimary) await primary.promise;

        if (denied) return Response.json({ error_message: "Permission denied" }, { status: 403 });

        if (options.method === "POST") {
          records.push({ id: 31, userentity_id: Number(body.userentity_id) });

          return Response.json({ created_object_id: "31" });
        }

        records[0]!.userentity_id = Number(body.userentity_id);

        return new Response(null, { status: 204 });
      })();
    }

    if (url.startsWith("/api/userfields/userentity-tools/") && options?.method === "PUT") {
      const body: JsonObject = JSON.parse(String(options.body));
      writes.push({ path: url, body });
      signals.push({ path: url, signal: options.signal });
      const name = Object.keys(body)[0]!;

      return (async () => {
        if (name === heldField) await metadata.promise;

        if (name === failField)
          return Response.json({ error_message: "Field failed" }, { status: 500 });
        const id = Number(url.split("/").at(-1));
        const current = savedValues.get(id) ?? {};
        current[name] = String(body[name]);
        savedValues.set(id, current);

        return new Response(null, { status: 204 });
      })();
    }

    if (url.startsWith("/api/files/userfiles/") && options?.method === "GET")
      return new Response("image bytes", { headers: { "Content-Type": "image/png" } });

    if (
      url.startsWith("/api/files/userfiles/") &&
      options?.method &&
      ["PUT", "DELETE"].includes(options.method)
    ) {
      files.push({ path: url, method: options.method, body: options.body });

      return (async () => {
        if (options.method === "DELETE" && holdDelete) await deletion.promise;

        if (options.method === "PUT" && failUpload)
          return Response.json({ error_message: "Upload failed" }, { status: 500 });

        return new Response(null, { status: 204 });
      })();
    }

    return undefined;
  });

  return {
    ...app,
    entity,
    records,
    writes,
    files,
    savedValues,
    signals,
    messages,
    primary,
    metadata,
    deletion,
    fields,
    contextReads,
    holdNextContext: () => {
      const gate = deferred();
      pendingContext = gate;

      return {
        promise: gate.promise,
        release: () => {
          pendingContext = undefined;
          gate.release();
        },
      };
    },
  };
}

test("selected userobject uses its requested namespace fields and can reassign an unscoped selected ID", async () => {
  const app = mountObject("/userobject/tools/9", {
    wrongNamespace: true,
    values: { First: "Existing" },
  });

  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Edit Tools" });
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "First" });
  expect(input.value).toBe("Existing");
  expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
  await user.clear(input);
  await user.type(input, "Reassigned");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/userobjects/tools"));
  expect(app.writes).toEqual([
    { path: "/api/objects/userobjects/9", body: { userentity_id: 8 } },
    { path: "/api/userfields/userentity-tools/9", body: { First: "Reassigned" } },
  ]);
  expect(app.records[0]?.userentity_id).toBe(8);
});

test.each(["First", "Last"])(
  "create launches fields after primary and only the last dirty callback gates Reload, held %s",
  async (heldField) => {
    const app = mountObject("/userobject/tools/new?embedded", {
      holdPrimary: true,
      heldField,
      failField: heldField === "First" ? "First" : "",
    });

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "First" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last" }), "B");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(1));
    expect(app.writes[0]).toEqual({ path: "/api/objects/userobjects", body: { userentity_id: 8 } });
    await act(async () => app.primary.release());
    await waitFor(() => expect(app.writes).toHaveLength(3));

    if (heldField === "First")
      await waitFor(() =>
        expect(app.messages).toHaveBeenCalledWith(
          { Message: "Reload", Payload: null },
          window.location.origin,
        ),
      );
    else
      expect(app.messages).not.toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      );
    expect(app.writes.slice(1)).toEqual([
      { path: "/api/userfields/userentity-tools/31", body: { First: "A" } },
      { path: "/api/userfields/userentity-tools/31", body: { Last: "B" } },
    ]);
    await act(async () => app.metadata.release());
    await waitFor(() =>
      expect(app.messages).toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
  },
);

test("all native custom-field types save their namespace values and file payloads without invented object fields", async () => {
  const BrowserURL = URL;
  vi.stubGlobal(
    "URL",
    class extends BrowserURL {
      static createObjectURL() {
        return "blob:custom-object";
      }
      static revokeObjectURL() {}
    },
  );

  const fields = [
    field("Text"),
    field("Paragraph", "text-multi-line", 2),
    field("Integer", "number-integral", 3),
    field("Decimal", "number-decimal", 4),
    field("Currency", "number-currency", 5),
    field("Day", "date", 6),
    field("Moment", "datetime", 7),
    field("Acknowledged", "checkbox", 8, 1),
    field("Choice", "preset-list", 9, 0, "A\nB"),
    field("Choices", "preset-checklist", 10, 0, "A\nB"),
    field("Website", "link", 11),
    field("Card", "link-with-title", 12),
    field("Manual", "file", 13),
    field("Photo", "image", 14),
  ];

  const app = mountObject("/userobject/tools/new", { fields });
  const user = userEvent.setup();
  const firstInput = await screen.findByRole("textbox", { name: "Text" });
  await waitFor(() => expect(document.activeElement).toBe(firstInput));
  await user.type(firstInput, "Drill");
  await user.type(screen.getByRole("textbox", { name: "Paragraph" }), "Cordless\nBattery");

  for (const [name, value] of [
    ["Integer", "2"],
    ["Decimal", "1.25"],
    ["Currency", "3.75"],
  ])
    await user.type(screen.getByRole("spinbutton", { name }), value!);
  fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2030-01-02" } });
  fireEvent.change(screen.getByLabelText("Moment"), { target: { value: "2030-01-02 03:04:00" } });
  await user.click(screen.getByRole("checkbox", { name: "Acknowledged" }));
  await user.click(screen.getByRole("checkbox", { name: "Acknowledged" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Choice" }), "B");
  await user.selectOptions(screen.getByRole("listbox", { name: "Choices" }), ["A", "B"]);
  await user.type(screen.getByRole("textbox", { name: "Website" }), "https://example.test");
  const card = within(screen.getByRole("group", { name: "Card" }));
  await user.type(card.getByRole("textbox", { name: "Title" }), "Manual");
  await user.type(card.getByRole("textbox", { name: "Link" }), "https://example.test/manual");
  const manual = new File(["manual contents"], "manual.txt", { type: "text/plain" });
  const photo = new File(["photo contents"], "photo.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Manual"), manual);
  await user.upload(screen.getByLabelText("Photo"), photo);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/userobjects/tools"));
  const saved = app.savedValues.get(31);
  expect(saved).toMatchObject({
    Text: "Drill",
    Paragraph: "Cordless\nBattery",
    Integer: "2",
    Decimal: "1.25",
    Currency: "3.75",
    Day: "2030-01-02",
    Moment: "2030-01-02 03:04:00",
    Acknowledged: "0",
    Choice: "B",
    Choices: "A,B",
    Website: "https://example.test",
    Card: JSON.stringify({ title: "Manual", link: "https://example.test/manual" }),
  });
  expect(app.writes[0]?.body).toEqual({ userentity_id: 8 });
  expect(app.files).toHaveLength(2);
  expect(app.files.map((file) => file.body)).toEqual([manual, photo]);
  expect(atob(saved!.Manual!.split("_")[1]!)).toBe("manual.txt");
  expect(atob(saved!.Photo!.split("_")[1]!)).toBe("photo.png");
});

test("a failed final metadata PUT stays silently busy and never reports a completed object", async () => {
  const app = mountObject("/userobject/tools/new?embedded", { failField: "Last" });
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Last" }), "B");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  await act(async () => {});
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(screen.queryByText("Field failed")).toBeNull();
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  expect(app.records.some((row) => row.id === 31)).toBe(true);
});

test("file upload failure keeps the saved metadata and native busy form with a generic error", async () => {
  const app = mountObject("/userobject/tools/new?embedded", {
    fields: [field("Manual", "file")],
    failUpload: true,
  });

  const user = userEvent.setup();
  await user.upload(
    await screen.findByLabelText("Manual"),
    new File(["contents"], "manual.txt", { type: "text/plain" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  await within(screen.getByRole("dialog", { name: "Error details" })).findByText(/Upload failed/);
  expect(app.savedValues.get(31)?.Manual).toBeTruthy();
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
});

test.each(["primary", "metadata", "delete"])(
  "departure during held %s prevents later custom-file stages and receipt",
  async (stage) => {
    const stored = `${btoa("old.txt")}_${btoa("old.txt")}`;

    const app = mountObject(
      stage === "primary" ? "/userobject/tools/new?embedded" : "/userobject/tools/9?embedded",
      {
        fields: [field("Manual", "file")],
        values: stage === "delete" ? { Manual: stored } : {},
        holdPrimary: stage === "primary",
        heldField: stage === "metadata" ? "Manual" : "",
        holdDelete: stage === "delete",
      },
    );

    const user = userEvent.setup();
    const input = await screen.findByLabelText("Manual");

    if (stage === "delete") await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.upload(input, new File(["new contents"], "new.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        stage === "primary"
          ? app.writes.length
          : stage === "metadata"
            ? app.writes.length
            : app.files.length,
      ).toBe(stage === "delete" ? 1 : stage === "metadata" ? 2 : 1),
    );
    await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
    await act(async () => {
      app.primary.release();
      app.metadata.release();
      app.deletion.release();
    });
    expect(app.files.filter((file) => file.method === "PUT")).toHaveLength(0);
    expect(app.messages).not.toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    );
    expect(app.router.state.location.pathname).toBe("/settings");
  },
);

test.each([
  ["/userobject/missing/new", "Userentity not found"],
  ["/userobject/tools/999", "Object not found"],
])(
  "missing namespace or selected object never becomes an unselected create editor %s",
  async (path, message) => {
    const app = mountObject(path);
    await screen.findByText(message);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(app.writes).toHaveLength(0);
  },
);

test("numeric custom-field names load the native PHP array response without losing namespace values", async () => {
  mountObject("/userobject/tools/9", {
    fields: [field("0"), field("1", "text-single-line", 2)],
    values: { "0": "First value", "1": "Second value" },
  });
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "0" }).value).toBe("First value"),
  );
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "1" }).value).toBe("Second value");
});

test("native required stored files block unchanged edit submission", async () => {
  const stored = `${btoa("old.txt")}_${btoa("old.txt")}`;

  const app = mountObject("/userobject/tools/9", {
    fields: [field("Manual", "file", 1, 1)],
    values: { Manual: stored },
  });

  const user = userEvent.setup();
  const input = await screen.findByLabelText("Manual");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  expect(input).toHaveProperty("required", true);
});

test.each(["new", "9"])(
  "list to object %s waits for fresh namespace fields and later refetches preserve the initialized draft",
  async (objectId) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2030, 0, 2, 12));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const app = mountObject("/userobjects/tools");
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "First" });
    // Production keeps query data fresh for 30 seconds even when definitions change externally.
    app.client.setQueryDefaults(["custom-data-objects"], { staleTime: 30_000 });
    app.fields.push({ ...field("Created day", "date", 3, 1), default_value: "now" });

    if (objectId === "9") app.savedValues.get(9)!["Created day"] = "2024-05-06";
    const expectedDate = objectId === "new" ? "2030-01-02" : "2024-05-06";
    const before = app.contextReads.length;
    const fresh = app.holdNextContext();

    const href =
      objectId === "new"
        ? screen.getByRole("link", { name: "Add" }).getAttribute("href")!
        : `/userobject/tools/${objectId}?embedded`;

    await act(async () => app.router.navigate({ href }));
    await waitFor(() => expect(app.contextReads.length).toBeGreaterThan(before));
    await act(async () => fresh.release());
    const date = await screen.findByLabelText<HTMLInputElement>("Created day");
    await waitFor(() => expect(date.value).toBe(expectedDate));
    const first = screen.getByRole<HTMLInputElement>("textbox", { name: "First" });
    await user.type(first, "Unsaved draft");
    const previous = app.contextReads.length;
    const later = app.holdNextContext();
    let refreshing: Promise<void> | undefined;
    await act(async () => {
      refreshing = app.client.refetchQueries({ queryKey: ["custom-data-objects", "tools"] });
    });
    await waitFor(() => expect(app.contextReads.length).toBeGreaterThan(previous));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "First" }).value).toBe(
      "Unsaved draft",
    );
    await act(async () => {
      later.release();
      await refreshing;
    });
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "First" }).value).toBe(
      "Unsaved draft",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Created day").value).toBe(expectedDate);
  },
);

test("an authenticated reader receives native primary permission denial before fields are written", async () => {
  const app = mountObject("/userobject/tools/9", { denied: true });
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "First" }), "Denied");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  await within(screen.getByRole("dialog", { name: "Error details" })).findByText(
    /Permission denied/,
  );
  expect(app.writes).toHaveLength(1);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false);
});

test.each(["?embedded=0", "?embedded=&embedded=0"])(
  "native userobject embedded presence emits Reload for %s",
  async (query) => {
    const app = mountObject(`/userobject/tools/new${query}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.messages).toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(app.router.state.location.pathname).toBe("/userobject/tools/new");
  },
);

test("encoded embedded key does not replace the native userobject return navigation", async () => {
  const app = mountObject("/userobject/tools/new?%65mbedded=0");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/userobjects/tools"));
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
});

test("Userobject unchanged Arrow keyup is native dirty while untouched fields remain omitted", async () => {
  const app = mountObject("/userobject/tools/9?embedded", {
    fields: [field("First"), field("Clean", "text-single-line", 2)],
    values: { First: "Unchanged object note", Clean: "Untouched" },
  });

  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("First"));
  await user.keyboard("{ArrowLeft}");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(app.writes).toEqual([
    { path: "/api/objects/userobjects/9", body: { userentity_id: 8 } },
    { path: "/api/userfields/userentity-tools/9", body: { First: "Unchanged object note" } },
  ]);
  expect(
    app.messages.mock.calls
      .map(([bag]) => bag)
      .filter((bag) =>
        ["Reload", "Ready", "CloseLastModal", "ShoppingListChanged"].includes(bag?.Message),
      ),
  ).toEqual([{ Message: "Reload", Payload: null }]);
});

test("Userobject common Save reads late disabled DOM values and an earlier acknowledgement cannot overwrite a newer controlled draft", async () => {
  const app = mountObject("/userobject/tools/new?embedded", {
    holdPrimary: true,
    heldField: "First",
    failField: "Last",
  });

  const first = await screen.findByLabelText<HTMLInputElement>("First");
  await userEvent.type(first, "Before primary");
  await userEvent.type(screen.getByLabelText("Last"), "Final metadata fails");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(first.matches(":disabled")).toBe(true);
  // Controlled callback timing probe, not natural user typing through disabled controls.
  first.value = "Changed while primary held";
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.writes).toHaveLength(3));
  expect.soft(app.writes).toEqual([
    { path: "/api/objects/userobjects", body: { userentity_id: 8 } },
    { path: "/api/userfields/userentity-tools/31", body: { First: "Changed while primary held" } },
    { path: "/api/userfields/userentity-tools/31", body: { Last: "Final metadata fails" } },
  ]);
  // A synthetic change isolates acknowledgement ownership; no ordinary post-failure Retry is claimed.
  fireEvent.change(first, { target: { value: "Newer controlled draft" } });
  await act(async () => app.metadata.release());
  expect(first.value).toBe("Newer controlled draft");
  expect(first.matches(":disabled")).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(screen.queryByText("Field failed")).toBeNull();
});

test("Userobject earlier metadata settling after actual reparented-document departure stales old/new context reads without another completion", async () => {
  const app = mountObject("/userobject/tools/9?embedded", {
    wrongNamespace: true,
    heldField: "First",
  });

  await userEvent.type(await screen.findByLabelText("First"), "Earlier value");
  await userEvent.type(screen.getByLabelText("Last"), "Last completes");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(app.writes[0]).toEqual({ path: "/api/objects/userobjects/9", body: { userentity_id: 8 } });
  expect(app.records[0]!.userentity_id).toBe(8);
  const earlier = app.signals.find((request) => request.path.startsWith("/api/userfields/"))!;
  await act(async () => app.router.navigate({ href: "/userobjects/tools" }));
  await screen.findByRole("columnheader", { name: "First" });

  app.client.setQueryData(["custom-data-objects", "prior-tools"], {
    userentity: { ...app.entity, id: 99, name: "prior-tools", caption: "Prior tools" },
    fields: [],
    rows: [],
  });

  const keys = [
    ["custom-data-objects", "tools"],
    ["custom-data-objects", "prior-tools"],
    ["objects", "userobjects"],
  ];

  for (const key of keys) {
    // Warm reads represent data fetched after the last-field completion, before the earlier write settles.
    app.client.setQueryData(key, app.client.getQueryData(key) ?? []);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  expect(earlier.signal?.aborted).toBe(true);
  const count = app.writes.length;
  const messages = app.messages.mock.calls.length;
  await act(async () => app.metadata.release());

  for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(app.writes).toHaveLength(count);
  expect(app.messages).toHaveBeenCalledTimes(messages);
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
});

test.each([
  { initial: "?embedded", replacement: "?%65mbedded=1&unknown", reload: false },
  { initial: "?%65mbedded=1", replacement: "?embedded&embedded=0", reload: true },
])(
  "Userobject last callback reads current literal embedded after $initial → $replacement",
  async ({ initial, replacement, reload }) => {
    const app = mountObject(`/userobject/tools/9${initial}`, { heldField: "Last" });
    const last = await screen.findByLabelText<HTMLInputElement>("Last");
    await userEvent.type(last, "Pending current draft");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(2));
    await act(async () => app.router.history.replace(`/userobject/tools/9${replacement}`));
    expect(screen.getByLabelText("Last")).toBe(last);
    expect(app.signals.at(-1)!.signal?.aborted).toBe(false);
    await act(async () => app.metadata.release());

    if (reload) {
      await waitFor(() =>
        expect(app.messages).toHaveBeenCalledWith(
          { Message: "Reload", Payload: null },
          window.location.origin,
        ),
      );
      expect(app.router.state.location.pathname).toBe("/userobject/tools/9");
    } else {
      await waitFor(() => expect(app.router.state.location.pathname).toBe("/userobjects/tools"));
      expect(app.messages).not.toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      );
    }

    expect(
      app.messages.mock.calls.some(([bag]) =>
        ["ShoppingListChanged", "Ready", "CloseLastModal"].includes(bag?.Message),
      ),
    ).toBe(false);
  },
);
