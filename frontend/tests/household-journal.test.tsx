import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type {} from "vitest/jsdom";
import { createAppRouter } from "@/router";

type Kind = "chore" | "battery";

function mount(
  kind: Kind,
  {
    search = "",
    enabled = true,
    canUndo = true,
    holdUndo = false,
    heldUndos = false,
    undoResponses = {},
    transportOnlySuccesses = [],
  }: {
    search?: string;
    enabled?: boolean;
    canUndo?: boolean;
    holdUndo?: boolean;
    heldUndos?: boolean;
    undoResponses?: Record<number, 503 | "malformed-json">;
    transportOnlySuccesses?: number[];
  } = {},
) {
  for (const method of ["showModal", "close"] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method);
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    });
  }

  const entity = kind === "chore" ? "chores" : "batteries";
  const log = kind === "chore" ? "chores_log" : "battery_charge_cycles";

  const records = [
    { id: 1, name: kind === "chore" ? "Water plants" : "Camera battery", track_date_only: 0 },
    { id: 2, name: kind === "chore" ? "Clean stove" : "Remote battery", track_date_only: 0 },
  ];

  const rows = [
    {
      id: 101,
      record_id: 1,
      record_name: records[0]!.name,
      track_date_only: 0,
      tracked_time: "2020-01-03 08:00:00",
      scheduled_execution_time: kind === "chore" ? "2020-01-02 08:00:00" : null,
      row_created_timestamp: "2020-01-03 09:00:00",
      done_by_user_id: 2,
      undone: 0,
      undone_timestamp: null,
      skipped: 0,
      custom_values: { note: "After breakfast" },
    },
    {
      id: 102,
      record_id: 1,
      record_name: records[0]!.name,
      track_date_only: 0,
      tracked_time: "2020-01-05 08:00:00",
      scheduled_execution_time: kind === "chore" ? "2020-01-04 08:00:00" : null,
      row_created_timestamp: "2020-01-05 09:00:00",
      done_by_user_id: 1,
      undone: 0,
      undone_timestamp: null,
      skipped: kind === "chore" ? 1 : 0,
      custom_values: { note: "Away for the day" },
    },
    {
      id: 103,
      record_id: 2,
      record_name: records[1]!.name,
      track_date_only: 0,
      tracked_time: "2020-01-04 08:00:00",
      scheduled_execution_time: null,
      row_created_timestamp: "2020-01-04 09:00:00",
      done_by_user_id: 2,
      undone: 1,
      undone_timestamp: "2020-01-06 10:00:00",
      skipped: 0,
      custom_values: { note: "Duplicate entry" },
    },
  ];

  const reads: URL[] = [];
  const undoRequests: number[] = [];
  const undone: number[] = [];
  const undoBodies: unknown[] = [];
  const undoReplied: number[] = [];
  const replies: Array<() => void> = [];
  let releaseUndo: (() => void) | undefined;

  const undoGate = holdUndo
    ? new Promise<void>((resolve) => {
        releaseUndo = resolve;
      })
    : undefined;

  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (path === "/api/user") return Response.json([{ id: 1, username: "owner" }]);

      if (path === "/api/user/settings") return Response.json({});

      if (path === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (path === "/api/v2/user/permissions")
        return Response.json({
          CHORE_UNDO_EXECUTION: canUndo,
          BATTERIES_UNDO_CHARGE_CYCLE: canUndo,
        });

      if (path === "/api/system/config")
        return Response.json({ [`FEATURE_FLAG_${entity.toUpperCase()}`]: enabled });

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
        return Response.json([
          {
            id: 1,
            entity: log,
            name: "note",
            caption: "Journal note",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
            show_as_column_in_tables: 1,
            sort_number: 1,
          },
        ]);

      if (path === `/api/v2/${entity}/journal`) {
        reads.push(url);
        const selected = url.searchParams.get(kind);

        return Response.json({
          rows: rows
            .filter((row) => selected === null || row.record_id === Number(selected))
            .sort((a, b) => b.tracked_time.localeCompare(a.tracked_time)),
          records,
          users:
            kind === "chore"
              ? [
                  { id: 1, username: "owner", display_name: "Owner" },
                  { id: 2, username: "helper", display_name: "Helper" },
                ]
              : [],
          months: url.searchParams.get("months") ?? (kind === "chore" ? "12" : "24"),
          selected_id: selected === null ? null : Number(selected),
        });
      }

      const undo = new RegExp(
        `^/api/${kind === "chore" ? "chores/executions" : "batteries/charge-cycles"}/(\\d+)/undo$`,
      ).exec(path);

      if (undo && init?.method === "POST") {
        const id = Number(undo[1]);
        const ordinal = undoRequests.length;
        undoRequests.push(id);
        undoBodies.push(JSON.parse(String(init.body)));

        if (heldUndos)
          await new Promise<void>((resolve) => {
            replies.push(resolve);
          });

        await undoGate;
        undoReplied.push(id);

        // A separately named transport-only owner exercises source callback append semantics.
        // Its successful responses deliberately make no claim about a database transition.
        if (transportOnlySuccesses.includes(ordinal)) return new Response(null, { status: 204 });

        if (undoResponses[ordinal] === 503)
          return Response.json({ error_message: "Journal Undo failed" }, { status: 503 });

        const row = rows.find((item) => item.id === id)!;

        if (row.undone === 1)
          return Response.json(
            {
              error_message:
                kind === "chore"
                  ? "Execution does not exist or was already undone"
                  : "Charge cycle does not exist or was already undone",
            },
            { status: 400 },
          );

        row.undone = 1;
        row.undone_timestamp = "2020-01-07 11:00:00";
        undone.push(id);

        if (undoResponses[ordinal] === "malformed-json")
          return new Response("not JSON", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [`/${entity}journal${search}`] });
  const router = createAppRouter({ history });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return {
    rows,
    reads,
    undone,
    undoRequests,
    undoBodies,
    undoReplied,
    router,
    client,
    releaseUndo: (index = 0) => (heldUndos ? replies[index]?.() : releaseUndo?.()),
  };
}

test.each(["chore", "battery"] as const)(
  "%s journal loads its native URL and record/month filters",
  async (kind) => {
    const app = mount(kind, { search: `?${kind}=1&months=6` });
    const user = userEvent.setup();
    await screen.findByRole("heading", {
      name: kind === "chore" ? "Chores journal" : "Batteries journal",
      level: 1,
    });
    await screen.findByText("After breakfast");
    expect(app.reads.at(-1)?.searchParams.get(kind)).toBe("1");
    expect(app.reads.at(-1)?.searchParams.get("months")).toBe("6");
    expect(screen.queryByText("Duplicate entry")).toBeNull();
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", {
        name: kind === "chore" ? "Chore" : "Battery",
      }).value,
    ).toBe("1");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Date range" }).value).toBe("6");
    await user.selectOptions(
      screen.getByRole("combobox", { name: kind === "chore" ? "Chore" : "Battery" }),
      "2",
    );
    await screen.findByText("Duplicate entry");
    expect(screen.queryByText("After breakfast")).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "1");
    await waitFor(() => {
      expect(app.reads.at(-1)?.searchParams.get(kind)).toBe("2");
      expect(app.reads.at(-1)?.searchParams.get("months")).toBe("1");
    });
    const location = new URLSearchParams(app.router.state.location.searchStr);
    expect(location.get(kind)).toBe("2");
    expect(location.get("months")).toBe("1");
  },
);

function bodyRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

test("chore journal displays chronological rows, skipped and late schedules, users and custom fields", async () => {
  mount("chore");
  const user = userEvent.setup();
  await screen.findByText("After breakfast");
  expect(bodyRows().map((row) => row.textContent)).toEqual([
    expect.stringContaining("Away for the day"),
    expect.stringContaining("Duplicate entry"),
    expect.stringContaining("After breakfast"),
  ]);
  expect(screen.getByRole("columnheader", { name: "Journal note" })).toBeTruthy();
  const [skipped, undone, late] = bodyRows();
  expect(within(skipped!).getByText("Skipped")).toBeTruthy();
  expect(skipped!.getAttribute("data-skipped")).toBe("true");
  expect(skipped!.getAttribute("data-late")).not.toBe("true");
  expect(within(late!).getByText("2020-01-02 08:00:00")).toBeTruthy();
  expect(within(late!).getByText("Helper")).toBeTruthy();
  expect(late!.getAttribute("data-late")).toBe("true");
  expect(undone!.querySelector("s")?.textContent).toBe("Clean stove");
  expect(undone!.textContent).toContain("Undone on");
  expect(within(undone!).getByText("2020-01-06 10:00:00")).toBeTruthy();
  expect(
    within(undone!).getByRole<HTMLButtonElement>("button", { name: "Undo chore execution 103" })
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Tracked time" }));
  expect(screen.getByRole("columnheader", { name: "Tracked time" }).getAttribute("aria-sort")).toBe(
    "ascending",
  );
  expect(bodyRows().map((row) => row.textContent)).toEqual([
    expect.stringContaining("After breakfast"),
    expect.stringContaining("Duplicate entry"),
    expect.stringContaining("Away for the day"),
  ]);
});

test.each(["chore", "battery"] as const)(
  "%s journal Undo updates the booking and retains the native button behavior",
  async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2020, 0, 3, 12));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount(kind, { holdUndo: true });
    const user = userEvent.setup();
    await screen.findByText("After breakfast");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: kind === "chore" ? "Undo chore execution 103" : "Undo charge cycle 103",
      }).disabled,
    ).toBe(true);
    const label = kind === "chore" ? "Undo chore execution 101" : "Undo charge cycle 101";
    const button = screen.getByRole<HTMLButtonElement>("button", { name: label });
    await waitFor(() => expect(button.disabled).toBe(false));
    const originalRows = bodyRows();
    const originalRow = button.closest("tr")!;
    const cachedCells = [...originalRow.querySelectorAll("td")].slice(1);

    const tracked = originalRow.querySelector<HTMLTimeElement>(
      'time[datetime="2020-01-03 08:00:00"]',
    )!;

    const untouched = screen
      .getByRole("button", {
        name: kind === "chore" ? "Undo chore execution 102" : "Undo charge cycle 102",
      })
      .closest("tr")!;

    const untouchedCells = [...untouched.querySelectorAll("td")].map((cell) => cell.innerHTML);
    expect(tracked.textContent).toBe("Today");
    await user.click(button);
    await waitFor(() => expect(app.undoRequests).toEqual([101]));
    vi.setSystemTime(new Date(2020, 0, 4, 12));
    await act(async () => app.releaseUndo());
    await screen.findByText(
      kind === "chore" ? "Chore execution successfully undone" : "Charge cycle successfully undone",
    );
    expect(app.undone).toEqual([101]);
    expect(app.rows.find((row) => row.id === 101)?.undone).toBe(1);
    const row = bodyRows().find((entry) => within(entry).queryByText("After breakfast"));
    expect(row?.getAttribute("data-undone")).toBe("true");
    expect(row?.querySelector("s")?.textContent).toBe(
      kind === "chore" ? "Water plants" : "Camera battery",
    );
    expect(within(row!).getByText(/Undone on/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: label }).disabled).toBe(
      kind === "battery",
    );
    expect(row).toBe(originalRow);
    bodyRows().forEach((entry, index) => expect(entry).toBe(originalRows[index]));
    [...originalRow.querySelectorAll("td")]
      .slice(1)
      .forEach((cell, index) => expect(cell).toBe(cachedCells[index]));
    expect(originalRow.querySelector('time[datetime="2020-01-03 08:00:00"]')).toBe(tracked);
    expect(app.reads).toHaveLength(1);
    expect(tracked.textContent).toBe("a day ago");
    expect([...untouched.querySelectorAll("td")].map((cell) => cell.innerHTML)).toEqual(
      untouchedCells,
    );
    expect(within(originalRow).getByText("2020-01-04 12:00:00")).toBeTruthy();
    expect(within(originalRow).queryByText("2020-01-07 11:00:00")).toBeNull();
    expect(app.undoBodies).toEqual([{}]);
    expect(app.reads).toHaveLength(1);

    if (kind === "chore") {
      const acceptedHTML = originalRow.outerHTML;
      await user.click(button);
      await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 400,
          message: "Execution does not exist or was already undone",
        }),
      );
      expect(originalRow.outerHTML).toBe(acceptedHTML);
      expect(app.undoRequests).toEqual([101, 101]);
      expect(app.undone).toEqual([101]);
      expect(screen.getAllByText("Chore execution successfully undone")).toHaveLength(1);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    }

    expect(app.reads).toHaveLength(1);
    await user.type(screen.getByRole("searchbox", { name: "Search journal" }), "Undone on");
    expect(screen.queryByText("After breakfast")).toBeNull();
    expect(screen.getByText("Duplicate entry")).toBeTruthy();
  },
);

test("a pending chore Undo survives local search without refreshing a filtered row's clock", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2020, 0, 3, 12));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const app = mount("chore", { holdUndo: true });
  const user = userEvent.setup();
  await screen.findByText("After breakfast");

  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Undo chore execution 101",
  });

  await waitFor(() => expect(button.disabled).toBe(false));
  await user.click(button);
  await waitFor(() => expect(app.undoRequests).toEqual([101]));
  const search = screen.getByRole("searchbox", { name: "Search journal" });
  await user.type(search, "Away for the day");
  expect(screen.queryByText("After breakfast")).toBeNull();
  expect(screen.getByText("Away for the day")).toBeTruthy();
  vi.setSystemTime(new Date(2020, 0, 4, 12));
  await act(async () => app.releaseUndo());
  await screen.findByText("Chore execution successfully undone");
  expect(screen.queryByText("After breakfast")).toBeNull();
  await user.clear(search);
  const row = (await screen.findByText("After breakfast")).closest("tr")!;
  expect(row.getAttribute("data-undone")).toBe("true");
  expect(row.querySelector("s")?.textContent).toBe("Water plants");
  expect(within(row).getByText(/Undone on/)).toBeTruthy();
  expect(within(row).getByText("2020-01-04 12:00:00")).toBeTruthy();
  const marker = within(row).getByText(/Undone on/);
  expect(marker.querySelector("time")?.textContent ?? "").toBe("");
  expect(row.querySelector('time[datetime="2020-01-03 08:00:00"]')?.textContent).toBe("Today");
  expect(
    within(row).getByRole<HTMLButtonElement>("button", { name: "Undo chore execution 101" })
      .disabled,
  ).toBe(false);
  expect(app.undone).toEqual([101]);
  expect(app.undoBodies).toEqual([{}]);
  expect(app.reads).toHaveLength(1);
});

test("a stale battery Undo failure is quiet and a distinct live cycle can still be undone", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("battery");
  const user = userEvent.setup();
  await screen.findByText("After breakfast");
  const stale = screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 101" });
  await waitFor(() => expect(stale.disabled).toBe(false));
  const row = stale.closest("tr")!;
  const before = row.outerHTML;
  // Model another client having already changed the server, after this journal snapshot.
  app.rows.find((r) => r.id === 101)!.undone = 1;
  app.rows.find((r) => r.id === 101)!.undone_timestamp = "2020-01-07 11:00:00";
  await user.click(stale);
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 400,
      message: "Charge cycle does not exist or was already undone",
    }),
  );
  expect(row.outerHTML).toBe(before);
  expect(stale.disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByText("Charge cycle successfully undone")).toBeNull();
  expect(app.undone).toEqual([]);
  expect(app.reads).toHaveLength(1);
  const fresh = screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 102" });
  await user.click(fresh);
  await screen.findByText("Charge cycle successfully undone");
  expect(app.undoRequests).toEqual([101, 102]);
  expect(app.undoBodies).toEqual([{}, {}]);
  expect(app.undone).toEqual([102]);
  expect(fresh.disabled).toBe(true);
  expect(row.outerHTML).toBe(before);
  expect(error).toHaveBeenCalledTimes(1);
  expect(app.reads).toHaveLength(1);
});

test("two battery rows can Undo independently and apply reversed replies at their own callback times", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2020, 0, 3, 12));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const app = mount("battery", { heldUndos: true });
  const user = userEvent.setup();
  await screen.findByText("After breakfast");
  const first = screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 101" });
  const second = screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 102" });
  const rows = bodyRows();
  await waitFor(() => expect(first.disabled).toBe(false));
  await user.click(first);
  await waitFor(() => expect(app.undoRequests).toEqual([101]));
  expect(second.disabled).toBe(false);
  await user.click(second);
  await waitFor(() => expect(app.undoRequests).toEqual([101, 102]));
  vi.setSystemTime(new Date(2020, 0, 4, 12));
  await act(async () => app.releaseUndo(1));
  await screen.findByText("Charge cycle successfully undone");
  expect(second.disabled).toBe(true);
  expect(first.disabled).toBe(false);
  expect(within(second.closest("tr")!).getByText("2020-01-04 12:00:00")).toBeTruthy();
  vi.setSystemTime(new Date(2020, 0, 5, 12));
  await act(async () => app.releaseUndo(0));
  await waitFor(() => expect(first.disabled).toBe(true));
  expect(within(first.closest("tr")!).getByText("2020-01-05 12:00:00")).toBeTruthy();
  expect(app.undone).toEqual([102, 101]);
  expect(app.undoBodies).toEqual([{}, {}]);
  bodyRows().forEach((row, index) => expect(row).toBe(rows[index]));
  expect(screen.getAllByText("Charge cycle successfully undone")).toHaveLength(2);
  expect(app.reads).toHaveLength(1);
});

test("column reorder preserves a newer battery Undo when an older captured-cell callback completes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2020, 0, 3, 12));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const app = mount("battery", { heldUndos: true });
  const user = userEvent.setup();
  await screen.findByText("After breakfast");
  const first = screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 101" });
  await waitFor(() => expect(first.disabled).toBe(false));
  await user.click(first);
  await waitFor(() => expect(app.undoRequests).toEqual([101]));
  fireEvent.drop(screen.getByRole("columnheader", { name: "Battery" }), {
    dataTransfer: { getData: () => "tracked_time" },
  });
  expect(
    screen
      .getAllByRole("columnheader")
      .slice(1)
      .map((h) => h.textContent),
  ).toEqual(["Tracked time", "Battery", "Journal note"]);
  const second = screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 102" });
  expect(second.disabled).toBe(false);
  await user.click(second);
  await waitFor(() => expect(app.undoRequests).toEqual([101, 102]));
  vi.setSystemTime(new Date(2020, 0, 4, 12));
  await act(async () => app.releaseUndo(1));
  const newer = second.closest("tr")!;
  await within(newer).findByText("2020-01-04 12:00:00");
  expect(second.disabled).toBe(true);
  const accepted = newer.outerHTML;
  vi.setSystemTime(new Date(2020, 0, 5, 12));
  await act(async () => app.releaseUndo(0));
  await waitFor(() =>
    expect(screen.getAllByText("Charge cycle successfully undone")).toHaveLength(2),
  );
  expect(app.undone).toEqual([102, 101]);
  expect(screen.getByRole("button", { name: "Undo charge cycle 102" }).closest("tr")).toBe(newer);
  expect(newer.outerHTML).toBe(accepted);
  const old = screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 101" });
  const oldRow = old.closest("tr")!;
  expect(old.disabled).toBe(false);
  expect(oldRow.getAttribute("data-undone")).toBeNull();
  expect(oldRow.querySelector("s")).toBeNull();
  expect(within(oldRow).queryByText(/Undone on/)).toBeNull();
  expect(oldRow.querySelector('time[datetime="2020-01-03 08:00:00"]')?.textContent).toBe(
    "2 days ago",
  );
  fireEvent.drop(screen.getByRole("columnheader", { name: "Tracked time" }), {
    dataTransfer: { getData: () => "record_name" },
  });
  expect(
    screen
      .getAllByRole("columnheader")
      .slice(1)
      .map((h) => h.textContent),
  ).toEqual(["Battery", "Tracked time", "Journal note"]);
  expect(newer.getAttribute("data-undone")).toBe("true");
  expect(newer.querySelector("s")).toBeNull();
  expect(within(newer).queryByText(/Undone on/)).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo charge cycle 102" }).disabled,
  ).toBe(false);
  expect(app.reads).toHaveLength(1);
});

test.each(["chore", "battery"] as const)(
  "%s Undo updates only callback-visible cells while preserving its independent button policy",
  async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2020, 0, 3, 12));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const app = mount(kind, { holdUndo: true });
    const user = userEvent.setup();
    await screen.findByText("After breakfast");
    const label = kind === "chore" ? "Undo chore execution 101" : "Undo charge cycle 101";
    const button = screen.getByRole<HTMLButtonElement>("button", { name: label });
    const row = button.closest("tr")!;
    await waitFor(() => expect(button.disabled).toBe(false));
    const name = kind === "chore" ? "Chore" : "Battery";

    const toggleColumns = async (visible: boolean) => {
      await user.click(screen.getByRole("button", { name: "Table options" }));
      const dialog = within(await screen.findByRole("dialog", { name: "Table options" }));

      if (kind === "chore" && !visible)
        expect(
          dialog.getByRole<HTMLInputElement>("checkbox", { name: "Time of tracking" }).checked,
        ).toBe(false);

      for (const column of [
        name,
        "Tracked time",
        ...(kind === "chore" && visible ? ["Time of tracking"] : []),
      ]) {
        const checkbox = dialog.getByRole<HTMLInputElement>("checkbox", { name: column });

        if (checkbox.checked !== visible) await user.click(checkbox);
      }

      await user.click(dialog.getByRole("button", { name: "OK" }));
    };

    // Chore changes visibility after dispatch, so the response must read the live mask.
    if (kind === "chore") {
      await user.click(button);
      await waitFor(() => expect(app.undoRequests).toEqual([101]));
    }

    await toggleColumns(false);
    expect(screen.queryByRole("columnheader", { name })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Tracked time" })).toBeNull();

    if (kind === "battery") {
      await user.click(button);
      await waitFor(() => expect(app.undoRequests).toEqual([101]));
    }

    vi.setSystemTime(new Date(2020, 0, 4, 12));
    await act(async () => app.releaseUndo());
    await screen.findByText(
      kind === "chore" ? "Chore execution successfully undone" : "Charge cycle successfully undone",
    );
    expect(row.getAttribute("data-undone")).toBe("true");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: label }).disabled).toBe(
      kind === "battery",
    );
    await toggleColumns(true);
    expect(screen.getByRole("button", { name: label }).closest("tr")).toBe(row);
    expect(row.querySelector("s")).toBeNull();
    expect(within(row).queryByText(/Undone on/)).toBeNull();
    expect(row.querySelector('time[datetime="2020-01-03 08:00:00"]')?.textContent).toBe("Today");

    if (kind === "chore") {
      expect(row.querySelector('time[datetime="2020-01-03 09:00:00"]')?.textContent).toBe("Today");
      expect(row.querySelector('time[datetime="2020-01-02 08:00:00"]')?.textContent).toBe(
        "2 days ago",
      );
    }

    expect(screen.getByRole<HTMLButtonElement>("button", { name: label }).disabled).toBe(
      kind === "battery",
    );
    expect(app.undone).toEqual([101]);
    expect(app.undoBodies).toEqual([{}]);
    expect(app.reads).toHaveLength(1);
  },
);

test("controlled accepted same-ID callbacks prepend markers without claiming two database Undos", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2020, 0, 3, 12));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const app = mount("chore", { heldUndos: true, transportOnlySuccesses: [0, 1] });
  const user = userEvent.setup();
  await screen.findByText("After breakfast");

  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Undo chore execution 101",
  });

  const row = button.closest("tr")!;
  await waitFor(() => expect(button.disabled).toBe(false));
  await user.click(button);
  await waitFor(() => expect(app.undoRequests).toEqual([101]));
  expect(button.disabled).toBe(false);
  await user.click(button);
  await waitFor(() => expect(app.undoRequests).toEqual([101, 101]));
  vi.setSystemTime(new Date(2020, 0, 4, 12));
  await act(async () => app.releaseUndo(1));
  await within(row).findByText("2020-01-04 12:00:00");
  const olderTime = row.querySelector<HTMLTimeElement>('time[datetime="2020-01-04 12:00:00"]')!;
  expect(olderTime.textContent).toBe("Today");
  vi.setSystemTime(new Date(2020, 0, 5, 12));
  await act(async () => app.releaseUndo(0));
  await within(row).findByText("2020-01-05 12:00:00");
  const markers = within(row).getAllByText(/Undone on/);
  expect(markers).toHaveLength(2);
  expect(markers[0]!.textContent).toContain("2020-01-05 12:00:00");
  expect(markers[1]!.textContent).toContain("2020-01-04 12:00:00");
  expect(row.querySelector('time[datetime="2020-01-04 12:00:00"]')).toBe(olderTime);
  expect(olderTime.textContent).toBe("a day ago");
  expect(button.disabled).toBe(false);
  expect(screen.getAllByText("Chore execution successfully undone")).toHaveLength(2);
  expect(app.undoBodies).toEqual([{}, {}]);
  expect(app.undone).toEqual([]);
  expect(app.rows.find((r) => r.id === 101)!.undone).toBe(0);
  expect(app.reads).toHaveLength(1);
});

test("a malformed successful Undo body stops display and receipt after the accepted server transition", async () => {
  vi.stubGlobal("window", jsdom.window);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const events: ErrorEvent[] = [];

  const capture = (event: ErrorEvent) => {
    events.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", capture);
  onTestFinished(() => window.removeEventListener("error", capture));
  const app = mount("chore", { undoResponses: { 0: "malformed-json" } });
  const user = userEvent.setup();
  await screen.findByText("After breakfast");

  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Undo chore execution 101",
  });

  const row = button.closest("tr")!;
  await waitFor(() => expect(button.disabled).toBe(false));
  const before = row.outerHTML;
  await user.click(button);
  await waitFor(() => expect(events).toHaveLength(1));
  expect(app.undone).toEqual([101]);
  expect(row.outerHTML).toBe(before);
  expect(screen.queryByText("Chore execution successfully undone")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(error).not.toHaveBeenCalled();
  expect(app.reads).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Undo chore execution 102" }));
  await screen.findByText("Chore execution successfully undone");
  expect(app.undoRequests).toEqual([101, 102]);
  expect(app.undone).toEqual([101, 102]);
  expect(row.outerHTML).toBe(before);
  expect(events).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
  expect(app.reads).toHaveLength(1);
});

test("a failed old Undo cannot log or replace a fresh journal after native filter retirement", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("chore", { heldUndos: true, undoResponses: { 0: 503 } });
  const user = userEvent.setup();
  await screen.findByText("After breakfast");
  const oldRow = screen.getByRole("button", { name: "Undo chore execution 101" }).closest("tr")!;
  await user.click(within(oldRow).getByRole("button", { name: "Undo chore execution 101" }));
  await waitFor(() => expect(app.undoRequests).toEqual([101]));
  await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "6");
  await waitFor(() => expect(app.reads).toHaveLength(2));
  await waitFor(() => expect(oldRow.isConnected).toBe(false));

  const fresh = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Undo chore execution 102",
  });

  await waitFor(() => expect(fresh.disabled).toBe(false));
  await user.click(fresh);
  await waitFor(() => expect(app.undoRequests).toEqual([101, 102]));
  await act(async () => app.releaseUndo(1));
  await screen.findByText("Chore execution successfully undone");
  const row = fresh.closest("tr")!;
  const accepted = row.outerHTML;
  await act(async () => {
    app.releaseUndo(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(app.undoReplied).toEqual([102, 101]);
  expect(app.undone).toEqual([102]);
  expect(error).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Undo chore execution 102" }).closest("tr")).toBe(row);
  expect(row.outerHTML).toBe(accepted);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getAllByText("Chore execution successfully undone")).toHaveLength(1);
  expect(app.reads).toHaveLength(2);
});

test.each(["chore", "battery"] as const)(
  "embedded %s journal Clear filter retains only the native record context",
  async (kind) => {
    const app = mount(kind, { search: `?${kind}=1&months=6&embedded=1` });
    const user = userEvent.setup();
    await screen.findByText("After breakfast");
    await user.type(screen.getByRole("searchbox", { name: "Search journal" }), "breakfast");
    await waitFor(() => expect(screen.queryByText("Away for the day")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    await waitFor(() => {
      const location = new URLSearchParams(app.router.state.location.searchStr);
      expect(location.get("months")).toBeNull();
      expect(location.get(kind)).toBe(kind === "chore" ? "1" : null);
      expect(location.get("embedded")).toBe("1");
    });
    expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search journal" }).value).toBe(
      "",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Date range" }).value).toBe(
      kind === "chore" ? "12" : "24",
    );
    await screen.findByText("Away for the day");

    if (kind === "battery") await screen.findByText("Duplicate entry");
    else expect(screen.queryByText("Duplicate entry")).toBeNull();
    await waitFor(() => {
      expect(app.reads.at(-1)?.searchParams.get("months")).toBeNull();
      expect(app.reads.at(-1)?.searchParams.get(kind)).toBe(kind === "chore" ? "1" : null);
    });
  },
);

test("an Undo completing after journal departure invalidates data without notifying the replacement page", async () => {
  const app = mount("chore", { holdUndo: true });
  const user = userEvent.setup();
  await screen.findByText("After breakfast");
  app.client.setQueryData(["chores"], [{ id: 1, name: "Water plants" }]);
  expect(app.client.getQueryState(["chores"])?.isInvalidated).toBe(false);
  await user.click(screen.getByRole("button", { name: "Undo chore execution 101" }));
  await waitFor(() => expect(app.undoRequests).toEqual([101]));
  expect(app.undone).toEqual([]);
  await act(async () => {
    await app.router.navigate({ to: "/settings", search: { tab: "connection" } });
  });
  await screen.findByRole("heading", { name: "Settings", level: 1 });
  await act(async () => {
    app.releaseUndo();
  });
  await waitFor(() => expect(app.client.getQueryState(["chores"])?.isInvalidated).toBe(true));
  expect(app.undone).toEqual([101]);
  expect(screen.queryByText("Chore execution successfully undone")).toBeNull();
  expect(screen.queryByText("After breakfast")).toBeNull();
  expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
});

test.each(["chore", "battery"] as const)(
  "native %s journal reads remain available when its navigation feature is disabled",
  async (kind) => {
    const app = mount(kind, { enabled: false });
    await screen.findByRole("table");
    expect(bodyRows().length).toBeGreaterThan(0);
    expect(app.reads).toHaveLength(1);
    expect(app.undone).toEqual([]);
  },
);

test.each(["chore", "battery"] as const)(
  "a read-only %s journal cannot undo displayed entries",
  async (kind) => {
    const app = mount(kind, { canUndo: false });
    const user = userEvent.setup();
    await screen.findByText("After breakfast");

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: kind === "chore" ? "Undo chore execution 101" : "Undo charge cycle 101",
    });

    expect(button.disabled).toBe(true);
    await act(async () => {
      await user.click(button);
    });
    expect(app.undone).toEqual([]);
    expect(app.rows.find((row) => row.id === 101)?.undone).toBe(0);
  },
);
