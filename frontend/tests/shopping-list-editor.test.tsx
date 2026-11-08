import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import type { UserfieldDefinition } from "@/lib/userfields";
import { mountNativeEditor } from "./fixtures/native-editor";
import { pictureBytes } from "./fixtures/picture";

const field = (
  name: string,
  overrides: Partial<UserfieldDefinition> = {},
): UserfieldDefinition => ({
  id: name === "First" ? 1 : 2,
  name,
  caption: name,
  type: "text-single-line",
  input_required: 0,
  default_value: null,
  config: null,
  ...overrides,
});

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountList(
  path = "/shoppinglist/7",
  {
    fields = [field("First"), field("Last")],
    values = { First: "Stored first", Last: "Stored last" },
    holdPrimary = false,
    heldField = "",
    holdUpload = false,
    holdDelete = false,
    denied = false,
    failField = "",
    failUpload = false,
    recordName = "Selected trip",
    individualMetadata = false,
  }: {
    fields?: UserfieldDefinition[];
    values?: Record<string, string | null>;
    holdPrimary?: boolean;
    heldField?: string;
    holdUpload?: boolean;
    holdDelete?: boolean;
    denied?: boolean;
    failField?: string;
    failUpload?: boolean;
    recordName?: string;
    individualMetadata?: boolean;
  } = {},
) {
  const records = [{ id: 7, name: recordName, description: "Unchanged list notes" }];
  const stored = new Map<number, Record<string, string | null>>([[7, { ...values }]]);
  const writes: { path: string; body: JsonObject }[] = [];
  const files: { path: string; method: string; body: BodyInit | null | undefined }[] = [];
  const sequence: string[] = [];
  const signals: { path: string; signal?: AbortSignal | null }[] = [];

  const metadataRequests: { gate: ReturnType<typeof deferred>; name: string; body: JsonObject }[] =
    [];

  const primary = deferred();
  const metadata = deferred();
  const upload = deferred();
  const deletion = deferred();
  const context = deferred();
  let heldContext = false;
  let primaryDenied = denied;
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => {
    messages.mockRestore();
  });

  const app = mountNativeEditor(
    path,
    (url, options) => {
      if (url === "/api/objects/userfields?query[]=entity=shopping_lists")
        return Response.json(fields);

      if (url.startsWith("/api/userfields/shopping_lists/") && !options?.method)
        return Response.json(stored.get(Number(url.split("/").at(-1))) ?? {});

      if (url === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (url === "/api/v2/user/permissions")
        return Response.json({ MASTER_DATA_EDIT: false, SHOPPINGLIST_ITEMS_ADD: !primaryDenied });

      if (
        url === "/api/v2/shopping-lists/editor" ||
        url.startsWith("/api/v2/shopping-lists/editor?")
      ) {
        const raw = new URL(url, "http://localhost").searchParams.get("list_id");
        const record = raw === null ? null : records.find((row) => row.id === Number(raw));

        if (record === undefined)
          return Response.json({ error_message: "Selected list missing" }, { status: 404 });

        const response = Response.json({
          list: record === null ? null : { id: record.id, name: record.name },
          fields,
          values: record === null ? {} : (stored.get(record.id) ?? {}),
        });

        return heldContext ? context.promise.then(() => response) : response;
      }

      if (
        (url === "/api/objects/shopping_lists" && options?.method === "POST") ||
        (/^\/api\/objects\/shopping_lists\/\d+$/.test(url) && options?.method === "PUT")
      ) {
        const body: JsonObject = JSON.parse(String(options?.body));
        writes.push({ path: url, body });
        signals.push({ path: url, signal: options?.signal });
        sequence.push("name");

        return (async () => {
          if (holdPrimary) await primary.promise;

          if (primaryDenied)
            return Response.json({ error_message: "List write denied" }, { status: 403 });

          if (options?.method === "POST") {
            records.push({ id: 8, name: String(body.name), description: "" });

            return Response.json({ created_object_id: "8" });
          }

          const record = records.find((row) => row.id === Number(url.split("/").at(-1)))!;
          record.name = String(body.name);

          return new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/userfields/shopping_lists/") && options?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(options.body));
        const name = Object.keys(body)[0]!;
        writes.push({ path: url, body });
        sequence.push("field");
        signals.push({ path: url, signal: options.signal });
        const own = deferred();
        metadataRequests.push({ gate: own, name, body });

        return (async () => {
          if (name === heldField) await (individualMetadata ? own.promise : metadata.promise);

          if (name === failField)
            return Response.json({ error_message: "List field failed" }, { status: 503 });
          const id = Number(url.split("/").at(-1));
          stored.set(id, { ...stored.get(id), [name]: String(body[name]) });

          return new Response(null, { status: 204 });
        })();
      }

      if (
        url.startsWith("/api/files/userfiles/") &&
        options?.method &&
        ["PUT", "DELETE"].includes(options.method)
      ) {
        files.push({ path: url, method: options.method, body: options.body });
        sequence.push(options.method === "DELETE" ? "delete" : "upload");

        return (async () => {
          if (options.method === "PUT" && holdUpload) await upload.promise;

          if (options.method === "DELETE" && holdDelete) await deletion.promise;

          if (options.method === "PUT" && failUpload)
            return Response.json({ error_message: "List upload failed" }, { status: 503 });

          return new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/files/userfiles/") && !options?.method)
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

      return undefined;
    },
    { FEATURE_FLAG_SHOPPINGLIST: true, FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: true },
  );

  const receipts = () =>
    messages.mock.calls
      .map(([message]) => message)
      .filter((message) =>
        ["ShoppingListChanged", "Ready", "CloseLastModal"].includes(message.Message),
      );

  return {
    ...app,
    writes,
    files,
    sequence,
    signals,
    metadataRequests,
    records,
    stored,
    primary,
    metadata,
    upload,
    deletion,
    context,
    receipts,
    messages,
    allowWrite: () => {
      primaryDenied = false;
    },
    holdContext: () => {
      heldContext = true;
    },
  };
}

test("selected shopping-list editor loads the path record and ordered fields independently of list query", async () => {
  const app = mountList("/shoppinglist/7?list=99&embedded");
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("Selected trip");
  expect(screen.getByLabelText<HTMLInputElement>("First").value).toBe("Stored first");
  expect(screen.getByLabelText<HTMLInputElement>("Last").value).toBe("Stored last");
  expect(screen.queryByLabelText("Description")).toBeNull();
  expect(app.records[0]?.description).toBe("Unchanged list notes");
  expect(app.writes).toEqual([]);
});

test.each([
  { mode: "create", held: "First" },
  { mode: "create", held: "Last" },
  { mode: "edit", held: "First" },
  { mode: "edit", held: "Last" },
])("$mode follows native parallel last-dirty callbacks with $held held", async ({ mode, held }) => {
  const creating = mode === "create";
  const path = creating ? "/shoppinglist/new" : "/shoppinglist/7?embedded=0";
  const app = mountList(path, { holdPrimary: creating, heldField: held });
  const user = userEvent.setup();
  const name = await screen.findByLabelText("Name");
  await user.clear(name);
  await user.type(name, "Travel");
  await user.clear(screen.getByLabelText("First"));
  await user.type(screen.getByLabelText("First"), "A");
  await user.clear(screen.getByLabelText("Last"));
  await user.type(screen.getByLabelText("Last"), "B");
  await user.click(screen.getByRole("button", { name: "Save" }));

  if (creating) {
    await waitFor(() =>
      expect(app.writes).toEqual([
        { path: "/api/objects/shopping_lists", body: { name: "Travel" } },
      ]),
    );
    expect(app.receipts()).toEqual([]);
    await act(async () => app.primary.release());
  }

  await waitFor(() =>
    expect(app.writes.filter((write) => write.path.startsWith("/api/userfields/"))).toHaveLength(2),
  );
  expect(document.body.classList.contains("cursor-busy")).toBe(true);

  if (held === "Last") {
    expect(app.receipts()).toEqual([]);

    if (!creating)
      expect(app.writes.some((write) => write.path.startsWith("/api/objects/"))).toBe(false);
  } else await waitFor(() => expect(app.receipts()).toHaveLength(3));
  await act(async () => app.metadata.release());
  await waitFor(() =>
    expect(app.receipts()).toEqual([
      { Message: "ShoppingListChanged", Payload: creating ? "8" : 7 },
      { Message: "Ready", Payload: null },
      { Message: "CloseLastModal", Payload: null },
    ]),
  );

  const custom = [
    { path: `/api/userfields/shopping_lists/${creating ? 8 : 7}`, body: { First: "A" } },
    { path: `/api/userfields/shopping_lists/${creating ? 8 : 7}`, body: { Last: "B" } },
  ];

  expect(app.writes).toEqual(
    creating
      ? [{ path: "/api/objects/shopping_lists", body: { name: "Travel" } }, ...custom]
      : [...custom, { path: "/api/objects/shopping_lists/7", body: { name: "Travel" } }],
  );
  expect(app.router.state.location.pathname).toBe(
    creating ? "/shoppinglist/new" : "/shoppinglist/7",
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  expect(app.records[0]?.description).toBe("Unchanged list notes");
});

test.each(["create", "edit"])(
  "native %s primary denial restores its draft and retries the original save order",
  async (mode) => {
    const creating = mode === "create";

    const app = mountList(creating ? "/shoppinglist/new?embedded" : "/shoppinglist/7", {
      fields: [field("First")],
      denied: true,
    });

    const user = userEvent.setup();
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    expect(name.matches(":disabled")).toBe(false);
    await user.clear(name);
    await user.type(name, "Draft trip");
    await user.clear(screen.getByLabelText("First"));
    await user.type(screen.getByLabelText("First"), "Draft note");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(
      await screen.findByRole("button", {
        name: /Error while saving, probably this item already exists/,
      }),
    );
    const details = await screen.findByRole("dialog", { name: "Error details" });
    expect(within(details).getByText(/List write denied/)).toBeTruthy();
    await user.click(within(details).getByRole("button", { name: "OK" }));
    expect(name.value).toBe("Draft trip");
    expect(name.matches(":disabled")).toBe(false);
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(app.receipts()).toEqual([]);
    expect(app.writes.map((write) => write.path)).toEqual(
      creating
        ? ["/api/objects/shopping_lists"]
        : ["/api/userfields/shopping_lists/7", "/api/objects/shopping_lists/7"],
    );
    app.allowWrite();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.receipts()).toHaveLength(3));
    expect(app.writes.map((write) => write.path)).toEqual(
      creating
        ? [
            "/api/objects/shopping_lists",
            "/api/objects/shopping_lists",
            "/api/userfields/shopping_lists/8",
          ]
        : [
            "/api/userfields/shopping_lists/7",
            "/api/objects/shopping_lists/7",
            "/api/userfields/shopping_lists/7",
            "/api/objects/shopping_lists/7",
          ],
    );
  },
);

test("a failed final metadata write stays silently busy and does not rename the list", async () => {
  const app = mountList("/shoppinglist/7", { fields: [field("First")], failField: "First" });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " changed");
  await user.type(screen.getByLabelText("First"), " changed");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => {
    await Promise.resolve();
  });
  expect(app.writes[0]?.path).toBe("/api/userfields/shopping_lists/7");
  expect(app.records[0]?.name).toBe("Selected trip");
  expect(app.receipts()).toEqual([]);
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
});

test("recovering from an edit primary denial resends the selected file under fresh upload metadata", async () => {
  const app = mountList("/shoppinglist/7", {
    fields: [field("First", { type: "file" })],
    values: {},
    denied: true,
  });

  const user = userEvent.setup();
  const file = new File(["Repeated contents"], "Receipt.txt", { type: "text/plain" });
  await user.upload(await screen.findByLabelText("First"), file);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  expect(app.files).toHaveLength(1);
  expect(app.receipts()).toEqual([]);
  app.allowWrite();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(3));
  expect(app.files.map((file) => file.body)).toEqual([file, file]);
  expect(app.files[0]?.path).not.toBe(app.files[1]?.path);
  const stored = app.stored.get(7)?.First ?? "";
  expect(atob(stored.split("_")[1]!)).toBe("receipt.txt");
  expect(app.files.at(-1)?.path).toBe(
    `/api/files/userfiles/${encodeURIComponent(stored.split("_")[0]!)}`,
  );
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/userfields/shopping_lists/7",
    "/api/objects/shopping_lists/7",
    "/api/userfields/shopping_lists/7",
    "/api/objects/shopping_lists/7",
  ]);
});

test("a late nonfinal file failure reports details after the final dirty field has already completed", async () => {
  const app = mountList("/shoppinglist/7", {
    fields: [field("First", { type: "file" }), field("Last")],
    values: { First: null, Last: "" },
    holdUpload: true,
    failUpload: true,
  });

  const user = userEvent.setup();
  await user.upload(
    await screen.findByLabelText("First"),
    new File(["manual"], "Manual.TXT", { type: "text/plain" }),
  );
  await user.type(screen.getByLabelText("Last"), "Final note");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(3));
  expect(app.files).toHaveLength(1);
  expect(app.stored.get(7)?.First).toBeTruthy();
  await act(async () => app.upload.release());
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  const details = await screen.findByRole("dialog", { name: "Error details" });
  expect(within(details).getByText(/List upload failed/)).toBeTruthy();
  expect(app.receipts()).toHaveLength(3);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
});

test("required stored custom files block unchanged edit submission before native writes", async () => {
  const old = `${btoa("old.txt")}_${btoa("Old.txt")}`;

  const app = mountList("/shoppinglist/7", {
    fields: [field("First", { type: "file", input_required: 1 })],
    values: { First: old },
  });

  const user = userEvent.setup();
  const file = await screen.findByLabelText<HTMLInputElement>("First");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(file.validity.valueMissing).toBe(true);
  expect(app.writes).toEqual([]);
  expect(app.files).toEqual([]);
  expect(app.receipts()).toEqual([]);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
});

test.each(["select then delete", "delete then select"])(
  "native stored-file Delete retains selection and original removal flag: %s",
  async (order) => {
    const old = `${btoa("old.txt")}_${btoa("Old.txt")}`;

    const app = mountList("/shoppinglist/7", {
      fields: [field("First", { type: "file" })],
      values: { First: old },
      holdDelete: true,
    });

    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("First");
    const replacement = new File(["Replacement bytes"], "New.txt", { type: "text/plain" });

    if (order === "select then delete") {
      await user.upload(input, replacement);
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(input.files?.[0]).toBe(replacement);
      expect(screen.getByText("No file selected")).toBeTruthy();
    } else {
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByText("No file selected")).toBeTruthy();
      await user.upload(input, replacement);
      expect(screen.getByText("New.txt")).toBeTruthy();
    }

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.files).toHaveLength(1));
    expect(app.files[0]).toEqual({
      path: `/api/files/userfiles/${encodeURIComponent(btoa("old.txt"))}`,
      method: "DELETE",
      body: undefined,
    });
    expect(app.sequence).toEqual(["field", "delete"]);
    expect(app.receipts()).toEqual([]);
    const stored = app.stored.get(7)?.First ?? "";
    expect(atob(stored.split("_")[1]!)).toBe("new.txt");
    await act(async () => app.deletion.release());
    await waitFor(() => expect(app.receipts()).toHaveLength(3));
    expect(app.sequence).toEqual(["field", "delete", "upload", "name"]);
    expect(app.files[1]).toEqual({
      path: `/api/files/userfiles/${encodeURIComponent(stored.split("_")[0]!)}`,
      method: "PUT",
      body: replacement,
    });
  },
);

test.each(["create", "empty edit"])(
  "native file Delete is inert without an initial stored file: %s",
  async (mode) => {
    const creating = mode === "create";

    const app = mountList(creating ? "/shoppinglist/new" : "/shoppinglist/7", {
      fields: [field("First", { type: "file" })],
      values: {},
    });

    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("First");
    expect(screen.getByText("No file selected")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    if (creating) await user.type(screen.getByLabelText("Name"), "New list");
    const replacement = new File(["New file bytes"], "New.txt", { type: "text/plain" });
    await user.upload(input, replacement);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(input.files?.[0]).toBe(replacement);
    expect(screen.getByText("New.txt")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.receipts()).toHaveLength(3));
    expect(app.files.map((file) => file.method)).toEqual(["PUT"]);
    expect(app.files[0]?.body).toBe(replacement);
  },
);

test.each([true, false])(
  "native image file selection hides the old preview without creating a replacement preview, stored=%s",
  async (stored) => {
    const createObjectURL = vi.fn(() => "blob:stored-image");
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    const old = `${btoa("old.png")}_${btoa("Old.png")}`;
    mountList(stored ? "/shoppinglist/7" : "/shoppinglist/new", {
      fields: [field("First", { type: "image" })],
      values: stored ? { First: old } : {},
    });
    const user = userEvent.setup();
    const input = await screen.findByLabelText<HTMLInputElement>("First");

    if (stored) {
      const preview = await screen.findByRole("img", { name: "First" });
      expect(preview.getAttribute("href")).toBe(`/files/userfiles/${old}`);
      expect(preview.getAttribute("src")).toBe(
        `/files/userfiles/${old}?force_serve_as=picture&best_fit_width=250&best_fit_height=250`,
      );
    } else expect(screen.queryByRole("img", { name: "First" })).toBeNull();
    const replacement = new File([pictureBytes], "New.png", { type: "image/png" });
    await user.upload(input, replacement);
    expect(screen.queryByRole("img", { name: "First" })).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("img", { name: "First" })).toBeNull();
    expect(input.files?.[0]).toBe(replacement);
    expect(screen.getByText(stored ? "No file selected" : "New.png")).toBeTruthy();
  },
);

test("a failed final file upload preserves committed metadata while remaining busy without a primary edit", async () => {
  const app = mountList("/shoppinglist/7", {
    fields: [field("First", { type: "file" })],
    values: {},
    failUpload: true,
  });

  const user = userEvent.setup();
  await user.upload(await screen.findByLabelText("First"), new File(["data"], "data.txt"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: /Error while saving/ });
  expect(app.stored.get(7)?.First).toBeTruthy();
  expect(app.writes).toHaveLength(1);
  expect(app.receipts()).toEqual([]);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
});

test("fresh context initializes cached create defaults once and background metadata does not reset the draft", async () => {
  const fields = [field("Today", { type: "date", default_value: "now", input_required: 1 })];
  const app = mountList("/settings?tab=connection", { fields });
  app.client.setQueryData(["shopping-list-editor", undefined], {
    list: null,
    fields: [],
    values: {},
  });
  app.holdContext();
  await act(async () => {
    await app.router.navigate({ href: "/shoppinglist/new" });
  });
  expect(screen.queryByLabelText("Name")).toBeNull();
  await act(async () => app.context.release());
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  const today = screen.getByLabelText<HTMLInputElement>("Today");
  expect(today.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
  expect(name.validity.valueMissing).toBe(true);
  expect(app.writes).toEqual([]);
  await userEvent.setup().type(name, "Fresh draft");
  fields.push(field("Later", { default_value: "Ignored" }));
  await act(async () => {
    await app.client.invalidateQueries({ queryKey: ["shopping-list-editor"] });
  });
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Fresh draft");
  expect(screen.queryByLabelText("Later")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(3));
  expect(app.writes).toEqual([
    { path: "/api/objects/shopping_lists", body: { name: "Fresh draft" } },
  ]);
});

test.each(["primary", "metadata", "delete"])(
  "departing during held %s cancels later field stages and native receipts",
  async (stage) => {
    const old = `${btoa("old.txt")}_${btoa("Old.txt")}`;

    const app = mountList(stage === "primary" ? "/shoppinglist/new" : "/shoppinglist/7", {
      fields: [field("First", { type: "file" })],
      values: { First: old },
      holdPrimary: stage === "primary",
      heldField: stage === "metadata" ? "First" : "",
      holdDelete: stage === "delete",
    });

    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");

    if (stage === "primary") await user.type(name, "New held list");

    if (stage === "delete") await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.upload(screen.getByLabelText("First"), new File(["pending"], "pending.txt"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stage === "delete" ? app.files.length : app.writes.length).toBe(1));
    const replacement = stage === "primary" ? "/shoppinglist/7" : "/shoppinglist/new";
    await act(async () => {
      await app.router.navigate({ href: replacement });
    });
    await screen.findByRole("heading", {
      name: stage === "primary" ? "Edit shopping list" : "Create shopping list",
    });
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    await act(async () => {
      app.primary.release();
      app.metadata.release();
      app.deletion.release();
    });
    expect(app.files.filter((file) => file.method === "PUT")).toHaveLength(0);

    if (stage === "primary") expect(app.writes).toHaveLength(1);
    else
      expect(app.writes.some((write) => write.path === "/api/objects/shopping_lists/7")).toBe(
        false,
      );
    expect(app.receipts()).toEqual([]);
    expect(app.router.state.location.pathname).toBe(replacement);
    expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
  },
);

test.each(["not-an-id", "0", "999"])(
  "invalid or missing selected shopping-list ID %s cannot become a create form",
  async (id) => {
    const app = mountList(`/shoppinglist/${id}`);
    await screen.findByText(id === "999" ? "Selected list missing" : "Object not found");
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(app.writes).toEqual([]);

    if (id !== "999")
      expect(
        app.fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith("/api/v2/shopping-lists/editor"),
        ),
      ).toBe(false);
  },
);

test("Shopping native unchanged Arrow keyup is dirty, untouched fields stay omitted, and imported Name uses actual DOM text", async () => {
  const app = mountList("/shoppinglist/7", {
    fields: [field("First"), field("Clean")],
    values: { First: "Unchanged note", Clean: "Untouched" },
    recordName: "Imported\rList\nName",
  });

  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("ImportedListName");
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("First"));
  await user.keyboard("{ArrowLeft}");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(3));
  expect
    .soft(app.writes.find((write) => write.path === "/api/objects/shopping_lists/7")?.body)
    .toEqual({ name: "ImportedListName" });
  expect(app.writes).toEqual([
    { path: "/api/userfields/shopping_lists/7", body: { First: "Unchanged note" } },
    { path: "/api/objects/shopping_lists/7", body: { name: "ImportedListName" } },
  ]);
  expect(app.receipts()).toEqual([
    { Message: "ShoppingListChanged", Payload: 7 },
    { Message: "Ready", Payload: null },
    { Message: "CloseLastModal", Payload: null },
  ]);
});

test("Shopping create reads the current disabled DOM field only when primary reaches common Save", async () => {
  const app = mountList("/shoppinglist/new", { fields: [field("First")], holdPrimary: true });
  await userEvent.type(await screen.findByLabelText("Name"), "Captured list name");
  const first = screen.getByLabelText<HTMLInputElement>("First");
  await userEvent.type(first, "Before primary");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(first.matches(":disabled")).toBe(true);
  // Controlled phase probe, not a user edit: the source callback reads disabled controls here.
  first.value = "Changed while primary held";
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.receipts()).toHaveLength(3));
  expect(app.writes).toEqual([
    { path: "/api/objects/shopping_lists", body: { name: "Captured list name" } },
    { path: "/api/userfields/shopping_lists/8", body: { First: "Changed while primary held" } },
  ]);
  expect(app.receipts()[0]).toEqual({ Message: "ShoppingListChanged", Payload: "8" });
});

test("Shopping earlier metadata settling after real departure stales replacement reads without repeating completion", async () => {
  const app = mountList("/shoppinglist/7", { heldField: "First" });
  await screen.findByLabelText("Name");
  await userEvent.type(screen.getByLabelText("First"), " earlier");
  await userEvent.type(screen.getByLabelText("Last"), " final");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(3));
  const earlier = app.signals.find((request) => request.path.startsWith("/api/userfields/"))!;
  await act(async () => app.router.navigate({ href: "/shoppinglist/new" }));
  await screen.findByRole("heading", { name: "Create shopping list" });
  const keys = [["shopping-lists"], ["objects", "shopping_lists"]];

  for (const key of keys) {
    app.client.setQueryData(key, []);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  expect(earlier.signal?.aborted).toBe(true);
  const count = app.writes.length;
  await act(async () => app.metadata.release());

  for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(app.writes).toHaveLength(count);
  expect(app.receipts()).toHaveLength(3);
  expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
});

test("Shopping natural primary-error overlap uploads current file bytes under the older pending metadata name without clearing the next draft", async () => {
  const stored = `${btoa("stored.pdf")}_${btoa("Stored.pdf")}`;

  const app = mountList("/shoppinglist/7", {
    fields: [field("First", { type: "file" }), field("Last")],
    values: { First: stored, Last: "" },
    denied: true,
    heldField: "First",
    individualMetadata: true,
  });

  const input = await screen.findByLabelText<HTMLInputElement>("First");
  const firstFile = new File(["First file bytes"], "First.pdf", { type: "application/pdf" });
  const secondFile = new File(["Second file bytes"], "Second.pdf", { type: "application/pdf" });
  await userEvent.upload(input, firstFile);
  await userEvent.click(within(input.closest(".field")!).getByRole("button", { name: "Delete" }));
  await userEvent.type(screen.getByLabelText("Last"), "First final");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: /Error while saving/ });
  await waitFor(() => expect(input.matches(":disabled")).toBe(false));
  expect(app.files).toEqual([]);
  await userEvent.upload(input, secondFile);
  await userEvent.clear(screen.getByLabelText("Name"));
  await userEvent.type(screen.getByLabelText("Name"), "Second name");
  await userEvent.type(screen.getByLabelText("Last"), " Second final");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.writes.filter((write) => write.path.startsWith("/api/objects/"))).toHaveLength(2),
  );
  await waitFor(() => expect(input.matches(":disabled")).toBe(false));
  const metadata = app.metadataRequests.filter((request) => request.name === "First");
  expect(metadata).toHaveLength(2);
  expect(metadata[0]!.body.First).not.toBe(metadata[1]!.body.First);
  await act(async () => metadata[0]!.gate.release());
  await waitFor(() => expect(app.files).toHaveLength(2));
  expect(app.files[0]).toEqual({
    path: `/api/files/userfiles/${encodeURIComponent(btoa("stored.pdf"))}`,
    method: "DELETE",
    body: undefined,
  });
  expect(app.files[1]!.body).toBe(secondFile);
  expect(app.files[1]!.path).toBe(
    `/api/files/userfiles/${encodeURIComponent(String(metadata[0]!.body.First).split("_")[0]!)}`,
  );
  expect(await readFileText(app.files[1]!.body)).toBe("Second file bytes");
  expect(input.files?.[0]).toBe(secondFile);
  expect(app.receipts()).toEqual([]);
  app.allowWrite();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.receipts()).toHaveLength(3));
  const next = app.metadataRequests.filter((request) => request.name === "First");
  expect(next).toHaveLength(3);
  expect(next[2]!.body.First).not.toBe(next[1]!.body.First);
  await act(async () => {
    next[1]!.gate.release();
    next[2]!.gate.release();
  });
});

function readFileText(body: BodyInit | null | undefined) {
  if (!(body instanceof Blob)) throw new Error("Expected actual Shopping attachment bytes");

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(body);
  });
}
