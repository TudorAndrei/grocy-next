import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { MealPlanSection } from "@/lib/mealplan-sections";
import type { UserSettings } from "@/lib/types";
import type { JsonObject } from "@/lib/json";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function mountSections(
  path = "/mealplansections",
  options: {
    holdSave?: boolean;
    holdDelete?: boolean;
    failSaveAfterCommitOnce?: boolean;
    importedSection?: Partial<MealPlanSection> & { id: number };
    failDelete?: boolean;
    failReadOnce?: boolean;
    denied?: boolean;
    recipes?: boolean;
    planner?: boolean;
    basepath?: string;
  } = {},
) {
  const rows: MealPlanSection[] = [
    { id: -1, name: "Reserved", sort_number: -1, time_info: null },
    { id: 0, name: "Default", sort_number: 0, time_info: null },
    { id: 1, name: "Breakfast", sort_number: 2, time_info: "07:30" },
    { id: 2, name: "Dinner", sort_number: 10, time_info: "18:00" },
    { id: 3, name: "Snack", sort_number: null, time_info: null },
  ];

  if (options.importedSection) {
    const selected = rows.find((row) => row.id === options.importedSection?.id);

    if (selected) Object.assign(selected, options.importedSection);
  }

  const settings: UserSettings = {};
  const writes: Array<{ path: string; method: string; body?: JsonObject }> = [];
  const settingWrites: Array<{ key: string; body: JsonObject }> = [];
  let reads = 0;
  const save = deferred();
  const deletion = deferred();
  let failSave = options.failSaveAfterCommitOnce;
  let failRead = options.failReadOnce;
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => {
    messages.mockRestore();
    logger.mockRestore();
  });

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/v2/user/permissions")
        return Response.json({
          MASTER_DATA_EDIT: !options.denied,
          RECIPES_MEALPLAN: !options.denied,
        });

      if (url === "/api/user/settings") return Response.json(settings);

      if (url.startsWith("/api/user/settings/")) {
        const key = decodeURIComponent(url.slice("/api/user/settings/".length));

        if (init?.method === "DELETE") {
          delete settings[key];

          return new Response(null, { status: 204 });
        }

        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          settings[key] = body.value;
          settingWrites.push({ key, body });

          return new Response(null, { status: 204 });
        }
      }

      if (url === "/api/v2/mealplan-sections") {
        reads += 1;

        if (failRead) {
          failRead = false;

          return Response.json({ error_message: "Section read failed" }, { status: 503 });
        }

        return Response.json({
          rows: rows
            .filter((row) => row.id > 0)
            .sort(
              (a, b) => Number(a.sort_number ?? -Infinity) - Number(b.sort_number ?? -Infinity),
            ),
        });
      }

      if (url.startsWith("/api/v2/mealplan-sections/editor")) {
        const query = new URL(url, "http://grocy.test").searchParams;
        const selected = query.get("section_id");
        const section = selected === null ? null : rows.find((row) => row.id === Number(selected));

        return section === undefined
          ? Response.json({ error_message: "Record not found" }, { status: 404 })
          : Response.json({ section });
      }

      if (
        url.startsWith("/api/objects/meal_plan_sections") &&
        ["POST", "PUT", "DELETE"].includes(init?.method ?? "")
      ) {
        const method = init?.method ?? "";
        const body: JsonObject = init?.body ? JSON.parse(String(init.body)) : {};
        writes.push({ path: url, method, body });

        if (method === "DELETE") {
          if (options.holdDelete) await deletion.promise;

          if (options.failDelete)
            return Response.json({ error_message: "Delete failed" }, { status: 503 });
          const index = rows.findIndex((row) => row.id === Number(url.split("/").at(-1)));

          if (index >= 0) rows.splice(index, 1);
        } else {
          if (options.holdSave) await save.promise;

          if (options.denied)
            return Response.json({ error_message: "Permission denied" }, { status: 403 });

          if (method === "POST")
            rows.push({
              id: 8,
              name: String(body.name),
              sort_number: String(body.sort_number),
              time_info: String(body.time_info),
            });
          else
            Object.assign(
              rows.find((row) => row.id === Number(url.split("/").at(-1)))!,
              body,
            );
        }

        if (method !== "DELETE" && failSave) {
          failSave = false;

          // Model a committed request whose response fails at the transport boundary.
          return Response.json({ error_message: "Save failed" }, { status: 503 });
        }

        return method === "POST"
          ? Response.json({ created_object_id: "8" })
          : new Response(null, { status: 204 });
      }

      if (url === "/api/v2/recipes/overview") return Response.json([]);

      return undefined;
    },
    {
      FEATURE_FLAG_RECIPES: options.recipes ?? true,
      FEATURE_FLAG_RECIPES_MEALPLAN: options.planner ?? true,
    },
    { basepath: options.basepath },
  );

  const reloads = () =>
    messages.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.Message === "Reload");

  return {
    ...app,
    rows,
    settings,
    writes,
    settingWrites,
    save,
    deletion,
    reloads,
    logger,
    reads: () => reads,
  };
}

async function table() {
  return screen.findByRole("table", { name: "Meal plan sections" });
}

async function form() {
  return screen.findByRole("form", { name: /meal plan section/ });
}

function namedRow(table: HTMLElement, name: string) {
  const row = within(table).getByRole("rowheader", { name }).closest("tr");

  if (!row) throw new Error("Missing section row");

  return within(row);
}

test("native meal plan section list is available at its deep link", async () => {
  const app = mountSections();
  expect(await screen.findByRole("heading", { name: "Meal plan sections" })).toBeTruthy();
  const list = await table();
  expect(
    within(list)
      .getAllByRole("rowheader")
      .map((row) => row.textContent),
  ).toEqual(["Snack", "Dinner", "Breakfast"]);
  expect(within(list).queryByRole("rowheader", { name: "Default" })).toBeNull();
  await waitFor(() => expect(app.settings["datatables_state_mealplansections-table"]).toBeTruthy());
  const state = JSON.parse(String(app.settings["datatables_state_mealplansections-table"]));
  expect(state.order).toEqual([[2, "asc"]]);
  expect(state.columns).toHaveLength(4);
});

test("list search includes sort and time, all clears filtering and Clear filter resets text", async () => {
  mountSections();
  const list = await table();
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", { name: "Search" });
  await user.type(search, "18:00");
  fireEvent.change(search, { target: { value: "07:30" } });
  await waitFor(() =>
    expect(
      within(list)
        .getAllByRole("rowheader")
        .map((row) => row.textContent),
    ).toEqual(["Breakfast"]),
  );
  await user.clear(search);
  await user.type(search, "18:00");
  await waitFor(() =>
    expect(
      within(list)
        .getAllByRole("rowheader")
        .map((row) => row.textContent),
    ).toEqual(["Dinner"]),
  );
  await user.clear(search);
  await user.type(search, "all");
  await waitFor(() => expect(within(list).getAllByRole("rowheader")).toHaveLength(3));
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("all");
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
});

test("Add and row Edit open the exact native iframe identities beneath a configured basepath", async () => {
  mountSections("/house/mealplansections", { basepath: "/house" });
  const list = await table();
  const edit = namedRow(list, "Dinner").getByRole("link", { name: "Edit this item" });
  expect(edit.getAttribute("href")).toBe("/house/mealplansection/2?embedded");
  await userEvent.click(edit);
  expect(new URL(screen.getByTitle<HTMLIFrameElement>("Meal plan section").src).pathname).toBe(
    "/house/mealplansection/2",
  );
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Meal plan section" })).getByRole("button", {
      name: "Close",
    }),
  );
  await userEvent.click(screen.getByRole("link", { name: "Add" }));
  expect(new URL(screen.getByTitle<HTMLIFrameElement>("Meal plan section").src).pathname).toBe(
    "/house/mealplansection/new",
  );
});

test("selected zero and reserved negative IDs edit actual records while PHP-empty zero sort renders blank", async () => {
  const app = mountSections("/mealplansection/0");
  await form();
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Default");
  expect(screen.getByLabelText<HTMLInputElement>("Sort number").value).toBe("");
  await userEvent.type(screen.getByLabelText("Time"), "08:15");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await table();
  expect(app.writes).toEqual([
    {
      path: "/api/objects/meal_plan_sections/0",
      method: "PUT",
      body: { name: "Default", sort_number: "", time_info: "08:15" },
    },
  ]);
  await act(async () =>
    app.router.navigate({ to: "/mealplansection/$sectionId", params: { sectionId: "-1" } }),
  );
  await form();
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Reserved");
});

test("new section validates Name and nonnegative integer sort, preserves ineffective Enter, and saves optional blanks", async () => {
  const app = mountSections("/mealplansection/new");
  await form();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  await userEvent.type(screen.getByLabelText("Name"), "Lunch{Enter}");
  expect(app.writes).toHaveLength(0);
  await userEvent.type(screen.getByLabelText("Sort number"), "-1");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  await userEvent.clear(screen.getByLabelText("Sort number"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await table();
  expect(app.writes).toEqual([
    {
      path: "/api/objects/meal_plan_sections",
      method: "POST",
      body: { name: "Lunch", sort_number: "", time_info: "" },
    },
  ]);
});

test("imported Name uses its sanitized single-line DOM value and invalid native Time saves empty", async () => {
  const app = mountSections("/mealplansection/1", {
    importedSection: { id: 1, name: "Imported\rSection\nName", time_info: "not-a-time" },
  });

  await form();
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("ImportedSectionName");
  expect(screen.getByLabelText<HTMLInputElement>("Time").value).toBe("");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await table();
  expect(app.writes).toEqual([
    {
      path: "/api/objects/meal_plan_sections/1",
      method: "PUT",
      body: { name: "ImportedSectionName", sort_number: "2", time_info: "" },
    },
  ]);
});

test("a live raw-query edit preserves the held section form and callback reads literal embedded at completion", async () => {
  const app = mountSections("/mealplansection/2?embedded&keep=before", { holdSave: true });
  await form();
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  await userEvent.type(name, " held draft");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => {
    app.router.history.replace("/mealplansection/2?%65mbedded=&keep=after#part");
  });
  await waitFor(() => {
    expect(screen.getByLabelText("Name")).toBe(name);
    expect(name.value).toBe("Dinner held draft");
    expect(name.matches(":disabled")).toBe(true);
  });
  await act(async () => app.save.release());
  await table();
  expect(app.reloads()).toHaveLength(0);
  expect(app.writes).toHaveLength(1);
  expect(app.router.state.location.pathname).toBe("/mealplansections");
});

test("embedded zero presence posts exact Reload and keeps the form busy", async () => {
  const app = mountSections("/mealplansection/1?embedded=0");
  await form();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.reloads()).toEqual([{ Message: "Reload", Payload: null }]));
  expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
});

test("an initially encoded embedded key follows native nonembedded return", async () => {
  const app = mountSections("/mealplansection/1?%65mbedded");
  await form();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await table();
  expect(app.reloads()).toHaveLength(0);
});

test("uncertain primary failure stales cached sections, unlocks the draft and retries the selected ID", async () => {
  const app = mountSections("/mealplansection/2", { failSaveAfterCommitOnce: true });
  await form();
  const cached = app.rows.filter((row) => row.id > 0).map((row) => ({ ...row }));
  app.client.setQueryData(["mealplan-sections"], cached);
  await userEvent.type(screen.getByLabelText("Name"), " updated");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Error while saving, probably this item already exists");
  await waitFor(() =>
    expect(app.client.getQueryState(["mealplan-sections"])?.isInvalidated).toBe(true),
  );
  expect(app.rows.find((row) => row.id === 2)?.name).toBe("Dinner updated");
  expect(cached.find((row) => row.id === 2)?.name).toBe("Dinner");
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Dinner updated");
  expect(screen.getByLabelText("Name").matches(":disabled")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await table();
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/objects/meal_plan_sections/2",
    "/api/objects/meal_plan_sections/2",
  ]);
});

test("native readers can attempt a write before the API permission boundary rejects it", async () => {
  const app = mountSections("/mealplansection/2", { denied: true });
  await form();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Error while saving, probably this item already exists");
  expect(app.writes).toHaveLength(1);
  expect(screen.getByLabelText("Name").matches(":disabled")).toBe(false);
});

test("delete confirmation closes immediately and success reloads fresh rows with all filters cleared", async () => {
  const app = mountSections(undefined, { holdDelete: true });
  let list = await table();
  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "Dinner");
  await waitFor(() => expect(within(list).getAllByRole("rowheader")).toHaveLength(1));
  await userEvent.click(namedRow(list, "Dinner").getByRole("button", { name: "Delete this item" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this item" });
  expect(
    within(dialog).getByText('Are you sure you want to delete meal plan section "Dinner"?'),
  ).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: "Yes" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.writes[0]?.path).toBe("/api/objects/meal_plan_sections/2");
  await act(async () => app.deletion.release());
  await waitFor(() => expect(app.reads()).toBeGreaterThan(1));
  list = await table();
  await waitFor(() =>
    expect(
      within(list)
        .getAllByRole("rowheader")
        .map((row) => row.textContent),
    ).toEqual(["Snack", "Breakfast"]),
  );
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
});

test("delete failure only logs and leaves the table available", async () => {
  const app = mountSections(undefined, { failDelete: true });
  const list = await table();
  await userEvent.click(
    namedRow(list, "Breakfast").getByRole("button", { name: "Delete this item" }),
  );
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(within(list).getByRole("rowheader", { name: "Breakfast" })).toBeTruthy();
  expect(screen.queryByText("Delete failed")).toBeNull();
});

test("table options preserve column indices and reset clears filters, closes iframe and disposes old delete callback", async () => {
  const app = mountSections(undefined, { holdDelete: true });
  const list = await table();
  const user = userEvent.setup();
  await user.click(namedRow(list, "Dinner").getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await user.click(screen.getByRole("link", { name: "Add" }));
  await user.click(within(list).getByRole("button", { name: "Table options" }));
  let options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("checkbox", { name: "Time" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(
      JSON.parse(String(app.settings["datatables_state_mealplansections-table"])).columns[3]
        .visible,
    ).toBe(false),
  );
  await user.click(within(list).getByRole("button", { name: "Table options" }));
  options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("button", { name: "Reset" }));
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(app.reads()).toBeGreaterThan(1));
  const reads = app.reads();
  expect(screen.queryByTitle("Meal plan section")).toBeNull();
  await act(async () => app.deletion.release());
  expect(app.reads()).toBe(reads);
  expect(within(await table()).getByRole("rowheader", { name: "Dinner" })).toBeTruthy();
});

test("departed committed failure stales the new document cache without old errors, reads or completion", async () => {
  const app = mountSections("/mealplansection/1?embedded", {
    holdSave: true,
    failSaveAfterCommitOnce: true,
  });

  await form();
  await userEvent.type(screen.getByLabelText("Name"), " committed after departure");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));

  const signal = app.fetchMock.mock.calls.find(
    ([url, options]) =>
      String(url) === "/api/objects/meal_plan_sections/1" && options?.method === "PUT",
  )?.[1]?.signal;

  await act(async () => app.router.navigate({ to: "/mealplansections" }));
  await table();
  expect(signal?.aborted).toBe(true);
  app.client.setQueryData(
    ["objects", "meal_plan_sections"],
    app.rows.map((row) => ({ ...row })),
  );
  const reads = app.reads();
  await act(async () => app.save.release());
  await waitFor(() =>
    expect(app.client.getQueryState(["objects", "meal_plan_sections"])?.isInvalidated).toBe(true),
  );
  expect(app.rows.find((row) => row.id === 1)?.name).toBe("Breakfast committed after departure");
  expect(app.reads()).toBe(reads);
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
  expect(app.reloads()).toHaveLength(0);
  expect(app.router.state.location.pathname).toBe("/mealplansections");
});

test("base, malformed and missing selected section routes never silently create", async () => {
  const app = mountSections("/mealplansection/");
  await screen.findByText("Object not found");
  await act(async () =>
    app.router.navigate({ to: "/mealplansection/$sectionId", params: { sectionId: "bad" } }),
  );
  await screen.findByText("Object not found");
  expect(screen.queryByLabelText("Name")).toBeNull();
  await act(async () =>
    app.router.navigate({ to: "/mealplansection/$sectionId", params: { sectionId: "999" } }),
  );
  await screen.findByText("Record not found");
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(app.writes).toHaveLength(0);
});

test("list read failure exposes Retry and then the real table", async () => {
  mountSections(undefined, { failReadOnce: true });
  await screen.findByText("Section read failed");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await table();
});

test.each([
  { path: "/mealplansections", recipes: false, planner: true },
  { path: "/mealplansection/new", recipes: true, planner: false },
])(
  "native $path reads its list or form independently of planner navigation",
  async ({ path, recipes, planner }) => {
    const app = mountSections(path, { recipes, planner });

    if (path === "/mealplansections") await table();
    else await form();
    expect(app.writes).toHaveLength(0);
  },
);
