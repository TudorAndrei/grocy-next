import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { mountUsers } from "./fixtures/users";

async function list() {
  return screen.findByRole("table", { name: "Users" });
}

function names(table: HTMLElement) {
  return within(table)
    .getAllByRole("row")
    .flatMap((row) => (row.dataset.userId ? [within(row).getByRole("rowheader").textContent] : []));
}

test("native users list exposes exact selected routes, custom values and its disabled self-delete boundary", async () => {
  mountUsers();
  const table = await list();
  expect(names(table)).toEqual(["alex", "owner", "zed"]);
  const alex = within(table).getByRole("rowheader", { name: "alex" }).closest("tr")!;
  expect(within(alex).getByRole("link", { name: "Edit this item" }).getAttribute("href")).toBe(
    "/user/2",
  );
  expect(
    within(alex).getByRole("link", { name: "Configure user permissions" }).getAttribute("href"),
  ).toBe("/user/2/permissions");
  expect(within(alex).getByText("Garden")).toBeTruthy();
  const owner = within(table).getByRole("rowheader", { name: "owner" }).closest("tr")!;
  expect(
    within(owner).getByRole<HTMLButtonElement>("button", { name: "Delete this item" }).disabled,
  ).toBe(true);
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toBe("/user/new");
  expect(screen.getByRole("link", { name: "Configure userfields" }).getAttribute("href")).toBe(
    "/userfields?entity=users",
  );
  expect(
    screen
      .getAllByRole("link", { name: "Manage users" })
      .some((link) => link.getAttribute("href") === "/users"),
  ).toBe(true);
});

test("users table searches all visible and hidden cells, groups custom values and persists its layout", async () => {
  const app = mountUsers();
  const user = userEvent.setup();
  let table = await list();
  await user.type(screen.getByRole("searchbox", { name: "Search" }), '"Garden" River');
  await waitFor(() => expect(names(table)).toEqual(["alex"]));
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "all");
  await waitFor(() => expect(names(table)).toEqual(["alex", "owner", "zed"]));
  await user.click(within(table).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("checkbox", { name: "First name" }));
  await user.click(within(options).getByRole("button", { name: "Move Department earlier" }));
  await user.click(within(options).getByRole("radio", { name: "Department" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  await user.click(within(table).getByRole("button", { name: "Kitchen" }));
  expect(within(table).queryByRole("rowheader", { name: "owner" })).toBeNull();
  await waitFor(() => expect(app.settings["datatables_rowGroup_users-table"]).toBeDefined());
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await act(async () => app.router.navigate({ href: "/users" }));
  table = await list();
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).not.toContain("First name");
  expect(within(table).getByRole("button", { name: "Kitchen" }).getAttribute("aria-expanded")).toBe(
    "true",
  );
  expect(names(table)).toEqual(["alex", "owner", "zed"]);
});

test("users delete Cancel does not write; success removes the exact record and clears the filter", async () => {
  const app = mountUsers();
  const user = userEvent.setup();
  const table = await list();
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "alex");
  await waitFor(() => expect(names(table)).toEqual(["alex"]));
  await user.click(within(table).getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "No" }));
  expect(app.writes).toEqual([]);
  await user.click(within(table).getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(names(screen.getByRole("table", { name: "Users" }))).toEqual(["owner", "zed"]),
  );
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
  expect(app.writes).toEqual([{ path: "/api/users/2", method: "DELETE", body: {} }]);
});

test("users deletion denial closes its prompt, logs only and retains the filter for retry", async () => {
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mountUsers("/users", { failPrimary: true });
  const user = userEvent.setup();
  const table = await list();
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "alex");
  await waitFor(() => expect(names(table)).toEqual(["alex"]));
  await user.click(within(table).getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(logger).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/Error while saving/)).toBeNull();
  expect(names(table)).toEqual(["alex"]);
  app.allowPrimary();
  await user.click(within(table).getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe(""),
  );
});

test.each([
  [true, false],
  [false, true],
] as const)(
  "external=%s hidden-auth=%s controls native Add and permission links independently",
  async (external, hiddenPassword) => {
    mountUsers("/users", { external, hiddenPassword });
    const table = await list();
    expect(screen.queryByRole("link", { name: "Add" }) !== null).toBe(!external);
    expect(
      within(table).queryAllByRole("link", { name: "Configure user permissions" }).length > 0,
    ).toBe(!hiddenPassword);
    expect(within(table).getAllByRole("link", { name: "Edit this item" })).toHaveLength(3);
  },
);

test("a background users read cannot mix new custom definitions and values into old native rows", async () => {
  const app = mountUsers("/users", { holdPrimary: true });
  const user = userEvent.setup();
  const table = await list();
  app.fields[0] = { ...app.fields[0]!, caption: "Renamed department" };
  app.values.find((row) => Number(row.object_id) === 2)!.value = "Changed";
  app.users.find((row) => row.id === 2)!.username = "alex new";
  await act(async () => {
    await app.client.invalidateQueries({ queryKey: ["users-overview"] });
  });
  expect(within(table).getByRole("columnheader", { name: "Department" })).toBeTruthy();
  expect(within(table).getByText("Garden")).toBeTruthy();
  expect(names(table)).toContain("alex");
  const alex = within(table).getByRole("rowheader", { name: "alex" }).closest("tr")!;
  await user.click(within(alex).getByRole("button", { name: "Delete this item" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));

  const deletion = app.fetchMock.mock.calls.find(
    ([path, options]) => path === "/api/users/2" && options?.method === "DELETE",
  )!;

  await user.click(within(table).getByRole("button", { name: "Table options" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Table options" })).getByRole("button", {
      name: "Reset",
    }),
  );
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("columnheader", { name: "Renamed department" })).toBeTruthy(),
  );
  expect(screen.getByText("Changed")).toBeTruthy();
  expect(names(screen.getByRole("table", { name: "Users" }))).toContain("alex new");
  expect(deletion[1]?.signal?.aborted).toBe(true);
  const reads = app.overviewReads;
  await act(async () => {
    app.primary.release();
    await app.primary.promise;
  });
  expect(app.overviewReads).toBe(reads);
  expect(names(screen.getByRole("table", { name: "Users" }))).toContain("alex new");
});

test("a denied users context exposes no user-management actions", async () => {
  mountUsers("/users", { deniedRead: true });
  expect(await screen.findByText("USERS_READ required")).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Users" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
});

test("file groups retain encoded identity and independent named controls even when display names match", async () => {
  const file = (name: string) => `${btoa(name)}_${btoa("Shared.pdf")}`;
  mountUsers("/users", {
    fields: [
      {
        id: 1,
        entity: "users",
        name: "attachment",
        caption: "Attachment",
        type: "file",
        input_required: 0,
        default_value: null,
        config: null,
        sort_number: 1,
        show_as_column_in_tables: 1,
      },
    ],
    values: [
      { object_id: 2, name: "attachment", value: file("a.pdf") },
      { object_id: 7, name: "attachment", value: file("b.pdf") },
    ],
  });
  const table = await list();
  const user = userEvent.setup();
  await user.click(within(table).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("radio", { name: "Attachment" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  const groups = within(table).getAllByRole("button", { name: "Group: Shared.pdf" });
  expect(groups).toHaveLength(2);
  const links = within(table).getAllByRole<HTMLAnchorElement>("link", { name: "Shared.pdf" });
  expect(links).toHaveLength(4);
  expect(links.map((link) => link.getAttribute("href")).sort()).toEqual(
    ["a.pdf", "a.pdf", "b.pdf", "b.pdf"].map((name) => `/files/userfiles/${file(name)}`).sort(),
  );
  expect(links.map((link) => link.target)).toEqual(["_blank", "_blank", "_blank", "_blank"]);
  await user.click(groups[0]!);
  expect(names(table)).toHaveLength(2);
  expect(groups[0]!.getAttribute("aria-expanded")).toBe("false");
  expect(groups[1]!.getAttribute("aria-expanded")).toBe("true");
});

test("a present null link and an absent field remain distinct native groups", async () => {
  mountUsers("/users", {
    fields: [
      {
        id: 1,
        entity: "users",
        name: "reference",
        caption: "Reference",
        type: "link-with-title",
        input_required: 0,
        default_value: null,
        config: null,
        sort_number: 1,
        show_as_column_in_tables: 1,
      },
    ],
    values: [{ object_id: 2, name: "reference", value: null }],
  });
  const table = await list();
  const user = userEvent.setup();
  await user.click(within(table).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("radio", { name: "Reference" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  const groups = within(table).getAllByRole("button", { name: "Group" });
  expect(groups).toHaveLength(2);
  expect(groups.filter((control) => control.closest("tr")?.querySelector("a"))).toHaveLength(1);
});
