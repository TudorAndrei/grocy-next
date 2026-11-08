import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";

const types = [
  "checkbox",
  "date",
  "datetime",
  "number-integral",
  "number-decimal",
  "number-currency",
  "file",
  "image",
  "link",
  "link-with-title",
  "preset-checklist",
  "preset-list",
  "text-single-line",
  "text-multi-line",
];

const selected = {
  id: 5,
  entity: "products",
  name: "pantry_note",
  caption: "Pantry note",
  type: "preset-list",
  input_required: 1,
  default_value: "now",
  config: "First\nSecond",
  sort_number: 0,
  show_as_column_in_tables: 1,
  userfields: null,
};

function mount(path: string, respond: Parameters<typeof mountNativeEditor>[1] = () => undefined) {
  return mountNativeEditor(path, async (url, init) => {
    const response = await respond(url, init);

    if (response) return response;

    if (url === "/api/v2/custom-data/catalog")
      return Response.json({
        entities: ["batteries", "products", "userentity-tools", "users"],
        field_types: types,
      });

    if (url === "/api/objects/userfields/5") return Response.json(selected);

    return undefined;
  });
}

test("selected definition loads its native fields and preserves hidden configuration through type changes", async () => {
  let body: unknown;
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  mount("/userfield/5?embedded=0&entity=users", (url, init) => {
    if (url === "/api/objects/userfields/5" && init?.method === "PUT") {
      body = JSON.parse(String(init.body));

      return new Response(null, { status: 204 });
    }

    return undefined;
  });
  const user = userEvent.setup();
  expect((await screen.findByLabelText<HTMLSelectElement>("Entity")).value).toBe("users");
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("pantry_note");
  expect(screen.getByLabelText<HTMLInputElement>("Sort number").value).toBe("");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Configuration").value).toBe("First\nSecond");
  const config = screen.getByLabelText<HTMLTextAreaElement>("Configuration");
  await user.click(config);
  await user.keyboard("{End}{Enter}");
  expect(config.value).toBe("First\nSecond\n");
  expect(body).toBeUndefined();
  const type = screen.getByLabelText("Type");
  expect(
    within(type)
      .getAllByRole<HTMLOptionElement>("option")
      .map((option) => option.value),
  ).toEqual(["", ...types]);
  await user.selectOptions(type, "datetime");
  expect(screen.queryByRole("textbox", { name: "Configuration" })).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>("Default value").value).toBe("now");
  await user.selectOptions(type, "checkbox");
  expect(screen.queryByRole("combobox", { name: "Default value" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "Show as column in tables" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(body).toEqual({
      entity: "users",
      name: "pantry_note",
      caption: "Pantry note",
      type: "checkbox",
      sort_number: "",
      config: "First\r\nSecond\r\n",
      default_value: "now",
      show_as_column_in_tables: "0",
      input_required: "1",
    }),
  );
  expect(parent).toHaveBeenCalledWith({ Message: "Reload", Payload: null }, window.location.origin);
});

test("create defaults, type dependencies and checkbox Enter save preserve the original entity return filter", async () => {
  let body: unknown;

  const app = mount("/userfield/new?entity=products", (url, init) => {
    if (url === "/api/objects/userfields" && init?.method === "POST") {
      body = JSON.parse(String(init.body));

      return Response.json({ created_object_id: "12" });
    }

    return undefined;
  });

  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("");
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Mandatory" }).checked).toBe(false);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Show as column in tables" }).checked,
  ).toBe(false);
  await user.type(name, "inspection");
  await user.type(screen.getByLabelText("Caption"), "Inspection");

  for (const type of types) {
    await user.selectOptions(screen.getByLabelText("Type"), type);
    expect(screen.queryByRole("textbox", { name: "Configuration" }) !== null).toBe(
      type === "preset-list" || type === "preset-checklist",
    );
    expect(screen.queryByRole("combobox", { name: "Default value" }) !== null).toBe(
      type === "date" || type === "datetime",
    );
  }

  await user.selectOptions(screen.getByLabelText("Type"), "date");
  await user.selectOptions(screen.getByLabelText("Default value"), "now");
  await user.selectOptions(screen.getByLabelText("Entity"), "userentity-tools");
  await user.click(screen.getByRole("button", { name: "Increase Sort number" }));
  const mandatory = screen.getByRole<HTMLInputElement>("checkbox", { name: "Mandatory" });
  mandatory.focus();

  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    bubbles: true,
    cancelable: true,
  });

  fireEvent(mandatory, enter);
  expect(enter.defaultPrevented).toBe(true);
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/userfields"));
  expect(app.router.state.location.search).toEqual({ entity: "products" });
  expect(body).toEqual({
    entity: "userentity-tools",
    name: "inspection",
    caption: "Inspection",
    sort_number: "1",
    type: "date",
    config: "",
    default_value: "now",
    show_as_column_in_tables: "0",
    input_required: "0",
  });
});

test("unknown entity overrides cannot save, and internal names and sort numbers enforce native constraints", async () => {
  let writes = 0;
  mount("/userfield/new?entity=unknown", (url, init) => {
    if (url === "/api/objects/userfields" && init?.method === "POST") writes++;

    return undefined;
  });
  const user = userEvent.setup();
  const entity = await screen.findByLabelText<HTMLSelectElement>("Entity");
  expect(entity.value).toBe("");
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  await user.type(name, "invalid-name");
  await user.type(screen.getByLabelText("Caption"), "Caption");
  await user.selectOptions(screen.getByLabelText("Type"), "text-single-line");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toBe(0);
  expect(entity.validity.valueMissing).toBe(true);
  await user.selectOptions(entity, "products");
  expect(name.validity.patternMismatch).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toBe(0);
  await user.clear(name);
  await user.type(name, "valid_name2");
  const sort = screen.getByLabelText<HTMLInputElement>("Sort number");
  await user.type(sort, "-1");
  expect(sort.validity.rangeUnderflow).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toBe(0);
  await user.clear(sort);
  await user.type(sort, "1.5");
  expect(sort.validity.stepMismatch).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toBe(0);
});

test("native readers can edit and a denied write preserves values, error details and a working retry", async () => {
  let writes = 0;
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  mount("/userfield/new?embedded=false", (url, init) => {
    if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: false });

    if (url === "/api/objects/userfields" && init?.method === "POST") {
      writes++;

      return writes === 1
        ? Response.json({ error_message: "Permission denied" }, { status: 403 })
        : Response.json({ created_object_id: "12" });
    }

    return undefined;
  });
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.matches(":disabled")).toBe(false);
  await user.selectOptions(screen.getByLabelText("Entity"), "users");
  await user.type(name, "access_note");
  await user.type(screen.getByLabelText("Caption"), "Access note");
  await user.selectOptions(screen.getByLabelText("Type"), "text-multi-line");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  const details = await screen.findByRole("dialog", { name: "Error details" });
  expect(within(details).getByText(/Permission denied/)).toBeTruthy();
  await user.click(within(details).getByRole("button", { name: "OK" }));
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(name.value).toBe("access_note");
  expect(name.matches(":disabled")).toBe(false);
  expect(parent).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(parent).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(writes).toBe(2);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
});

test("a selected definition read error retries its own ID and malformed IDs cannot fetch or save", async () => {
  let reads = 0;

  const app = mount("/userfield/5", (url) => {
    if (url === "/api/objects/userfields/5") {
      reads++;

      return reads === 1
        ? Response.json({ error_message: "Selected field missing" }, { status: 404 })
        : Response.json({ ...selected, sort_number: "" });
    }

    return undefined;
  });

  await screen.findByText("Selected field missing");
  expect(screen.queryByLabelText("Name")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("pantry_note");
  expect(screen.getByLabelText<HTMLInputElement>("Sort number").value).toBe("");
  expect(reads).toBe(2);
  await act(async () => {
    await app.router.navigate({ href: "/userfield/not-an-id" });
  });
  await screen.findByText("Object not found");
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(app.fetchMock.mock.calls.some(([url]) => String(url).includes("userfields/NaN"))).toBe(
    false,
  );
});

test.each(["success", "failure"])(
  "a definition save completing with %s after departure cannot redirect, close, or report errors on its replacement",
  async (outcome) => {
    let release: ((response: Response) => void) | undefined;

    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    let started = false;
    let signal: AbortSignal | null | undefined;

    const app = mount("/userfield/5?embedded", (url, init) => {
      if (url === "/api/objects/userfields/5" && init?.method === "PUT") {
        started = true;
        signal = init.signal;

        return held;
      }

      return undefined;
    });

    const user = userEvent.setup();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(started).toBe(true));
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Name").matches(":disabled")).toBe(true);
    await act(async () => {
      await app.router.navigate({ href: "/userfield/new?entity=users" });
    });
    await screen.findByRole("heading", { name: "Create userfield" });
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    await user.type(await screen.findByLabelText("Name"), "Replacement");
    const keys = warmDefinitionReads(app);
    expect.soft(signal?.aborted).toBe(true);
    await act(async () => {
      release?.(
        outcome === "success"
          ? new Response(null, { status: 204 })
          : Response.json({ error_message: "Late definition failure" }, { status: 503 }),
      );
      await held;
    });

    for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(app.router.state.location.pathname).toBe("/userfield/new");
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Replacement");
    expect(parent).not.toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    );
    expect(screen.queryByText("Late definition failure")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Error while saving, probably this item already exists/,
      }),
    ).toBeNull();
  },
);

test.each([
  { query: "?entity", selectedEntity: "", returned: "?entity=true" },
  {
    query: "?entity=products&entity=users",
    selectedEntity: "products",
    returned: "?entity=products",
  },
  { query: "?entity=users&entity=products", selectedEntity: "users", returned: "?entity=users" },
  { query: "?entity=&entity=users", selectedEntity: "products", returned: "" },
  { query: "?%65ntity=users", selectedEntity: "products", returned: "" },
  { query: "?entity=false", selectedEntity: "", returned: "?entity=false" },
  { query: "?entity=0", selectedEntity: "", returned: "?entity=0" },
  { query: "?entity=users%2Bteam", selectedEntity: "", returned: "?entity=users+team" },
])(
  "native first raw entity parameter controls selection and the return filter for $query",
  async ({ query, selectedEntity, returned }) => {
    let writes = 0;

    const app = mount(`/userfield/5${query}`, (url, init) => {
      if (url === "/api/objects/userfields/5" && init?.method === "PUT") {
        writes++;

        return new Response(null, { status: 204 });
      }

      return undefined;
    });

    const user = userEvent.setup();
    const entity = await screen.findByLabelText<HTMLSelectElement>("Entity");
    expect(entity.value).toBe(selectedEntity);

    if (!selectedEntity) {
      expect(entity.validity.valueMissing).toBe(true);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(writes).toBe(0);
      await user.selectOptions(entity, "users");
    }

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/userfields"));
    expect(app.router.history.location.search).toBe(returned);
    expect(writes).toBe(1);
  },
);

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function warmDefinitionReads(app: ReturnType<typeof mount>) {
  const values = [
    { key: ["objects", "userfields"], value: [selected] },
    { key: ["custom-data-fields"], value: [selected] },
    {
      key: ["custom-data-objects", "tools"],
      value: {
        userentity: {
          id: 8,
          name: "tools",
          caption: "Tools",
          description: null,
          show_in_sidebar_menu: 0,
          icon_css_class: null,
        },
        fields: [],
        rows: [],
      },
    },
  ];

  for (const { key, value } of values) {
    app.client.setQueryData(key, value);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  return values.map(({ key }) => key);
}

test("Userfield primary reads actual main DOM text and includes hidden enabled config/default controls", async () => {
  let body: unknown;
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  mount("/userfield/5?embedded", (url, init) => {
    if (url === "/api/objects/userfields/5" && !init?.method)
      return Response.json({
        ...selected,
        name: "pantry_\rnote\n",
        caption: "Pantry\r Caption\n",
        show_as_column_in_tables: 2,
        input_required: 2,
      });

    if (url === "/api/objects/userfields/5" && init?.method === "PUT") {
      body = JSON.parse(String(init.body));

      return new Response(null, { status: 204 });
    }

    return undefined;
  });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("pantry_note");
  expect(screen.getByLabelText<HTMLInputElement>("Caption").value).toBe("Pantry Caption");
  expect(screen.getByLabelText<HTMLInputElement>("Mandatory").checked).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Show as column in tables").checked).toBe(false);
  await userEvent.selectOptions(screen.getByLabelText("Type"), "text-single-line");
  expect(screen.queryByRole("textbox", { name: "Configuration" })).toBeNull();
  expect(screen.getByLabelText<HTMLTextAreaElement>("Configuration").disabled).toBe(false);
  expect(screen.queryByRole("combobox", { name: "Default value" })).toBeNull();
  await userEvent.type(screen.getByLabelText("Sort number"), "7");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(parent).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(body).toEqual({
    entity: "products",
    name: "pantry_note",
    caption: "Pantry Caption",
    type: "text-single-line",
    sort_number: "7",
    config: "First\r\nSecond",
    default_value: "now",
    show_as_column_in_tables: "0",
    input_required: "0",
  });
});

test.each([
  { after: "?entity=batteries&%65mbedded=1", reload: false },
  { after: "?entity=batteries&embedded&embedded=0", reload: true },
])(
  "same Userfield document retains its draft, captures redirect entity at Save and reads embedded at completion: $after",
  async ({ after, reload }) => {
    const gate = deferred();
    let body: unknown;
    let signal: AbortSignal | null | undefined;
    let started = false;
    const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

    const app = mount("/userfield/5?entity=products", async (url, init) => {
      if (url === "/api/objects/userfields/5" && init?.method === "PUT") {
        body = JSON.parse(String(init.body));
        signal = init.signal;
        started = true;
        await gate.promise;

        return new Response(null, { status: 204 });
      }

      return undefined;
    });

    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    const caption = screen.getByLabelText<HTMLInputElement>("Caption");
    await userEvent.clear(caption);
    await userEvent.type(caption, "Retained caption draft");
    await act(async () => app.router.history.replace("/userfield/5?entity=users&entity=products"));
    expect(screen.getByLabelText("Name")).toBe(name);
    expect(caption.value).toBe("Retained caption draft");
    expect(screen.getByLabelText<HTMLSelectElement>("Entity").value).toBe("products");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(started).toBe(true));
    await act(async () => app.router.history.replace(`/userfield/5${after}`));
    expect(screen.getByLabelText("Name")).toBe(name);
    expect(caption.value).toBe("Retained caption draft");
    expect(signal?.aborted).toBe(false);
    await act(async () => gate.release());

    if (reload) {
      await waitFor(() =>
        expect(parent).toHaveBeenCalledWith(
          { Message: "Reload", Payload: null },
          window.location.origin,
        ),
      );
      expect(app.router.state.location.pathname).toBe("/userfield/5");
    } else {
      await waitFor(() => expect(app.router.state.location.pathname).toBe("/userfields"));
      expect(app.router.history.location.search).toBe("?entity=users");
      expect(parent).not.toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      );
    }

    expect(body).toMatchObject({ entity: "products", caption: "Retained caption draft" });
  },
);

test("native Userfield success does not wait for an unrelated active catalog read", async () => {
  const gate = deferred();
  onTestFinished(() => gate.release());
  let reads = 0;
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const app = mount("/userfield/5?embedded", async (url, init) => {
    if (url === "/api/v2/custom-data/catalog") {
      reads++;

      if (reads > 1) await gate.promise;

      return Response.json({ entities: ["products", "users"], field_types: types });
    }

    if (url === "/api/objects/userfields/5" && init?.method === "PUT")
      return new Response(null, { status: 204 });

    return undefined;
  });

  await screen.findByLabelText("Name");
  let refreshing: Promise<void> | undefined;
  await act(async () => {
    refreshing = app.client.refetchQueries({ queryKey: ["custom-data-catalog"] });
  });
  await waitFor(() => expect(reads).toBe(2));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(parent).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(reads).toBe(2);
  await act(async () => {
    gate.release();
    await refreshing;
  });
});
