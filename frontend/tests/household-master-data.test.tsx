import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { supportDialogs } from "./fixtures/dialogs";

type Kind = "chore" | "battery" | "category";

function mount(
  kind: Kind,
  path: string,
  {
    enabled = true,
    canTrack = true,
    canEdit = true,
    peer = false,
    mergeFailure = false,
    legacyLinks = false,
    numericFields = false,
  } = {},
) {
  const entity = kind === "chore" ? "chores" : kind === "battery" ? "batteries" : "task_categories";
  supportDialogs();

  const records = [
    {
      id: 1,
      name:
        kind === "chore"
          ? "Water plants"
          : kind === "battery"
            ? "Camera battery"
            : "Active category",
      active: 1,
      description: "Keep ready",
      period_type: "daily",
      period_days: 1,
      track_date_only: 0,
      next_execution_assigned_to_user_id: null,
      rescheduled_date: null,
      used_in: "Camera",
      charge_interval_days: 7,
    },
    {
      id: 2,
      name:
        kind === "chore"
          ? "Retired chore"
          : kind === "battery"
            ? "Retired battery"
            : "Retired category",
      active: 0,
      description: "No longer used",
      period_type: "manually",
      period_days: null,
      track_date_only: 0,
      next_execution_assigned_to_user_id: null,
      rescheduled_date: null,
      used_in: "Old remote",
      charge_interval_days: 0,
    },
  ];

  if (peer)
    records.push({ ...records[0]!, id: 3, name: kind === "chore" ? "Clean stove" : "USB battery" });

  if (legacyLinks)
    Object.assign(records[0]!, {
      userfields: {
        website: null,
        plain: "0",
        guide: '{"title":"Household guide","link":"https://example.test/household"}',
      },
    });

  if (numericFields) {
    Object.assign(records[0]!, {
      userfields: ["https://example.test/zero", "https://example.test/one"],
    });
    Object.assign(records[1]!, { userfields: [null, null] });
  }

  const fields = (
    legacyLinks
      ? [
          { name: "website", caption: "Placeholder website", type: "link-with-title" },
          { name: "plain", caption: "Saved plain", type: "link" },
          { name: "guide", caption: "Saved guide", type: "link-with-title" },
        ]
      : numericFields
        ? [
            { name: "0", caption: "Zero link", type: "link" },
            { name: "1", caption: "One link", type: "link" },
          ]
        : []
  ).map((field, index) => ({
    ...field,
    id: index + 1,
    entity,
    input_required: 0,
    default_value: null,
    config: null,
    sort_number: index + 1,
    show_as_column_in_tables: 1,
  }));

  const reads: string[] = [];
  const actions: Array<{ id: number; body: unknown }> = [];
  const deleted: number[] = [];
  const merges: Array<{ keep: number; discard: number }> = [];
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const pathname = url.pathname;

      if (!init?.method || init.method === "GET") reads.push(pathname);

      if (pathname === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (pathname === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (pathname === "/api/user") return Response.json([{ id: 1, username: "owner" }]);

      if (pathname === "/api/user/settings") return Response.json({});

      if (pathname === "/api/v2/user/permissions")
        return Response.json({
          MASTER_DATA_EDIT: canEdit,
          CHORE_TRACK_EXECUTION: canTrack,
          BATTERIES_TRACK_CHARGE_CYCLE: canTrack,
        });

      if (pathname === "/api/system/config")
        return Response.json({ [`FEATURE_FLAG_${entity.toUpperCase()}`]: enabled });

      if (pathname.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (pathname === "/api/objects/userfields" || pathname === "/api/v2/custom-data/fields")
        return Response.json(fields);

      const deletion = new RegExp(`^/api/objects/${entity}/(\\d+)$`).exec(pathname);

      if (deletion && init?.method === "DELETE") {
        const id = Number(deletion[1]);
        deleted.push(id);
        const index = records.findIndex((record) => record.id === id);

        if (index >= 0) records.splice(index, 1);

        return new Response(null, { status: 204 });
      }

      const merge = /^\/api\/chores\/(\d+)\/merge\/(\d+)$/.exec(pathname);

      if (merge && init?.method === "POST") {
        const keep = Number(merge[1]);
        const discard = Number(merge[2]);
        merges.push({ keep, discard });

        if (mergeFailure && merges.length === 1)
          return Response.json(
            { error_message: "Merge target unavailable", details: "Retry the selected chores" },
            { status: 503 },
          );
        const index = records.findIndex((record) => record.id === discard);

        if (index >= 0) records.splice(index, 1);

        return new Response(null, { status: 204 });
      }

      if (pathname === `/api/objects/${entity}`) return Response.json(records);

      if (pathname === `/api/v2/${entity}/overview`)
        return Response.json({
          rows: records.flatMap((record) =>
            record.active === 1
              ? [
                  {
                    ...record,
                    chore_id: record.id,
                    last_tracked_time: null,
                    next_estimated_execution_time: "2020-01-02 08:00:00",
                    next_estimated_charge_time: "2020-01-02 08:00:00",
                    is_rescheduled: 0,
                    is_reassigned: 0,
                    due_type: "overdue",
                    custom_values: {},
                  },
                ]
              : [],
          ),
          users: [{ id: 1, username: "owner", display_name: "Owner" }],
          current_user_id: 1,
          next_x_days: 5,
        });

      if (pathname === `/api/${entity}`)
        return Response.json(
          records.flatMap((record) =>
            record.active === 1
              ? [
                  kind === "chore"
                    ? {
                        ...record,
                        chore_id: record.id,
                        chore_name: record.name,
                        last_tracked_time: null,
                        next_estimated_execution_time: "2020-01-02 08:00:00",
                      }
                    : {
                        ...record,
                        battery_id: record.id,
                        battery: record,
                        last_tracked_time: null,
                        next_estimated_charge_time: "2020-01-02 08:00:00",
                      },
                ]
              : [],
          ),
        );

      if (pathname === "/api/v2/chores/tracking/users")
        return Response.json([{ id: 1, username: "owner", display_name: "Owner" }]);

      if (pathname === `/api/${entity}/1`)
        return Response.json(
          kind === "chore"
            ? {
                chore: records[0],
                next_estimated_execution_time: "2020-01-02 08:00:00",
                next_execution_assigned_user: null,
                last_tracked: null,
                tracked_count: actions.length,
                last_done_by: null,
                average_execution_frequency_hours: null,
              }
            : {
                battery: records[0],
                last_charged: null,
                charge_cycles_count: actions.length,
                next_estimated_charge_time: "2020-01-02 08:00:00",
              },
        );

      if (
        pathname === `/api/${entity}/1/${kind === "chore" ? "execute" : "charge"}` &&
        init?.method === "POST"
      ) {
        actions.push({ id: 1, body: init.body ? JSON.parse(String(init.body)) : null });

        return Response.json({ id: actions.length });
      }

      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return { records, reads, actions, deleted, merges, router };
}

test("numeric household custom-field arrays retain saved links, null placeholders and native table actions", async () => {
  const app = mount("chore", "/chores?include_disabled", { numericFields: true });
  const saved = (await screen.findByRole("rowheader", { name: "Water plants" })).closest("tr")!;
  const table = screen.getByRole("table");
  expect(within(table).getByRole("columnheader", { name: "Zero link" })).toBeTruthy();
  expect(within(table).getByRole("columnheader", { name: "One link" })).toBeTruthy();

  for (const name of ["zero", "one"]) {
    const link = within(saved).getByRole<HTMLAnchorElement>("link", {
      name: `https://example.test/${name}`,
    });

    expect(link.getAttribute("href")).toBe(`https://example.test/${name}`);
    expect(link.target).toBe("_blank");
  }

  expect(within(saved).getByRole("link", { name: "Edit this item" }).getAttribute("href")).toBe(
    "/chore/1",
  );
  expect(
    within(saved).getByRole<HTMLButtonElement>("button", { name: "Delete this item" }).disabled,
  ).toBe(false);

  const placeholder = within(table)
    .getByRole("rowheader", { name: "Retired chore" })
    .closest("tr")!;

  for (const cell of within(placeholder).getAllByRole("cell").slice(-2)) {
    expect(cell.textContent).toBe("");
    expect(cell.querySelector("a")).toBeNull();
  }

  const user = userEvent.setup();
  const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" });
  await user.type(search, "https://example.test/one");
  expect(within(table).getByRole("rowheader", { name: "Water plants" })).toBeTruthy();
  expect(within(table).queryByRole("rowheader", { name: "Retired chore" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(search.value).toBe("");
  expect(within(table).getByRole("rowheader", { name: "Retired chore" })).toBeTruthy();
  expect(app.reads).toContain("/api/objects/chores");
  expect(app.actions).toEqual([]);
  expect(app.deleted).toEqual([]);
});

test("legacy household null placeholders omit link controls while saved zero and titled links remain clickable", async () => {
  const app = mount("chore", "/chores", { legacyLinks: true });
  const row = (await screen.findByText("Water plants")).closest("tr")!;
  const [placeholder, plain, titled] = within(row).getAllByRole("cell").slice(-3);
  expect(placeholder!.textContent).toBe("");
  expect(placeholder!.querySelector("a")).toBeNull();
  const zero = within(plain!).getByRole<HTMLAnchorElement>("link", { name: "0" });
  expect(zero.getAttribute("href")).toBe("0");
  expect(zero.target).toBe("_blank");
  const guide = within(titled!).getByRole<HTMLAnchorElement>("link", { name: "Household guide" });
  expect(guide.getAttribute("href")).toBe("https://example.test/household");
  expect(guide.target).toBe("_blank");
  await userEvent.click(guide);
  expect(app.actions).toEqual([]);
  expect(app.deleted).toEqual([]);
  expect(app.merges).toEqual([]);
});

test.each(["chore", "battery"] as const)(
  "%s master list offers record editing and includes disabled records only when requested",
  async (kind) => {
    const entity =
      kind === "chore" ? "chores" : kind === "battery" ? "batteries" : "task_categories";

    const app = mount(kind, `/${entity}?include_disabled=0`);
    await screen.findByText(kind === "chore" ? "Retired chore" : "Retired battery");
    const add = screen.getByRole("link", { name: "Add" });
    const addUrl = new URL(add.getAttribute("href")!, "http://localhost");
    expect(addUrl.pathname).toBe(`/${kind}/new`);
    expect(addUrl.searchParams.has("embedded")).toBe(kind === "battery");

    const retiredRow = screen
      .getByText(kind === "chore" ? "Retired chore" : "Retired battery")
      .closest("tr");

    expect(retiredRow).not.toBeNull();
    const edit = within(retiredRow!).getByRole("link", { name: "Edit this item" });
    const editUrl = new URL(edit.getAttribute("href")!, "http://localhost");
    expect(editUrl.pathname).toBe(`/${kind}/2`);
    expect(editUrl.searchParams.has("embedded")).toBe(kind === "battery");
    expect(app.reads).toContain(`/api/objects/${entity}`);
    expect(
      screen.queryByRole("button", { name: kind === "chore" ? "Done" : "Charged" }),
    ).toBeNull();
  },
);

test.each(["chore", "battery"] as const)(
  "native %s overview remains an active tracking page",
  async (kind) => {
    const entity =
      kind === "chore" ? "chores" : kind === "battery" ? "batteries" : "task_categories";

    const app = mount(kind, `/${entity}overview`);
    const user = userEvent.setup();
    await screen.findByRole("heading", {
      name: kind === "chore" ? "Chores overview" : "Batteries overview",
      level: 1,
    });
    await screen.findByText(kind === "chore" ? "Water plants" : "Camera battery");
    expect(screen.queryByText(kind === "chore" ? "Retired chore" : "Retired battery")).toBeNull();

    const row = screen
      .getByText(kind === "chore" ? "Water plants" : "Camera battery")
      .closest("tr");

    expect(row).not.toBeNull();

    await user.click(
      within(row!).getByRole("button", {
        name: kind === "chore" ? "More" : "Actions for Camera battery",
      }),
    );

    const edit = within(row!).getByRole("menuitem", {
      name: kind === "chore" ? "Edit chore" : "Edit battery",
    });

    const editUrl = new URL(edit.getAttribute("href")!, "http://localhost");
    expect(editUrl.pathname).toBe(`/${kind}/1`);
    expect(editUrl.searchParams.has("embedded")).toBe(kind === "battery");

    const journal = within(row!).getByRole("menuitem", {
      name: kind === "chore" ? "Chore journal" : "Battery journal",
    });

    const journalUrl = new URL(journal.getAttribute("href")!, "http://localhost");
    expect(journalUrl.pathname).toBe(`/${entity}journal`);
    expect(journalUrl.searchParams.get(kind)).toBe("1");
    expect(journalUrl.searchParams.has("embedded")).toBe(true);
    expect(app.reads).toContain(`/api/${entity}`);
    const readsBeforeBooking = app.reads.filter((path) => path === `/api/${entity}`).length;
    await user.click(
      within(row!).getByRole("button", {
        name: kind === "chore" ? "Track next chore schedule" : "Track charge cycle Camera battery",
      }),
    );
    await waitFor(() => expect(app.actions).toHaveLength(1));
    expect(app.actions[0]?.id).toBe(1);
    await screen.findByText(
      kind === "chore"
        ? /Tracked execution of chore Water plants on/
        : /Tracked charge cycle of battery Camera battery on/,
    );
    expect(app.reads.filter((path) => path === `/api/${entity}`).length).toBeGreaterThan(
      readsBeforeBooking,
    );
  },
);

test.each(["chore", "battery"] as const)(
  "%s master list defaults to active records and toggles disabled records through its URL",
  async (kind) => {
    const entity =
      kind === "chore" ? "chores" : kind === "battery" ? "batteries" : "task_categories";

    const app = mount(kind, `/${entity}`);
    const user = userEvent.setup();
    await screen.findByText(kind === "chore" ? "Water plants" : "Camera battery");
    expect(screen.queryByText(kind === "chore" ? "Retired chore" : "Retired battery")).toBeNull();
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" });
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);
    await screen.findByText(kind === "chore" ? "Retired chore" : "Retired battery");
    expect(new URLSearchParams(app.router.state.location.searchStr).has("include_disabled")).toBe(
      true,
    );
    await user.click(screen.getByRole("checkbox", { name: "Show disabled" }));
    await waitFor(() =>
      expect(screen.queryByText(kind === "chore" ? "Retired chore" : "Retired battery")).toBeNull(),
    );
    expect(new URLSearchParams(app.router.state.location.searchStr).has("include_disabled")).toBe(
      false,
    );
  },
);

test.each(["chore", "battery"] as const)(
  "selected %s tracking card links to its native editor and journal",
  async (kind) => {
    mount(kind, `/${kind}tracking`);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole("combobox", { name: kind === "chore" ? "Chore" : "Battery" }),
      `grcy:${kind === "chore" ? "c" : "b"}:1`,
    );
    await user.click(screen.getByLabelText("Tracked time"));
    await screen.findByRole("heading", {
      name:
        kind === "chore"
          ? "Water plants"
          : kind === "battery"
            ? "Camera battery"
            : "Active category",
    });

    const edit = screen.getByRole("link", {
      name: kind === "chore" ? "Edit chore" : "Edit battery",
    });

    const editUrl = new URL(edit.getAttribute("href")!, "http://localhost");
    expect(editUrl.pathname).toBe(`/${kind}/1`);
    expect(editUrl.searchParams.has("embedded")).toBe(false);

    const journal = screen.getByRole("link", {
      name: kind === "chore" ? "Chore journal" : "Battery journal",
    });

    const journalUrl = new URL(journal.getAttribute("href")!, "http://localhost");
    expect(journalUrl.pathname).toBe(kind === "chore" ? "/choresjournal" : "/batteriesjournal");
    expect(journalUrl.searchParams.get(kind)).toBe("1");
    expect(journalUrl.searchParams.has("embedded")).toBe(true);
  },
);

test.each(["chores", "batteries", "batteriesoverview"] as const)(
  "native /%s remains readable when its household navigation feature is disabled",
  async (path) => {
    const kind = path.startsWith("chores") ? "chore" : "battery";
    const app = mount(kind, `/${path}`, { enabled: false });
    await screen.findByText(kind === "chore" ? "Water plants" : "Camera battery");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(app.actions).toEqual([]);
  },
);

test.each(["chore", "battery"] as const)(
  "%s deletion confirms the exact record, leaves cancellation untouched and reloads an unfiltered active list",
  async (kind) => {
    const entity =
      kind === "chore" ? "chores" : kind === "battery" ? "batteries" : "task_categories";

    const retiredName = kind === "chore" ? "Retired chore" : "Retired battery";
    const app = mount(kind, `/${entity}?include_disabled=0`);
    const user = userEvent.setup();
    await screen.findByText(retiredName);
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "Retired");
    const row = screen.getByRole("row", { name: new RegExp(retiredName) });
    await user.click(within(row).getByRole("button", { name: "Delete this item" }));
    const firstConfirmation = await screen.findByRole("dialog", { name: "Delete this item" });
    expect(firstConfirmation.textContent).toContain(`delete ${kind} "${retiredName}"`);
    await user.click(within(firstConfirmation).getByRole("button", { name: "No" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull(),
    );
    expect(app.deleted).toEqual([]);
    expect(app.records.map((record) => record.id)).toEqual([1, 2]);
    expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe(
      "Retired",
    );
    await user.click(
      within(screen.getByRole("row", { name: new RegExp(retiredName) })).getByRole("button", {
        name: "Delete this item",
      }),
    );
    const confirmation = await screen.findByRole("dialog", { name: "Delete this item" });
    const readsBeforeDelete = app.reads.filter((path) => path === `/api/objects/${entity}`).length;
    await user.click(within(confirmation).getByRole("button", { name: "Yes" }));
    await screen.findByText(kind === "chore" ? "Water plants" : "Camera battery");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull(),
    );
    expect(app.deleted).toEqual([2]);
    expect(app.records.map((record) => record.id)).toEqual([1]);
    expect(screen.queryByText(retiredName)).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked).toBe(
      false,
    );
    expect(new URLSearchParams(app.router.state.location.searchStr).has("include_disabled")).toBe(
      false,
    );
    expect(app.reads.filter((path) => path === `/api/objects/${entity}`).length).toBeGreaterThan(
      readsBeforeDelete,
    );
  },
);

test("chore merge retains selected keep/remove records through technical error details and retries the same operation", async () => {
  const app = mount("chore", "/chores?include_disabled=0", { peer: true, mergeFailure: true });
  const user = userEvent.setup();
  await screen.findByText("Water plants");
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Water");
  await user.click(
    within(screen.getByRole("row", { name: /Water plants/ })).getByRole("button", {
      name: "Merge",
    }),
  );
  const merge = await screen.findByRole("dialog", { name: "Merge chores" });
  await user.selectOptions(within(merge).getByRole("combobox", { name: "Chore to keep" }), "3");
  await user.selectOptions(within(merge).getByRole("combobox", { name: "Chore to remove" }), "1");
  await user.click(within(merge).getByRole("button", { name: "OK" }));
  await screen.findByText("Error while merging");
  expect(app.merges).toEqual([{ keep: 3, discard: 1 }]);
  expect(app.records.map((record) => record.id)).toEqual([1, 2, 3]);
  await user.click(screen.getByRole("button", { name: /Click to show technical details/ }));
  const details = await screen.findByRole("dialog", { name: "Error details" });
  expect(details.textContent).toContain("Merge target unavailable");
  expect(details.textContent).toContain("Retry the selected chores");
  await user.click(within(details).getByRole("button", { name: "OK" }));
  expect(
    within(merge).getByRole<HTMLSelectElement>("combobox", { name: "Chore to keep" }).value,
  ).toBe("3");
  expect(
    within(merge).getByRole<HTMLSelectElement>("combobox", { name: "Chore to remove" }).value,
  ).toBe("1");
  const readsBeforeRetry = app.reads.filter((path) => path === "/api/objects/chores").length;
  await user.click(within(merge).getByRole("button", { name: "OK" }));
  await screen.findByText("Clean stove");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Merge chores" })).toBeNull());
  expect(app.merges).toEqual([
    { keep: 3, discard: 1 },
    { keep: 3, discard: 1 },
  ]);
  expect(app.records.map((record) => record.id)).toEqual([2, 3]);
  expect(screen.queryByText("Water plants")).toBeNull();
  expect(screen.queryByText("Retired chore")).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
  expect(new URLSearchParams(app.router.state.location.searchStr).has("include_disabled")).toBe(
    false,
  );
  expect(app.reads.filter((path) => path === "/api/objects/chores").length).toBeGreaterThan(
    readsBeforeRetry,
  );
});

test.each(["chore", "battery"] as const)(
  "a read-only %s master list exposes records without editing, deleting or merging controls",
  async (kind) => {
    const entity =
      kind === "chore" ? "chores" : kind === "battery" ? "batteries" : "task_categories";

    const app = mount(kind, `/${entity}?include_disabled`, { canEdit: false });
    await screen.findByText(kind === "chore" ? "Water plants" : "Camera battery");
    await screen.findByText(kind === "chore" ? "Retired chore" : "Retired battery");
    expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit this item" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete this item" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Merge" })).toBeNull();
    expect(app.deleted).toEqual([]);
    expect(app.merges).toEqual([]);
  },
);

for (const [kind, path, retired] of [
  ["chore", "/chores", "Retired chore"],
  ["battery", "/batteries", "Retired battery"],
  ["category", "/taskcategories", "Retired category"],
] as const) {
  test.each([
    ["?include_disabled", true],
    ["?include_disabled=", false],
    ["?include_disabled=0", true],
  ] as const)(
    path + "%s separates checkbox truthiness from included records",
    async (query, checked) => {
      const app = mount(kind, path + query);
      const user = userEvent.setup();
      await screen.findByText(retired);
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked,
      ).toBe(checked);
      await user.click(screen.getByRole("button", { name: "Clear filter" }));
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked,
      ).toBe(false);
      expect(screen.getByText(retired)).toBeTruthy();
      expect(app.router.history.location.search).toBe(query);
      await user.click(screen.getByRole("checkbox", { name: "Show disabled" }));
      await waitFor(() => expect(app.router.history.location.search).toBe("?include_disabled"));
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked,
      ).toBe(true);
    },
  );
}
