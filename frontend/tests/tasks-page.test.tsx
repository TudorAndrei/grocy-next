import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type {} from "vitest/jsdom";
import type { SystemInfo } from "@/lib/types";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";

function mountTasks(
  path = "/tasks",
  {
    nextDays = 5,
    denied = false,
    writeFailure = "",
    holdComplete = false,
    holdStatistics = false,
    savedSettings = {},
    nonJsonSuccess = false,
    heldDeletes = false,
    malformedDeleteSuccess = false,
  } = {},
) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00"));
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const rows = [
    {
      id: 1,
      name: "Overdue task",
      due_date: "2026-11-05",
      due_type: "overdue",
      done: 0,
      category_id: 1,
      has_category: true,
      category_name: "Home",
      assigned_to_user_id: 7,
      assigned_name: "Owner",
      custom_values: { note: "Alpha note" },
    },
    {
      id: 2,
      name: "Today task",
      due_date: "2026-11-06",
      due_type: "duetoday",
      done: 0,
      category_id: 2,
      has_category: true,
      category_name: "Home Office",
      assigned_to_user_id: 2,
      assigned_name: "Helper",
      custom_values: { note: "Beta note" },
    },
    {
      id: 3,
      name: "Soon task",
      due_date: "2026-11-08",
      due_type: "duesoon",
      done: 0,
      category_id: null,
      has_category: false,
      category_name: null,
      assigned_to_user_id: null,
      assigned_name: null,
      custom_values: {},
    },
    {
      id: 4,
      name: "Undated task",
      due_date: null,
      due_type: "",
      done: 0,
      category_id: 99,
      has_category: true,
      category_name: null,
      assigned_to_user_id: 99,
      assigned_name: null,
      custom_values: {},
    },
    {
      id: 5,
      name: "Done task",
      due_date: "2026-11-04",
      due_type: "overdue",
      done: 1,
      category_id: 1,
      has_category: true,
      category_name: "Home",
      assigned_to_user_id: 7,
      assigned_name: "Owner",
      custom_values: {},
    },
    {
      id: 6,
      name: "No category",
      due_date: "2026-12-01",
      due_type: "",
      done: 0,
      category_id: null,
      has_category: false,
      category_name: null,
      assigned_to_user_id: null,
      assigned_name: null,
      custom_values: {},
    },
  ];

  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  let statisticsReads = 0;
  let actionFailuresRemaining = writeFailure && writeFailure !== "delete" ? 1 : 0;
  let nonJsonRepliesRemaining = nonJsonSuccess ? 1 : 0;
  const statisticsReplies: Array<() => void> = [];
  const deleteRequests: Array<{ id: number; body: unknown }> = [];
  const deleteReplies: Array<() => void> = [];
  const deleted: number[] = [];
  let malformedDeletesRemaining = malformedDeleteSuccess ? 1 : 0;

  const app = mountNativeEditor(path, (url, options) => {
    const parsed = new URL(url, "http://localhost:3000");

    if (parsed.pathname === "/api/v2/tasks/overview") {
      const all = parsed.searchParams.has("include_done");

      return Response.json({
        rows: rows.flatMap((row) =>
          all || row.done === 0
            ? [
                {
                  ...row,
                  due_type: nextDays === 0 && row.due_type === "duesoon" ? "" : row.due_type,
                },
              ]
            : [],
        ),
        categories: [
          { id: 1, name: "Home" },
          { id: 2, name: "Home Office" },
        ],
        next_days: nextDays,
        include_done: all,
      });
    }

    if (url === "/api/tasks") {
      const response = Response.json(rows.filter((row) => row.done === 0));

      if (holdStatistics && statisticsReads++ > 0)
        return new Promise<Response>((resolve) => {
          statisticsReplies.push(() => resolve(response));
        });

      return response;
    }

    if (url === "/api/user/settings") return Response.json(savedSettings);

    if (url === "/api/system/info")
      return Response.json({
        grocy_version: { Version: "test", ReleaseDate: "2026-01-01" },
        php_version: "test",
        python_version: "test",
        sqlite_version: "test",
        db_version: 1,
        os: "test",
        client: "fixture",
      } satisfies SystemInfo);

    if (url === "/api/objects/userfields" || url === "/api/v2/custom-data/fields")
      return Response.json([{ ...notesField("tasks"), show_as_column_in_tables: 1 }]);

    if (url === "/api/v2/user/permissions")
      return Response.json({
        MASTER_DATA_EDIT: !denied,
        TASKS_MARK_COMPLETED: !denied,
        TASKS_UNDO_EXECUTION: !denied,
      });

    if (options?.method === "POST" && /\/api\/tasks\/\d+\/(complete|undo)$/.test(url)) {
      const id = Number(url.split("/")[3]);
      const row = rows.find((row) => row.id === id);

      if (!row) return Response.json({ error_message: "Task does not exist" }, { status: 400 });

      if (writeFailure && url.endsWith(writeFailure) && actionFailuresRemaining) {
        actionFailuresRemaining--;
        const fail = () => Response.json({ error_message: "Action failed" }, { status: 400 });

        return holdComplete && url.endsWith("/complete") ? held.then(fail) : fail();
      }

      if (nonJsonRepliesRemaining && url.endsWith("/complete")) {
        nonJsonRepliesRemaining--;

        return new Response("not JSON", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const complete = () => {
        row.done = url.endsWith("/undo") ? 0 : 1;

        return new Response(null, { status: 204 });
      };

      return holdComplete && url.endsWith("/complete") ? held.then(complete) : complete();
    }

    if (options?.method === "DELETE" && url.startsWith("/api/objects/tasks/")) {
      const id = Number(url.split("/").at(-1));
      deleteRequests.push({
        id,
        body: options.body === undefined ? undefined : JSON.parse(String(options.body)),
      });

      const reply = () => {
        if (denied) return Response.json({ error_message: "Permission denied" }, { status: 403 });
        const index = rows.findIndex((row) => row.id === id);

        if (index === -1)
          return Response.json({ error_message: "Object not found" }, { status: 400 });

        if (writeFailure === "delete")
          return Response.json({ error_message: "Delete failed" }, { status: 400 });
        rows.splice(index, 1);
        deleted.push(id);

        if (malformedDeletesRemaining) {
          malformedDeletesRemaining--;

          return new Response("not JSON", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(null, { status: 204 });
      };

      if (heldDeletes)
        return new Promise<Response>((resolve) => deleteReplies.push(() => resolve(reply())));

      return reply();
    }

    return undefined;
  });

  return {
    ...app,
    rows,
    release,
    held,
    statisticsReplies,
    deleteRequests,
    deleted,
    releaseDelete: (index = 0) => deleteReplies[index]!(),
  };
}

test("native tasks exposes due statistics and client-only status/category/search table filters", async () => {
  const { router } = mountTasks("/tasks?status=overdue&category=Home&user=7&embedded=");
  await screen.findByRole("heading", { name: "Tasks" });
  const status = await screen.findByRole("combobox", { name: "Status" });
  const user = userEvent.setup();
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual([
    "Undated task",
    "Overdue task",
    "Today task",
    "Soon task",
    "No category",
  ]);
  await screen.findByRole("button", { name: "1 task is overdue to be done" });
  await screen.findByRole("button", { name: "2 tasks are due to be done within the next 5 days" });
  await user.selectOptions(status, "duesoon");
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual([
    "Today task",
    "Soon task",
  ]);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Home");
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual([
    "Overdue task",
    "Today task",
  ]);
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Alpha");
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["Overdue task"]);
  expect(within(screen.getByRole("table")).getByText("Alpha note")).toBeTruthy();
  expect(router.state.location.search).toEqual({
    status: "overdue",
    category: "Home",
    user: "7",
    embedded: "",
  });
});

test("completing an open task posts the native click time, refreshes statistics and preserves DataTables redraw behavior", async () => {
  const { router, fetchMock, rows } = mountTasks();
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Overdue task" });
  await user.click(screen.getByRole("button", { name: "Mark task as completed: Overdue task" }));
  await screen.findByText("Marked task Overdue task as completed on 2026-11-06 12:00:00");
  expect(screen.queryByRole("rowheader", { name: "Overdue task" })).toBeNull();
  await screen.findByRole("button", { name: "0 tasks are overdue to be done" });

  const write = fetchMock.mock.calls.find(
    ([url, options]) => String(url) === "/api/tasks/1/complete" && options?.method === "POST",
  );

  expect(JSON.parse(String(write?.[1]?.body))).toEqual({ done_time: "2026-11-06 12:00:00" });
  expect(rows.find((row) => row.id === 1)?.done).toBe(1);
  // Native TR.remove() leaves the cached DataTables row available to the next draw.
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(screen.getByRole("rowheader", { name: "Overdue task" })).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Mark task as completed: Overdue task" })
      .disabled,
  ).toBe(false);
  expect(router.state.location.search).toEqual({});
});

test("include-done completion strikes the selected row without replacing its Complete action or refreshing cached search cells", async () => {
  mountTasks("/tasks?include_done");
  const user = userEvent.setup();
  const name = await screen.findByRole("rowheader", { name: "Overdue task" });
  await user.click(screen.getByRole("button", { name: "Mark task as completed: Overdue task" }));
  await screen.findByText("Marked task Overdue task as completed on 2026-11-06 12:00:00");
  expect(name.querySelector("s")?.textContent).toBe("Overdue task");
  expect(name.closest("tr")?.getAttribute("data-local-complete")).toBe("true");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Mark task as completed: Overdue task" })
      .disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Undo task: Overdue task" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show done tasks" }).checked).toBe(
    true,
  );
  expect(screen.getByRole("rowheader", { name: "Overdue task" }).querySelector("s")).toBeTruthy();
});

test.each([
  ["?include_done", true],
  ["?include_done=", false],
  ["?include_done=0", true],
])(
  "include-done page selection and checkbox prefill retain the native distinction (%s)",
  async (query, checked) => {
    const { router } = mountTasks(`/tasks${query}`);
    await screen.findByRole("rowheader", { name: "Done task" });
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Show done tasks" }).checked,
    ).toBe(checked);
    expect(router.history.location.search).toBe(query);
  },
);

test("show-done navigation uses the native bare flag and drops unrelated query filters", async () => {
  const { router } = mountTasks("/tasks?embedded=&status=overdue&user=7");
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Overdue task" });
  await user.click(screen.getByRole("checkbox", { name: "Show done tasks" }));
  await screen.findByRole("rowheader", { name: "Done task" });
  expect(router.history.location.search).toBe("?include_done");
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show done tasks" }).checked).toBe(
    true,
  );
  await user.click(screen.getByRole("checkbox", { name: "Show done tasks" }));
  await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Done task" })).toBeNull());
  expect(router.history.location.search).toBe("");
});

test("Undo reloads the native page state while retaining its query and saved layout", async () => {
  const { router, fetchMock } = mountTasks("/tasks?include_done");
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Done task" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "overdue");
  await user.click(screen.getByRole("button", { name: "Undo task: Done task" }));
  await screen.findByRole("button", { name: "Mark task as completed: Done task" });
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Status" }).value).toBe("");
  expect(screen.getByRole("rowheader", { name: "Done task" }).querySelector("s")).toBeNull();
  expect(router.history.location.search).toBe("?include_done");
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v2/tasks/overview?include_done"),
  ).toHaveLength(2);
  const undo = fetchMock.mock.calls.find(([url]) => String(url) === "/api/tasks/5/undo");
  expect(JSON.parse(String(undo?.[1]?.body))).toEqual({});
  expect(screen.queryByText(/Marked task Done task as completed/)).toBeNull();
});

test("delete confirmation removes only the selected row, leaves native statistics unchanged and permits redraw resurrection", async () => {
  const { rows, fetchMock, deleteRequests, releaseDelete } = mountTasks("/tasks", {
    heldDeletes: true,
    savedSettings: {
      "datatables_rowGroup_tasks-table": JSON.stringify({ enable: true, dataSrc: "6" }),
    },
  });

  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Overdue task" });
  const group = await screen.findByRole("button", { name: "Home" });
  const groupHeader = group.closest("tr")!;
  await user.click(screen.getByRole("button", { name: "Delete this item: Overdue task" }));
  let dialog = await screen.findByRole("dialog", { name: "Delete this item" });
  expect(
    within(dialog).getByText('Are you sure you want to delete task "Overdue task"?'),
  ).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "No" }));
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Delete this item: Overdue task" }));
  dialog = await screen.findByRole("dialog", { name: "Delete this item" });
  const row = screen.getByRole("rowheader", { name: "Overdue task" }).closest("tr")!;
  await user.click(within(dialog).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(deleteRequests).toEqual([{ id: 1, body: {} }]));
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  expect(screen.getByRole("rowheader", { name: "Overdue task" }).closest("tr")).toBe(row);
  await act(async () => {
    releaseDelete();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(rows.some((entry) => entry.id === 1)).toBe(false);
  expect(screen.getByRole("rowheader", { name: "Overdue task" }).closest("tr")).toBe(row);
  fireEvent.animationEnd(row);
  await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Overdue task" })).toBeNull());
  expect(rows.some((row) => row.id === 1)).toBe(false);
  expect(screen.getByRole("button", { name: "Home" })).toBe(group);
  expect(group.closest("tr")).toBe(groupHeader);
  expect(groupHeader.isConnected).toBe(true);
  expect(screen.getByRole("rowheader", { name: "Today task" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "1 task is overdue to be done" })).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(screen.getByRole("rowheader", { name: "Overdue task" })).toBeTruthy();
});

test("a held Task Delete cannot dismiss or accept a later independent confirmation", async () => {
  const app = mountTasks("/tasks", { heldDeletes: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Delete this item: Overdue task" }));
  const first = screen.getByRole("dialog", { name: "Delete this item" });
  await user.click(within(first).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(app.deleteRequests.map((request) => request.id)).toEqual([1]));
  // The primary owner protects immediate dismissal. Old clients also permit No while held,
  // so close that confirmation naturally to reach the independent callback ownership guard.
  const stillOpen = screen.queryByRole("dialog", { name: "Delete this item" });

  if (stillOpen) await user.click(within(stillOpen).getByRole("button", { name: "No" }));
  await user.click(screen.getByRole("button", { name: "Delete this item: Today task" }));
  const second = screen.getByRole("dialog", { name: "Delete this item" });
  expect(
    within(second).getByText('Are you sure you want to delete task "Today task"?'),
  ).toBeTruthy();
  const firstRow = screen.getByRole("rowheader", { name: "Overdue task" }).closest("tr")!;
  await act(async () => {
    app.releaseDelete(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.animationEnd(firstRow);
  await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Overdue task" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Delete this item" })).toBe(second);
  expect(app.deleteRequests).toHaveLength(1);
  expect(within(second).getByRole<HTMLButtonElement>("button", { name: "Yes" }).disabled).toBe(
    false,
  );
  const secondRow = screen.getByRole("rowheader", { name: "Today task" }).closest("tr")!;
  await user.click(within(second).getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(app.deleteRequests).toEqual([
      { id: 1, body: {} },
      { id: 2, body: {} },
    ]),
  );
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  await act(async () => {
    app.releaseDelete(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByRole("rowheader", { name: "Today task" }).closest("tr")).toBe(secondRow);
  fireEvent.animationEnd(secondRow);
  await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Today task" })).toBeNull());
  expect(app.deleted).toEqual([1, 2]);
  expect(screen.getByRole("rowheader", { name: "Soon task" })).toBeTruthy();
  expect(app.fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks")).toHaveLength(1);
});

test("Task Delete uses the live row selector both at reply and after a detached animation ends", async () => {
  const app = mountTasks("/tasks", { heldDeletes: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Delete this item: Overdue task" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(app.deleteRequests).toHaveLength(1));
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  const search = screen.getByRole("searchbox", { name: "Search" });
  await user.type(search, "Beta note");
  expect(screen.queryByRole("rowheader", { name: "Overdue task" })).toBeNull();
  await act(async () => {
    app.releaseDelete(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(app.deleted).toEqual([1]);
  await user.clear(search);
  const first = (await screen.findByRole("rowheader", { name: "Overdue task" })).closest("tr")!;
  fireEvent.animationEnd(first);
  expect(screen.getByRole("rowheader", { name: "Overdue task" }).closest("tr")).toBe(first);
  await user.click(screen.getByRole("button", { name: "Delete this item: Today task" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(app.deleteRequests).toHaveLength(2));
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  const animating = screen.getByRole("rowheader", { name: "Today task" }).closest("tr")!;
  await act(async () => {
    app.releaseDelete(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(app.deleted).toEqual([1, 2]);
  expect(screen.getByRole("rowheader", { name: "Today task" }).closest("tr")).toBe(animating);
  await user.type(search, "Alpha note");
  expect(screen.queryByRole("rowheader", { name: "Today task" })).toBeNull();
  expect(animating.isConnected).toBe(false);
  fireEvent.animationEnd(animating);
  await user.clear(search);
  const restored = (await screen.findByRole("rowheader", { name: "Today task" })).closest("tr")!;
  fireEvent.animationEnd(restored);
  expect(screen.getByRole("rowheader", { name: "Today task" }).closest("tr")).toBe(restored);
  expect(app.deleteRequests).toEqual([
    { id: 1, body: {} },
    { id: 2, body: {} },
  ]);
  expect(app.fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks")).toHaveLength(1);
});

test("a genuine failed Task Delete stays quiet without releasing another Complete's busy cursor, then allows recovery", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mountTasks("/tasks", { holdComplete: true });
  const user = userEvent.setup();
  const row = (await screen.findByRole("rowheader", { name: "Overdue task" })).closest("tr")!;
  const before = row.outerHTML;
  await screen.findByRole("button", { name: "1 task is overdue to be done" });
  await user.click(screen.getByRole("button", { name: "Mark task as completed: Today task" }));
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  // Another client has deleted this task after the native table snapshot was read.
  app.rows.splice(
    app.rows.findIndex((entry) => entry.id === 1),
    1,
  );
  await user.click(screen.getByRole("button", { name: "Delete this item: Overdue task" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ status: 400, message: "Object not found" }),
  );
  expect(app.deleteRequests).toEqual([{ id: 1, body: {} }]);
  expect(row.outerHTML).toBe(before);
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  expect(screen.queryByText(/Marked task/)).toBeNull();
  expect(screen.getByRole("button", { name: "1 task is overdue to be done" })).toBeTruthy();
  expect(app.fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks")).toHaveLength(1);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  await act(async () => {
    app.release();
    await app.held;
  });
  await screen.findByText("Marked task Today task as completed on 2026-11-06 12:00:00");
  expect(document.body.classList.contains("cursor-busy")).toBe(false);

  const statistics = app.fetchMock.mock.calls.filter(
    ([url]) => String(url) === "/api/tasks",
  ).length;

  const recoveryRow = screen.getByRole("rowheader", { name: "Soon task" }).closest("tr")!;
  await user.click(screen.getByRole("button", { name: "Delete this item: Soon task" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(app.deleted).toEqual([3]));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.animationEnd(recoveryRow);
  await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Soon task" })).toBeNull());
  expect(app.fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks")).toHaveLength(
    statistics,
  );
  expect(app.deleteRequests).toEqual([
    { id: 1, body: {} },
    { id: 3, body: {} },
  ]);
  expect(error).toHaveBeenCalledTimes(1);
});

test("malformed successful Task Delete JSON raises a browser error before row removal", async () => {
  vi.stubGlobal("window", jsdom.window);
  const callbackErrors: ErrorEvent[] = [];
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  const capture = (event: ErrorEvent) => {
    callbackErrors.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", capture);
  onTestFinished(() => window.removeEventListener("error", capture));
  const app = mountTasks("/tasks", { malformedDeleteSuccess: true });
  const user = userEvent.setup();
  const row = (await screen.findByRole("rowheader", { name: "Overdue task" })).closest("tr")!;
  const before = row.outerHTML;
  await user.click(screen.getByRole("button", { name: "Delete this item: Overdue task" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(callbackErrors).toHaveLength(1));
  expect(app.deleted).toEqual([1]);
  expect(app.rows.some((entry) => entry.id === 1)).toBe(false);
  expect(row.outerHTML).toBe(before);
  fireEvent.animationEnd(row);
  expect(screen.getByRole("rowheader", { name: "Overdue task" }).closest("tr")).toBe(row);
  expect(error).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  expect(app.fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks")).toHaveLength(1);
});

test.each([false, true])(
  "retired sent Task Delete suppresses callbacks and stales uncertain caches (failure=%s)",
  async (failed) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mountTasks("/tasks", { heldDeletes: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete this item: Overdue task" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
        name: "Yes",
      }),
    );
    await waitFor(() => expect(app.deleteRequests).toHaveLength(1));
    await act(async () => {
      await app.router.navigate({ to: "/settings", search: { tab: "connection" } });
    });
    await screen.findByRole("heading", { name: "Settings" });

    const reads = () =>
      app.fetchMock.mock.calls.filter(
        ([url]) => String(url) === "/api/tasks" || String(url).startsWith("/api/v2/tasks/overview"),
      ).length;

    const beforeReads = reads();

    if (failed)
      app.rows.splice(
        app.rows.findIndex((entry) => entry.id === 1),
        1,
      );
    await act(async () => {
      app.releaseDelete();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(app.client.getQueryState(["tasks-page", ""])?.isInvalidated).toBe(true),
    );
    expect(app.deleted).toEqual(failed ? [] : [1]);
    expect(reads()).toBe(beforeReads);
    expect(app.router.state.location.pathname).toBe("/settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
  },
);

test("zero due-soon preference and inactive category labels preserve the native empty distinctions", async () => {
  mountTasks("/tasks", { nextDays: 0 });
  const user = userEvent.setup();
  const missing = await screen.findByRole("rowheader", { name: "Undated task" });
  expect(
    within(screen.getByRole("combobox", { name: "Status" })).queryByRole("option", {
      name: "Due soon",
    }),
  ).toBeNull();
  expect(
    screen.getByRole("rowheader", { name: "Soon task" }).closest("tr")?.getAttribute("data-due"),
  ).toBeNull();
  expect(within(missing.closest("tr")!).queryByText("Uncategorized")).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Uncategorized");
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual([
    "Soon task",
    "No category",
  ]);
});

test("saved task sorting, column visibility and shadow-category grouping use the native table settings", async () => {
  const layout = {
    time: 1,
    order: [[1, "desc"]],
    search: { search: "No match", smart: true, regex: false, caseInsensitive: true },
    columns: Array.from({ length: 8 }, (_, index) => ({ visible: index !== 3 })),
    ColReorder: [0, 1, 2, 3, 4, 5, 6, 7],
  };

  const { fetchMock } = mountTasks("/tasks", {
    savedSettings: { "datatables_state_tasks-table": JSON.stringify(layout) },
  });

  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Undated task" });
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual([
    "Undated task",
    "Today task",
    "Soon task",
    "Overdue task",
    "No category",
  ]);
  expect(screen.queryByRole("columnheader", { name: "Category" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const dialog = await screen.findByRole("dialog", { name: "Table options" });
  await user.click(within(dialog).getByRole("checkbox", { name: "Category" }));
  await user.click(within(dialog).getByRole("radio", { name: "Category" }));
  await user.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(screen.getByRole("columnheader", { name: "Category" })).toBeTruthy();
  const group = await screen.findByRole("button", { name: "Home" });
  await user.click(group);
  expect(screen.queryByRole("rowheader", { name: "Overdue task" })).toBeNull();
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url) === "/api/user/settings/datatables_rowGroup_tasks-table" &&
          String(options?.body).includes("dataSrc"),
      ),
    ).toBe(true),
  );

  const groupSave = fetchMock.mock.calls.find(
    ([url]) => String(url) === "/api/user/settings/datatables_rowGroup_tasks-table",
  );

  expect(JSON.parse(JSON.parse(String(groupSave?.[1]?.body)).value)).toEqual({
    enable: true,
    dataSrc: "6",
  });
});

test("denied permissions preserve native Delete visibility while the backend rejects its write", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  const { fetchMock, deleteRequests, deleted, rows } = mountTasks("/tasks?include_done", {
    denied: true,
  });

  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Overdue task" });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Mark task as completed: Overdue task" })
      .disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo task: Done task" }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Delete this item: Overdue task" })
      .disabled,
  ).toBe(false);
  expect(screen.queryByRole("link", { name: "Edit this item" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
  expect(
    fetchMock.mock.calls.some(([, options]) => ["POST", "DELETE"].includes(options?.method ?? "")),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Delete this item: Overdue task" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this item" });
  await user.click(within(dialog).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
  expect(deleteRequests).toEqual([{ id: 1, body: {} }]);
  expect(deleted).toEqual([]);
  expect(rows.some((row) => row.id === 1)).toBe(true);
  expect(screen.getByRole("rowheader", { name: "Overdue task" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test.each(["complete", "undo"] as const)(
  "failed %s logs once, retains its row/counts and permits a later manual success",
  async (kind) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = kind === "undo" ? "/tasks?include_done" : "/tasks";
    const { fetchMock, rows, router } = mountTasks(path, { writeFailure: kind });
    const user = userEvent.setup();
    const name = kind === "undo" ? "Done task" : "Overdue task";
    const id = kind === "undo" ? 5 : 1;
    const label = `${kind === "undo" ? "Undo task" : "Mark task as completed"}: ${name}`;
    const row = (await screen.findByRole("rowheader", { name })).closest("tr")!;
    await screen.findByRole("button", { name: "1 task is overdue to be done" });

    const statisticsReads = () =>
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks").length;

    const initialStatistics = statisticsReads();
    await user.click(within(row).getByRole("button", { name: label }));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 400, message: "Action failed" }),
    );
    expect(screen.getByRole("rowheader", { name }).closest("tr")).toBe(row);
    expect(screen.getByRole("rowheader", { name: "Overdue task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 task is overdue to be done" })).toBeTruthy();
    expect(!!within(row).getByRole("rowheader").querySelector("s")).toBe(kind === "undo");
    expect(screen.queryByText(/Marked task Overdue task as completed/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(rows.find((item) => item.id === id)?.done).toBe(kind === "undo" ? 1 : 0);
    expect(statisticsReads()).toBe(initialStatistics);

    const writes = () =>
      fetchMock.mock.calls.filter(
        ([url, options]) =>
          String(url) === `/api/tasks/${id}/${kind}` && options?.method === "POST",
      );

    expect(writes()).toHaveLength(1);
    expect(JSON.parse(String(writes()[0]?.[1]?.body))).toEqual(
      kind === "complete" ? { done_time: "2026-11-06 12:00:00" } : {},
    );

    vi.setSystemTime(new Date("2026-11-06T12:00:01"));
    await user.click(within(row).getByRole("button", { name: label }));

    if (kind === "complete") {
      await screen.findByText("Marked task Overdue task as completed on 2026-11-06 12:00:01");
      expect(screen.queryByRole("rowheader", { name })).toBeNull();
      expect(JSON.parse(String(writes()[1]?.[1]?.body))).toEqual({
        done_time: "2026-11-06 12:00:01",
      });
    } else {
      await screen.findByRole("button", { name: "Mark task as completed: Done task" });
      expect(screen.getByRole("rowheader", { name }).querySelector("s")).toBeNull();
      expect(router.history.location.search).toBe("?include_done");
      expect(
        fetchMock.mock.calls.filter(
          ([url]) => String(url) === "/api/v2/tasks/overview?include_done",
        ),
      ).toHaveLength(2);
      expect(JSON.parse(String(writes()[1]?.[1]?.body))).toEqual({});
      expect(screen.queryByText(/Marked task Done task as completed/)).toBeNull();
    }

    expect(writes()).toHaveLength(2);
    expect(rows.find((item) => item.id === id)?.done).toBe(kind === "undo" ? 0 : 1);
    await waitFor(() => expect(statisticsReads()).toBeGreaterThan(initialStatistics));
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  },
);

test.each([false, true])(
  "a request settling after departure suppresses obsolete UI/errors while accepted success still invalidates (HTTP failure=%s)",
  async (failed) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { router, client, release, held, fetchMock, rows } = mountTasks("/tasks", {
      holdComplete: true,
      writeFailure: failed ? "complete" : "",
    });

    const user = userEvent.setup();
    await screen.findByRole("rowheader", { name: "Overdue task" });
    await user.click(screen.getByRole("button", { name: "Mark task as completed: Overdue task" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks/1/complete"),
      ).toHaveLength(1),
    );
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    await act(async () => {
      await router.navigate({ to: "/settings", search: { tab: "connection" } });
    });
    await screen.findByRole("heading", { name: "Settings" });
    await act(async () => {
      release();
      await held;
    });

    if (!failed)
      await waitFor(() =>
        expect(client.getQueryState(["tasks-page", ""])?.isInvalidated).toBe(true),
      );

    expect(rows.find((row) => row.id === 1)?.done).toBe(failed ? 0 : 1);
    expect(screen.queryByText(/Marked task Overdue task as completed/)).toBeNull();
    expect(screen.queryByText("Action failed")).toBeNull();
    expect(router.state.location.pathname).toBe("/settings");
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(error).not.toHaveBeenCalled();
  },
);

test("a controlled non-JSON 200 completion follows the browser error channel until a later valid action", async () => {
  // Use JSDOM's browser exception reporter, not Vitest's Node-global window alias.
  vi.stubGlobal("window", jsdom.window);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const callbackErrors: ErrorEvent[] = [];

  const captureError = (event: ErrorEvent) => {
    callbackErrors.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", captureError);
  onTestFinished(() => window.removeEventListener("error", captureError));

  const { fetchMock } = mountTasks("/tasks", { nonJsonSuccess: true });
  const user = userEvent.setup();

  const action = await screen.findByRole("button", {
    name: "Mark task as completed: Overdue task",
  });

  await user.click(action);
  await waitFor(() => expect(callbackErrors).toHaveLength(1));
  expect(error).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  expect(screen.queryByText(/Marked task Overdue task as completed/)).toBeNull();
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  vi.setSystemTime(new Date("2026-11-06T12:00:01"));
  await user.click(action);
  await screen.findByText("Marked task Overdue task as completed on 2026-11-06 12:00:01");
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url) === "/api/tasks/1/complete"),
  ).toHaveLength(2);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(callbackErrors).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
});

test("table reset discards completion callbacks from the previous table", async () => {
  const { release, held, fetchMock, client } = mountTasks("/tasks", { holdComplete: true });
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Overdue task" });
  await user.click(screen.getByRole("button", { name: "Mark task as completed: Overdue task" }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Mark task as completed: Today task" })
      .disabled,
  ).toBe(false);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Delete this item: Today task" })
      .disabled,
  ).toBe(false);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const options = await screen.findByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("button", { name: "Reset" }));

  const confirmation = await screen.findByRole("dialog", {
    name: "Are you sure you want to reset the table options?",
  });

  await user.click(within(confirmation).getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v2/tasks/overview"),
    ).toHaveLength(2),
  );
  await screen.findByRole("rowheader", { name: "Overdue task" });
  await waitFor(() => expect(document.body.classList.contains("cursor-busy")).toBe(false));
  await act(async () => {
    release();
    await held;
  });
  await waitFor(() => expect(client.getQueryState(["tasks-page", ""])?.isInvalidated).toBe(true));
  expect(screen.getByRole("rowheader", { name: "Overdue task" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "1 task is overdue to be done" })).toBeTruthy();
  expect(screen.queryByText(/Marked task Overdue task as completed/)).toBeNull();
});

test("overlapping task statistics replies apply in native completion order", async () => {
  const { statisticsReplies } = mountTasks("/tasks", { holdStatistics: true });
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Overdue task" });
  await user.click(screen.getByRole("button", { name: "Mark task as completed: Overdue task" }));
  await waitFor(() => expect(statisticsReplies).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: "Mark task as completed: Today task" }));
  await waitFor(() => expect(statisticsReplies).toHaveLength(2));
  await act(async () => statisticsReplies[1]!());
  await screen.findByRole("button", { name: "1 task is due to be done within the next 5 days" });
  await act(async () => statisticsReplies[0]!());
  await screen.findByRole("button", { name: "2 tasks are due to be done within the next 5 days" });
});
