import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import type { UserfieldDefinition } from "@/lib/userfields";

test("native task creation assigns the current user with no due date and add another resets the form", async () => {
  const { router, fetchMock } = mountNativeEditor(
    "/task/new?returnto=%2Foutside",
    (url, options) => {
      if (url === "/api/objects/tasks" && options?.method === "POST")
        return Response.json({ created_object_id: "14" });

      return undefined;
    },
  );

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Check smoke alarm");
  expect(screen.getByLabelText<HTMLInputElement>("Due").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Assigned to").value).toBe("Household owner");
  await user.click(screen.getByRole("button", { name: "Save & add another task" }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(""));
  expect(router.state.location.pathname).toBe("/task/new");
  expect(router.state.location.search).toEqual({});

  const write = fetchMock.mock.calls.find(
    ([url, options]) => String(url) === "/api/objects/tasks" && options?.method === "POST",
  );

  expect(JSON.parse(String(write?.[1]?.body))).toEqual({
    name: "Check smoke alarm",
    description: "",
    due_date: "",
    category_id: "",
    assigned_to_user_id: "7",
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/users")).toBe(false);
});

test("the searchable task assignee commits a display-name choice without submitting the task", async () => {
  const { fetchMock } = mountNativeEditor("/task/new", (url, options) =>
    url === "/api/objects/tasks" && options?.method === "POST"
      ? Response.json({ created_object_id: "14" })
      : undefined,
  );

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Assigned task");
  const picker = screen.getByRole("combobox", { name: "Assigned to" });
  expect(picker.tagName).toBe("INPUT");
  await user.clear(picker);
  await user.type(picker, "alex");
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText<HTMLInputElement>("Assigned to").value).toBe("Alex");
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save & close" }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true),
  );

  const write = fetchMock.mock.calls.find(
    ([url, options]) => String(url) === "/api/objects/tasks" && options?.method === "POST",
  );

  expect(JSON.parse(String(write?.[1]?.body)).assigned_to_user_id).toBe("2");
});

test("saving with an assignee menu open waits for selection or dismissal instead of posting a draft", async () => {
  const { fetchMock } = mountNativeEditor("/task/new", (url, options) =>
    url === "/api/objects/tasks" && options?.method === "POST"
      ? Response.json({ created_object_id: "14" })
      : undefined,
  );

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Optional assignee");
  const picker = screen.getByRole<HTMLInputElement>("combobox", { name: "Assigned to" });
  await user.clear(picker);
  await user.type(picker, "Al");
  await screen.findByRole("listbox", { name: "Assigned to" });
  await user.click(screen.getByRole("button", { name: "Save & close" }));
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  expect(picker.value).toBe("");
  await waitFor(() => expect(picker.getAttribute("aria-expanded")).toBe("false"));
  await user.click(screen.getByRole("button", { name: "Save & close" }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true),
  );

  const write = fetchMock.mock.calls.find(
    ([url, options]) => String(url) === "/api/objects/tasks" && options?.method === "POST",
  );

  expect(JSON.parse(String(write?.[1]?.body)).assigned_to_user_id).toBe("");
});

test("native selected task edit shows a date-only due value, preserves its assignment and omits completed state", async () => {
  const { router, fetchMock } = mountNativeEditor("/task/9", (url, options) => {
    if (url === "/api/objects/tasks/9" && options?.method !== "PUT")
      return Response.json({
        id: 9,
        name: "Selected task",
        description: "Details",
        due_date: "2027-01-04 18:30:00",
        category_id: 3,
        assigned_to_user_id: 2,
        done: 1,
      });

    return undefined;
  });

  const user = userEvent.setup();
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("Selected task");
  expect(screen.getByLabelText<HTMLInputElement>("Due").value).toBe("2027-01-04");
  expect(screen.getByLabelText<HTMLSelectElement>("Category").value).toBe("3");
  expect(screen.getByLabelText<HTMLInputElement>("Assigned to").value).toBe("Alex");
  expect(screen.queryByLabelText("Completed")).toBeNull();
  fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2028-03-12" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));

  const write = fetchMock.mock.calls.find(
    ([url, options]) => String(url) === "/api/objects/tasks/9" && options?.method === "PUT",
  );

  expect(JSON.parse(String(write?.[1]?.body))).toEqual({
    name: "Selected task",
    description: "Details",
    due_date: "2028-03-12",
    category_id: "3",
    assigned_to_user_id: "2",
  });
});

test("inactive task categories and missing assigned users start blank on edit", async () => {
  mountNativeEditor("/task/9", (url) =>
    url === "/api/objects/tasks/9"
      ? Response.json({
          id: 9,
          name: "Inactive links",
          category_id: 99,
          assigned_to_user_id: 99,
          due_date: null,
        })
      : undefined,
  );
  await screen.findByLabelText("Name");
  expect(screen.getByLabelText<HTMLSelectElement>("Category").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Assigned to").value).toBe("");
});

test.each([false, true])(
  "embedded task creation uses Reload for close and a fresh embedded form for add-another (%s)",
  async (another) => {
    const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

    const { router } = mountNativeEditor(
      "/task/new?embedded=&returnto=%2Foutside",
      (url, options) =>
        url === "/api/objects/tasks" && options?.method === "POST"
          ? Response.json({ created_object_id: "11" })
          : undefined,
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Task");
    await user.click(
      screen.getByRole("button", { name: another ? "Save & add another task" : "Save & close" }),
    );

    if (another) {
      await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(""));
      expect(router.state.location.search).toEqual({ embedded: "" });
      expect(parent).not.toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      );
    } else {
      await waitFor(() =>
        expect(parent).toHaveBeenCalledWith(
          { Message: "Reload", Payload: null },
          window.location.origin,
        ),
      );
    }

    expect(router.state.location.pathname).toBe("/task/new");
  },
);

test.each(["new", "4"])(
  "native task category %s saves the selected object before its userfields",
  async (categoryId) => {
    const writes: string[] = [];

    const { router, fetchMock } = mountNativeEditor(
      `/taskcategory/${categoryId}`,
      (url, options) => {
        if (
          url === "/api/objects/userfields" ||
          url === "/api/objects/userfields?query[]=entity=tasks" ||
          url === "/api/objects/userfields?query[]=entity=task_categories" ||
          url === "/api/v2/custom-data/fields"
        )
          return Response.json([notesField("task_categories")]);

        if (url === "/api/objects/task_categories/4" && options?.method !== "PUT")
          return Response.json({
            id: 4,
            name: "Old category",
            active: 0,
            description: "Category description",
          });

        if (url === "/api/userfields/task_categories/4") {
          if (options?.method === "PUT") writes.push("custom");

          return Response.json({ note: "Existing note" });
        }

        if (url === "/api/objects/task_categories" && options?.method === "POST") {
          writes.push("object");

          return Response.json({ created_object_id: "4" });
        }

        if (url === "/api/objects/task_categories/4" && options?.method === "PUT") {
          writes.push("object");

          return Response.json({});
        }

        return undefined;
      },
    );

    const user = userEvent.setup();
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(categoryId === "new");
    expect(screen.getByLabelText("Description").tagName).toBe("TEXTAREA");
    await waitFor(() => expect(name.matches(":disabled")).toBe(false));
    await user.clear(name);
    await user.type(name, "Home");
    await user.clear(screen.getByLabelText("Owner note"));
    await user.type(screen.getByLabelText("Owner note"), "Category note");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/taskcategories"));
    expect(writes).toEqual(["object", "custom"]);

    const write = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).startsWith("/api/objects/task_categories") &&
        ["POST", "PUT"].includes(options?.method ?? ""),
    );

    expect(JSON.parse(String(write?.[1]?.body))).toEqual({
      name: "Home",
      active: categoryId === "new" ? "1" : "0",
      description: categoryId === "new" ? "" : "Category description",
    });
  },
);

test("embedded task category save reloads its parent without navigating", async () => {
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const { router } = mountNativeEditor("/taskcategory/new?embedded", (url, options) =>
    url === "/api/objects/task_categories" && options?.method === "POST"
      ? Response.json({ created_object_id: "4" })
      : undefined,
  );

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Home");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(parent).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(router.state.location.pathname).toBe("/taskcategory/new");
});

function taskGate() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountTaskSave(
  path = "/task/new?embedded=0",
  options: {
    hold?: string[];
    fail?: string[];
    noGrant?: boolean;
    due?: string | null;
    fields?: Array<UserfieldDefinition & { entity: string }>;
  } = {},
) {
  const held = new Set(options.hold ?? []);
  const failing = new Set(options.fail ?? []);
  const gates = new Map<string, ReturnType<typeof taskGate>>();

  const calls: {
    stage: string;
    path: string;
    method: string;
    body?: Record<string, string>;
    file?: BodyInit | null;
    signal?: AbortSignal | null;
  }[] = [];

  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const oldFile = "old-task.pdf";

  const values = {
    zeta: "",
    clean: "Untouched",
    same: "Retained value",
    alpha: "",
    attachment: `${btoa(oldFile)}_${btoa("Old task.pdf")}`,
  };

  const definitions = options.fields ?? [
    { ...notesField("tasks"), id: 1, name: "zeta", caption: "First note" },
    {
      ...notesField("tasks"),
      id: 2,
      name: "clean",
      caption: "Clean note",
      default_value: "Untouched",
    },
    {
      ...notesField("tasks"),
      id: 3,
      name: "same",
      caption: "Existing note",
      default_value: "Retained value",
    },
    { ...notesField("tasks"), id: 4, name: "alpha", caption: "Final note" },
    { ...notesField("tasks"), id: 5, name: "attachment", caption: "Attachment", type: "file" },
  ];

  const gate = (stage: string) => {
    if (!gates.has(stage)) gates.set(stage, taskGate());

    return gates.get(stage)!;
  };

  const respond = async (stage: string, result: () => Response) => {
    if (held.has(stage)) await gate(stage).promise;

    return failing.has(stage)
      ? Response.json(
          { error_message: `Task ${stage} denied` },
          { status: stage === "primary" ? 403 : 503 },
        )
      : result();
  };

  const app = mountNativeEditor(path, (url, init) => {
    if (url === "/api/v2/user/permissions")
      return Response.json(options.noGrant ? {} : { MASTER_DATA_EDIT: true });

    if (
      url === "/api/v2/custom-data/fields" ||
      url === "/api/objects/userfields" ||
      url === "/api/objects/userfields?query[]=entity=tasks" ||
      url === "/api/objects/userfields?query[]=entity=task_categories"
    )
      return Response.json(definitions);

    if (url === "/api/objects/tasks/9" && init?.method !== "PUT")
      return Response.json({
        id: 9,
        name: "Selected task",
        description: "Details",
        due_date: options.due ?? null,
        category_id: 3,
        assigned_to_user_id: 2,
      });

    if (url === "/api/userfields/tasks/9" && init?.method !== "PUT") return Response.json(values);

    if (
      (url === "/api/objects/tasks" && init?.method === "POST") ||
      (url === "/api/objects/tasks/9" && init?.method === "PUT")
    ) {
      const body: Record<string, string> = JSON.parse(String(init.body));

      const id =
        init.method === "POST" ? 41 + calls.filter((call) => call.stage === "primary").length : 9;

      calls.push({ stage: "primary", path: url, method: init.method, body, signal: init.signal });

      return respond("primary", () =>
        init.method === "POST"
          ? Response.json({ created_object_id: String(id) })
          : new Response(null, { status: 204 }),
      );
    }

    if (/^\/api\/userfields\/tasks\/\d+$/.test(url) && init?.method === "PUT") {
      const body: Record<string, string> = JSON.parse(String(init.body));
      const stage = Object.keys(body)[0]!;
      calls.push({ stage, path: url, method: "PUT", body, signal: init.signal });

      return respond(stage, () => new Response(null, { status: 204 }));
    }

    if (url.startsWith("/api/files/userfiles/") && init?.method) {
      const stage = init.method === "DELETE" ? "delete" : "upload";
      calls.push({ stage, path: url, method: init.method, file: init.body, signal: init.signal });

      return respond(stage, () => new Response(null, { status: 204 }));
    }

    return undefined;
  });

  return {
    ...app,
    calls,
    messages,
    logger,
    oldFile,
    allow(stage: string) {
      failing.delete(stage);
    },
    async release(stage: string) {
      await act(async () => gate(stage).release());
    },
    reloads: () => messages.mock.calls.filter(([bag]) => bag?.Message === "Reload"),
  };
}

async function taskFileDraft(app: ReturnType<typeof mountTaskSave>) {
  await screen.findByLabelText("Name");
  await userEvent.type(screen.getByLabelText("First note"), "Earlier note");
  const input = screen.getByLabelText<HTMLInputElement>("Attachment");
  const file = new File(["Native task attachment"], "proof.pdf", { type: "application/pdf" });
  await userEvent.upload(input, file);
  await userEvent.click(within(input.closest(".field")!).getByRole("button", { name: "Delete" }));
  expect(input.files?.[0]).toBe(file);
  expect(app.calls).toEqual([]);

  return file;
}

function taskUploadText(body: BodyInit | null | undefined) {
  if (!(body instanceof Blob)) throw new Error("Expected actual task file bytes");

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(body);
  });
}

test.each(["new", "9"])(
  "native Task %s saves dirty fields in DOM order and the last callback completes before earlier fields",
  async (taskId) => {
    const app = mountTaskSave(`/task/${taskId}?embedded=0`, {
      hold: ["primary", "zeta", "same", "alpha"],
    });

    const name = await screen.findByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Ordered task");
    await userEvent.type(screen.getByLabelText("Final note"), "Last edited first");
    await userEvent.type(screen.getByLabelText("First note"), "First edited second");
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Existing note"));
    await user.keyboard("{ArrowLeft}");
    await user.click(
      screen.getByRole("button", { name: taskId === "new" ? "Save & close" : "Save" }),
    );
    await waitFor(() => expect(app.calls).toHaveLength(1));
    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("First note").matches(":disabled")).toBe(true);
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    await app.release("primary");
    await waitFor(() =>
      expect(app.calls.filter((call) => call.stage !== "primary")).toHaveLength(3),
    );
    expect(
      app.calls.map((call) => ({ method: call.method, path: call.path, body: call.body })),
    ).toEqual([
      {
        method: taskId === "new" ? "POST" : "PUT",
        path: taskId === "new" ? "/api/objects/tasks" : "/api/objects/tasks/9",
        body: {
          name: "Ordered task",
          description: taskId === "new" ? "" : "Details",
          due_date: "",
          category_id: taskId === "new" ? "" : "3",
          assigned_to_user_id: taskId === "new" ? "7" : "2",
        },
      },
      {
        method: "PUT",
        path: `/api/userfields/tasks/${taskId === "new" ? 41 : 9}`,
        body: { zeta: "First edited second" },
      },
      {
        method: "PUT",
        path: `/api/userfields/tasks/${taskId === "new" ? 41 : 9}`,
        body: { same: taskId === "new" ? "" : "Retained value" },
      },
      {
        method: "PUT",
        path: `/api/userfields/tasks/${taskId === "new" ? 41 : 9}`,
        body: { alpha: "Last edited first" },
      },
    ]);
    expect(app.reloads()).toEqual([]);
    await app.release("alpha");
    await waitFor(() =>
      expect(app.messages).toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    await app.release("same");
    await app.release("zeta");
    expect(app.reloads()).toHaveLength(1);
  },
);

test("native selected Task final metadata failure stays silently busy without a partial-save Retry", async () => {
  const app = mountTaskSave("/task/9?embedded", { hold: ["zeta", "alpha"], fail: ["alpha"] });
  await screen.findByLabelText("Name");
  await userEvent.type(screen.getByLabelText("First note"), "Earlier");
  await userEvent.type(screen.getByLabelText("Final note"), "Final");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.calls.filter((call) => ["zeta", "alpha"].includes(call.stage))).toHaveLength(2),
  );
  expect(app.calls[0]!.path).toBe("/api/objects/tasks/9");
  await app.release("alpha");
  await app.release("zeta");
  expect(app.reloads()).toEqual([]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Task alpha denied|The record is saved/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByLabelText("Final note").matches(":disabled")).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
});

for (const outcome of ["delete", "upload", "success"] as const) {
  test(`native Task file ${outcome} follows metadata/Delete/upload stages while retaining busy ownership`, async () => {
    const app = mountTaskSave("/task/9?embedded=0", {
      hold: ["zeta", "attachment", "delete", "upload"],
      fail: outcome === "success" ? [] : [outcome],
    });

    await taskFileDraft(app);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.calls.filter((call) => ["zeta", "attachment"].includes(call.stage))).toHaveLength(
        2,
      ),
    );
    expect(app.calls.some((call) => ["delete", "upload"].includes(call.stage))).toBe(false);
    const value = app.calls.find((call) => call.stage === "attachment")!.body!.attachment!;
    expect(atob(value.split("_")[1]!)).toBe("proof.pdf");
    await app.release("attachment");
    await waitFor(() => expect(app.calls.some((call) => call.stage === "delete")).toBe(true));
    expect(app.calls.find((call) => call.stage === "delete")!.path).toBe(
      `/api/files/userfiles/${encodeURIComponent(btoa(app.oldFile))}`,
    );
    expect(app.calls.some((call) => call.stage === "upload")).toBe(false);
    await app.release("delete");

    if (outcome !== "delete") {
      await waitFor(() => expect(app.calls.some((call) => call.stage === "upload")).toBe(true));
      const upload = app.calls.find((call) => call.stage === "upload")!;
      expect(atob(decodeURIComponent(upload.path.split("/").at(-1)!))).toBe(
        atob(value.split("_")[0]!),
      );
      expect(await taskUploadText(upload.file)).toBe("Native task attachment");
      expect(app.reloads()).toEqual([]);
      await app.release("upload");
    }

    if (outcome === "success") {
      await waitFor(() =>
        expect(app.messages).toHaveBeenCalledWith(
          { Message: "Reload", Payload: null },
          window.location.origin,
        ),
      );
      expect(app.reloads()).toHaveLength(1);
    } else {
      expect(
        await screen.findByText("Error while saving, probably this item already exists"),
      ).toBeTruthy();
      expect(app.reloads()).toEqual([]);
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

      if (outcome === "delete")
        expect(app.calls.some((call) => call.stage === "upload")).toBe(false);
    }

    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    expect(screen.getByLabelText("Attachment").matches(":disabled")).toBe(true);
    await app.release("zeta");
  });
}

test("native no-grant Task draft stays editable and a denied primary POST unlocks a fresh exact retry", async () => {
  const app = mountTaskSave(undefined, { noGrant: true, fail: ["primary"] });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.matches(":disabled")).toBe(false);
  await userEvent.type(name, "Permission draft");
  await userEvent.type(screen.getByLabelText("First note"), "Kept note");
  await userEvent.click(screen.getByRole("button", { name: "Save & close" }));
  expect(
    await screen.findByText("Error while saving, probably this item already exists"),
  ).toBeTruthy();
  expect(name.value).toBe("Permission draft");
  expect(name.matches(":disabled")).toBe(false);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(app.calls).toHaveLength(1);
  app.allow("primary");
  await userEvent.click(screen.getByRole("button", { name: "Save & close" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(
    app.calls
      .filter((call) => call.stage === "primary")
      .map((call) => ({ path: call.path, body: call.body })),
  ).toEqual([
    {
      path: "/api/objects/tasks",
      body: {
        name: "Permission draft",
        description: "",
        due_date: "",
        category_id: "",
        assigned_to_user_id: "7",
      },
    },
    {
      path: "/api/objects/tasks",
      body: {
        name: "Permission draft",
        description: "",
        due_date: "",
        category_id: "",
        assigned_to_user_id: "7",
      },
    },
  ]);
  expect(app.calls.find((call) => call.stage === "zeta")).toMatchObject({
    path: "/api/userfields/tasks/42",
    body: { zeta: "Kept note" },
  });
});

for (const stage of ["primary", "alpha", "upload"] as const) {
  test(`native Task departure retires held ${stage} stage while dispatched writes mark caches stale`, async () => {
    const app = mountTaskSave("/task/9?embedded", { hold: [stage] });
    await screen.findByLabelText("Name");

    if (stage === "upload")
      await userEvent.upload(
        screen.getByLabelText("Attachment"),
        new File(["Departure bytes"], "departure.pdf", { type: "application/pdf" }),
      );
    else await userEvent.type(screen.getByLabelText("Final note"), "Departure draft");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.calls.some((call) => call.stage === stage)).toBe(true));
    const pending = app.calls.find((call) => call.stage === stage)!;
    await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
    const keys = [["tasks"], ["objects", "tasks"]];

    for (const key of keys) app.client.setQueryData(key, []);
    const count = app.calls.length;
    await app.release(stage);
    await waitFor(() => {
      for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
    });
    expect(app.calls).toHaveLength(count);
    expect(app.reloads()).toEqual([]);
    expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
    expect(pending.signal?.aborted).toBe(true);
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
  });
}

test("native task-category metadata failure keeps its committed primary silently busy without Retry", async () => {
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const writes: { path: string; body: object }[] = [];
  mountNativeEditor("/taskcategory/new?embedded", (url, init) => {
    if (
      url === "/api/v2/custom-data/fields" ||
      url === "/api/objects/userfields" ||
      url === "/api/objects/userfields?query[]=entity=tasks" ||
      url === "/api/objects/userfields?query[]=entity=task_categories"
    )
      return Response.json([notesField("task_categories")]);

    if (url === "/api/objects/task_categories" && init?.method === "POST") {
      writes.push({ path: url, body: JSON.parse(String(init.body)) });

      return Response.json({ created_object_id: "4" });
    }

    if (url === "/api/userfields/task_categories/4" && init?.method === "PUT") {
      writes.push({ path: url, body: JSON.parse(String(init.body)) });

      return Response.json({ error_message: "Category field failed" }, { status: 503 });
    }

    return undefined;
  });
  await userEvent.type(await screen.findByLabelText("Name"), "Committed category");
  await userEvent.type(screen.getByLabelText("Owner note"), "Original note");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  await act(async () => {});
  expect(screen.queryByText(/Category field failed|The record is saved/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(writes).toEqual([
    {
      path: "/api/objects/task_categories",
      body: { name: "Committed category", active: "1", description: "" },
    },
    { path: "/api/userfields/task_categories/4", body: { note: "Original note" } },
  ]);
});

test.each(["new", "9"])(
  "native Task %s optional Due blur saves the restored date instead of invalid raw text",
  async (taskId) => {
    const app = mountTaskSave(`/task/${taskId}?embedded`, {
      due: "2027-01-04 18:30:00",
      hold: ["primary"],
    });

    const name = await screen.findByLabelText("Name");

    if (taskId === "new") await userEvent.type(name, "Optional date task");
    const due = screen.getByLabelText<HTMLInputElement>("Due");
    expect(due.value).toBe(taskId === "new" ? "" : "2027-01-04");
    const user = userEvent.setup();
    await user.clear(due);
    await user.paste("wrong-date");
    await user.keyboard("{Shift}");
    expect(due.value).toBe("wrong-date");
    expect(due.validity.customError).toBe(false);
    await userEvent.click(screen.getByLabelText("Description"));
    await userEvent.click(
      screen.getByRole("button", { name: taskId === "new" ? "Save & close" : "Save" }),
    );
    await waitFor(() => expect(app.calls.some((call) => call.stage === "primary")).toBe(true));
    expect(app.calls[0]!.body!.due_date).toBe(taskId === "new" ? "" : "2027-01-04");
    expect(due.value).toBe(taskId === "new" ? "" : "2027-01-04");
    expect(due.validity.customError).toBe(false);
    await app.release("primary");
  },
);

test("native Task Enter keydown can submit optional raw Due before any change/blur restoration", async () => {
  const app = mountTaskSave(undefined, { hold: ["primary"] });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Raw Enter task");
  const due = screen.getByLabelText<HTMLInputElement>("Due");
  await user.click(due);
  await user.paste("wrong-date");
  await user.keyboard("{Shift}");
  expect(due.validity.customError).toBe(false);
  expect(document.activeElement).toBe(due);
  await user.keyboard("{Enter>}");
  await waitFor(() => expect(app.calls.some((call) => call.stage === "primary")).toBe(true));
  expect(app.calls[0]!.body!.due_date).toBe("wrong-date");
  await user.keyboard("{/Enter}");
  expect(app.calls.filter((call) => call.stage === "primary")).toHaveLength(1);
  await app.release("primary");
});

test("native Task preset clicks and link keyup alone determine the custom fields actually saved", async () => {
  const app = mountTaskSave(undefined, {
    fields: [
      {
        ...notesField("tasks"),
        id: 1,
        name: "priority",
        caption: "Priority",
        type: "preset-list",
        config: "Routine\nUrgent",
      },
      {
        ...notesField("tasks"),
        id: 2,
        name: "resource",
        caption: "Resource",
        type: "link-with-title",
      },
      { ...notesField("tasks"), id: 3, name: "clean", caption: "Clean note" },
    ],
  });

  const name = await screen.findByLabelText("Name");
  await userEvent.type(name, "Clean display changes");
  fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "Urgent" } });
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pasted display title" } });
  fireEvent.change(screen.getByLabelText("Link"), {
    target: { value: "https://example.test/display" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Save & add another task" }));
  await waitFor(() => expect(name.isConnected).toBe(false));
  const fresh = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(fresh.value).toBe("");
  expect(app.calls.map((call) => call.stage)).toEqual(["primary"]);
  expect(app.reloads()).toEqual([]);

  await userEvent.type(fresh, "Native event draft");
  const preset = screen.getByLabelText<HTMLSelectElement>("Priority");
  fireEvent.change(preset, { target: { value: "Urgent" } });
  await userEvent.click(preset);
  const title = screen.getByLabelText<HTMLInputElement>("Title");
  fireEvent.change(title, { target: { value: "Packed title" } });
  fireEvent.change(screen.getByLabelText("Link"), {
    target: { value: "https://example.test/packed" },
  });
  fireEvent.keyUp(title, { key: "ArrowLeft", code: "ArrowLeft" });
  fireEvent.change(title, { target: { value: "Later display only" } });
  expect(title.value).toBe("Later display only");
  await userEvent.click(screen.getByRole("button", { name: "Save & close" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(
    app.calls
      .filter((call) => call.stage !== "primary")
      .map((call) => ({ path: call.path, body: call.body })),
  ).toEqual([
    { path: "/api/userfields/tasks/42", body: { priority: "Urgent" } },
    {
      path: "/api/userfields/tasks/42",
      body: { resource: '{"title":"Packed title","link":"https://example.test/packed"}' },
    },
  ]);
});

test("native selected task-category is editable without grants and retries its unchecked imported flag with a fresh primary", async () => {
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const bodies: Record<string, string>[] = [];
  mountNativeEditor("/taskcategory/4?embedded", (url, init) => {
    if (url === "/api/v2/user/permissions") return Response.json({});

    if (url === "/api/objects/task_categories/4" && init?.method !== "PUT")
      return Response.json({
        id: 4,
        name: "Imported category",
        active: 2,
        description: "Kept description",
      });

    if (url === "/api/objects/task_categories/4" && init?.method === "PUT") {
      bodies.push(JSON.parse(String(init.body)));

      return bodies.length === 1
        ? Response.json({ error_message: "Category write denied" }, { status: 403 })
        : new Response(null, { status: 204 });
    }

    return undefined;
  });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.matches(":disabled")).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(false);
  await userEvent.clear(name);
  await userEvent.type(name, "Retained category draft");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await userEvent.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  expect(
    within(await screen.findByRole("dialog", { name: "Error details" })).getByText(
      /Category write denied/,
    ),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(name.matches(":disabled")).toBe(false);
  expect(name.value).toBe("Retained category draft");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(bodies).toEqual([
    { name: "Retained category draft", active: "0", description: "Kept description" },
    { name: "Retained category draft", active: "0", description: "Kept description" },
  ]);
});

test("native Task primary reads sanitized single-line and CRLF main textarea without normalizing multiline metadata", async () => {
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const bodies: { path: string; body: Record<string, string> }[] = [];
  mountNativeEditor("/task/9?embedded", (url, init) => {
    if (
      url === "/api/v2/custom-data/fields" ||
      url === "/api/objects/userfields" ||
      url === "/api/objects/userfields?query[]=entity=tasks" ||
      url === "/api/objects/userfields?query[]=entity=task_categories"
    )
      return Response.json([{ ...notesField("tasks"), type: "text-multi-line" }]);

    if (url === "/api/objects/tasks/9" && init?.method !== "PUT")
      return Response.json({
        id: 9,
        name: "Imported\rTask\nName",
        description: "Original\nTask description",
        due_date: "2027-01-04 18:30:00",
        category_id: 3,
        assigned_to_user_id: 2,
      });

    if (url === "/api/userfields/tasks/9" && init?.method !== "PUT")
      return Response.json({ note: "Existing metadata" });

    if (
      ["/api/objects/tasks/9", "/api/userfields/tasks/9"].includes(url) &&
      init?.method === "PUT"
    ) {
      bodies.push({ path: url, body: JSON.parse(String(init.body)) });

      return new Response(null, { status: 204 });
    }

    return undefined;
  });
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("ImportedTaskName");
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLTextAreaElement>("Owner note").value).toBe(
      "Existing metadata",
    ),
  );
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Main line1\nMain line2" },
  });
  fireEvent.change(screen.getByLabelText("Owner note"), {
    target: { value: "Custom line1\nCustom line2" },
  });
  fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2028-03-12" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(bodies).toEqual([
    {
      path: "/api/objects/tasks/9",
      body: {
        name: "ImportedTaskName",
        description: "Main line1\r\nMain line2",
        due_date: "2028-03-12",
        category_id: "3",
        assigned_to_user_id: "2",
      },
    },
    { path: "/api/userfields/tasks/9", body: { note: "Custom line1\nCustom line2" } },
  ]);
});
