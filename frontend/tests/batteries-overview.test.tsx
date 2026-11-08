import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type {} from "vitest/jsdom";
import { createAppRouter } from "@/router";
import type { SystemInfo } from "@/lib/types";
import { supportDialogs } from "./fixtures/dialogs";

function mount({
  days = 5,
  allowed = true,
  heldCharge = false,
  abortCharge = false,
  heldDetails = false,
  heldReload = false,
  primaryFailure = false,
  detailsFailure = false,
  detailsInvalidJson = false,
} = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00"));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  supportDialogs();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:code";
      static revokeObjectURL = () => {};
    },
  );

  const rows = [
    {
      id: 1,
      name: "Alpha battery",
      used_in: "Radio",
      charge_interval_days: 1,
      last_tracked_time: "2026-11-04 12:00:00",
      next_estimated_charge_time: "2026-11-05 12:00:00",
      due_type: "overdue",
      custom_values: { note: "Before trip" },
    },
    {
      id: 2,
      name: "Beta battery",
      used_in: "Camera",
      charge_interval_days: 1,
      last_tracked_time: "2026-11-05 15:00:00",
      next_estimated_charge_time: "2026-11-06 15:00:00",
      due_type: "duetoday",
      custom_values: {},
    },
    {
      id: 3,
      name: "Gamma battery",
      used_in: "Camera",
      charge_interval_days: 5,
      last_tracked_time: "2026-11-04 12:00:00",
      next_estimated_charge_time: "2026-11-09 12:00:00",
      due_type: days > 0 ? "duesoon" : "",
      custom_values: {},
    },
    {
      id: 4,
      name: "Idle battery",
      used_in: "Shelf",
      charge_interval_days: 0,
      last_tracked_time: null,
      next_estimated_charge_time: "2999-12-31 23:59:59",
      due_type: "",
      custom_values: {},
    },
    {
      id: 5,
      name: "Untracked battery",
      used_in: null,
      charge_interval_days: 1,
      last_tracked_time: null,
      next_estimated_charge_time: null,
      due_type: "overdue",
      custom_values: {},
    },
  ];

  const stored = rows.map((row) => ({ ...row }));
  const writes: Array<{ id: number; tracked_time: string }> = [];
  const detailReads: number[] = [];
  const pendingDetails: Array<{ id: number; finish: (response: Response) => void }> = [];
  let releaseCharge: (() => void) | undefined;
  let statisticsReads = 0;
  let contextReads = 0;
  let releaseReload: (() => void) | undefined;
  let primaryFailuresRemaining = primaryFailure ? 1 : 0;
  let detailsFailuresRemaining = detailsFailure ? 1 : 0;
  let invalidDetailsRemaining = detailsInvalidJson ? 1 : 0;

  const detail = (id: number, next?: string) => {
    const row = stored.find((row) => row.id === id)!;

    return {
      battery: {
        id,
        name: row.name,
        active: 1,
        description: null,
        used_in: row.used_in,
        charge_interval_days: row.charge_interval_days,
      },
      last_charged: row.last_tracked_time,
      charge_cycles_count: 12,
      next_estimated_charge_time: next ?? row.next_estimated_charge_time,
    };
  };

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/user") return Response.json([{ id: 1, username: "owner" }]);

    if (path === "/api/system/config") return Response.json({});

    if (path === "/api/system/info")
      return Response.json({
        grocy_version: { Version: "test", ReleaseDate: "2026-01-01" },
        php_version: "test",
        python_version: "test",
        sqlite_version: "test",
        db_version: 1,
        os: "test",
        client: "fixture",
      } satisfies SystemInfo);

    if (path === "/api/user/settings") return Response.json({});

    if (path === "/api/v2/user/permissions")
      return Response.json({ BATTERIES_TRACK_CHARGE_CYCLE: allowed, MASTER_DATA_EDIT: allowed });

    if (path.startsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

    if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
      return Response.json([
        {
          id: 1,
          entity: "batteries",
          name: "note",
          caption: "Journal note",
          type: "text-single-line",
          input_required: 0,
          default_value: null,
          config: null,
          show_as_column_in_tables: 1,
        },
      ]);

    if (path === "/api/v2/batteries/overview") {
      contextReads++;

      if (heldReload && contextReads > 1)
        await new Promise<void>((resolve) => {
          releaseReload = resolve;
        });

      return Response.json({ rows, next_x_days: days });
    }

    if (path === "/api/batteries") {
      statisticsReads++;

      return Response.json(
        stored.map((row) => ({
          ...row,
          battery_id: row.id,
          battery: {
            name: row.name,
            used_in: row.used_in,
            charge_interval_days: row.charge_interval_days,
          },
        })),
      );
    }

    const charge = /^\/api\/batteries\/(\d+)\/charge$/.exec(path);

    if (charge && init?.method === "POST") {
      if (primaryFailuresRemaining) {
        primaryFailuresRemaining--;

        if (heldCharge)
          await new Promise<void>((resolve) => {
            releaseCharge = resolve;
          });

        return Response.json({ error_message: "Charge failed" }, { status: 503 });
      }

      const body = JSON.parse(String(init.body));
      const id = Number(charge[1]);
      writes.push({ id, tracked_time: body.tracked_time });
      const row = stored.find((row) => row.id === id)!;
      row.last_tracked_time = body.tracked_time;
      row.next_estimated_charge_time =
        row.charge_interval_days > 0 ? "2026-11-07 12:00:00" : "2999-12-31 23:59:59";

      if (heldCharge)
        await new Promise<void>((resolve, reject) => {
          releaseCharge = resolve;

          if (abortCharge)
            init?.signal?.addEventListener(
              "abort",
              () => {
                reject(new DOMException("Cancelled old charge", "AbortError"));
              },
              { once: true },
            );
        });

      return Response.json({ id: writes.length });
    }

    const read = /^\/api\/batteries\/(\d+)$/.exec(path);

    if (read) {
      const id = Number(read[1]);
      detailReads.push(id);

      if (detailsFailuresRemaining) {
        detailsFailuresRemaining--;

        return Response.json({ error_message: "Detail failed" }, { status: 503 });
      }

      if (invalidDetailsRemaining) {
        invalidDetailsRemaining--;

        return new Response("not JSON", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (heldDetails)
        return new Promise<Response>((finish) => pendingDetails.push({ id, finish }));

      return Response.json(detail(id));
    }

    if (path.includes("/grocycode?download=true"))
      return new Response("png", { headers: { "content-type": "image/png" } });

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/batteriesoverview"] }),
  });

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
    stored,
    writes,
    detailReads,
    fetchMock,
    router,
    statisticsReads: () => statisticsReads,
    contextReads: () => contextReads,
    releaseReload: () => releaseReload?.(),
    releaseCharge: () => releaseCharge?.(),
    releaseDetail: (index: number, next: string) => {
      const pending = pendingDetails[index]!;
      pending.finish(Response.json(detail(pending.id, next)));
    },
    releaseDetailResponse: (index: number, response: Response) => {
      pendingDetails[index]!.finish(response);
    },
  };
}

function batteryRow(name: string) {
  return screen.getByRole("button", { name }).closest("tr")!;
}

test("native battery columns, custom fields and status counters retain their distinct initial semantics", async () => {
  mount();
  await screen.findByRole("columnheader", { name: "Next planned charge cycle" });
  expect(screen.getByRole("columnheader", { name: "Last charged" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Journal note" })).toBeTruthy();
  expect(within(batteryRow("Alpha battery")).getByText("Before trip")).toBeTruthy();
  expect(within(batteryRow("Idle battery")).getByText("...")).toBeTruthy();
  const overdue = await screen.findByRole("button", { name: "1 battery is overdue to be charged" });
  await userEvent.setup().click(overdue);
  expect(screen.getByRole("button", { name: "Alpha battery" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Untracked battery" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Beta battery" })).toBeNull();
  await userEvent.setup().selectOptions(screen.getByLabelText("Status"), "duesoon");
  expect(screen.getByRole("button", { name: "Beta battery" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Gamma battery" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Alpha battery" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Clear filter" }));
  expect(screen.getByRole("button", { name: "Idle battery" })).toBeTruthy();
});

test("quick charge refreshes visible times and statistics but retains cached table search/status", async () => {
  const app = mount();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Beta battery" });
  await user.selectOptions(screen.getByLabelText("Status"), "duetoday");
  const row = batteryRow("Beta battery");
  await user.click(within(row).getByRole("button", { name: "Track charge cycle Beta battery" }));
  await screen.findByText("Tracked charge cycle of battery Beta battery on 2026-11-06 12:00:00");
  expect(app.writes).toEqual([{ id: 2, tracked_time: "2026-11-06 12:00:00" }]);
  expect(within(row).getByText("2026-11-06 12:00:00")).toBeTruthy();
  expect(within(row).getByText("2026-11-07 12:00:00")).toBeTruthy();
  expect(row.dataset.info).toBe("true");
  expect(row.dataset.warning).toBe("true");
  await screen.findByRole("button", { name: "0 batteries are due to be charged today" });
  expect(screen.getByRole("button", { name: "Beta battery" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  await user.type(screen.getByLabelText("Search"), "2026-11-05 15:00:00");
  expect(screen.getByRole("button", { name: "Beta battery" })).toBeTruthy();
  await user.clear(screen.getByLabelText("Search"));
  await user.type(screen.getByLabelText("Search"), "2026-11-07 12:00:00");
  expect(screen.queryByRole("button", { name: "Beta battery" })).toBeNull();
  expect(
    app.fetchMock.mock.calls.filter(([path]) => String(path) === "/api/v2/batteries/overview"),
  ).toHaveLength(1);
  expect(app.statisticsReads()).toBe(2);
});

test("concurrent charge callbacks apply in response-completion order while sorting keeps its cache", async () => {
  const app = mount({ heldDetails: true });
  const user = userEvent.setup();
  const action = await screen.findByRole("button", { name: "Track charge cycle Beta battery" });
  await user.click(action);
  await waitFor(() => expect(app.detailReads).toHaveLength(1));
  vi.setSystemTime(new Date("2026-11-06T12:00:01"));
  await user.click(action);
  await waitFor(() => expect(app.detailReads).toHaveLength(2));
  await act(async () => {
    app.releaseDetail(1, "2026-11-08 12:00:00");
  });
  await within(batteryRow("Beta battery")).findByText("2026-11-06 12:00:01");
  await act(async () => {
    app.releaseDetail(0, "2026-11-12 12:00:00");
  });
  await within(batteryRow("Beta battery")).findByText("2026-11-06 12:00:00");
  expect(within(batteryRow("Beta battery")).getByText("2026-11-12 12:00:00")).toBeTruthy();
  const sort = screen.getByRole("button", { name: "Next planned charge cycle" });
  await user.click(sort);
  await user.click(sort);

  const ordered = screen.getAllByRole("row").flatMap((row) => {
    const header = within(row).queryByRole("rowheader");

    return header ? [header.textContent] : [];
  });

  expect(ordered.indexOf("Beta battery")).toBeLessThan(ordered.indexOf("Gamma battery"));
  expect(app.writes).toHaveLength(2);
});

test.each([false, true])(
  "leaving during the write stops followups, receipts and obsolete errors when HTTP failure=%s",
  async (primaryFailure) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount({ heldCharge: true, primaryFailure });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Track charge cycle Beta battery" }));
    await waitFor(() =>
      expect(
        app.fetchMock.mock.calls.filter(
          ([path, init]) => String(path) === "/api/batteries/2/charge" && init?.method === "POST",
        ),
      ).toHaveLength(1),
    );
    expect(app.writes).toHaveLength(primaryFailure ? 0 : 1);
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    await act(async () => {
      await app.router.navigate({ to: "/settings", search: { tab: "connection" } });
    });
    await screen.findByRole("heading", { name: "Settings" });
    const statistics = app.statisticsReads();
    await act(async () => {
      app.releaseCharge();
    });
    expect(app.detailReads).toEqual([]);
    expect(app.statisticsReads()).toBe(statistics);
    expect(screen.queryByText(/Tracked charge cycle/)).toBeNull();
    expect(screen.queryByText("Charge failed")).toBeNull();
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(error).not.toHaveBeenCalled();
  },
);

test.each([
  ["primaryFailure", "Charge failed"],
  ["detailsFailure", "Detail failed"],
] as const)(
  "charge %s logs once without a failure panel, retains the row and allows a later charge",
  async (setting, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount({ [setting]: true });
    const user = userEvent.setup();
    const action = await screen.findByRole("button", { name: "Track charge cycle Beta battery" });
    await screen.findByRole("button", { name: "1 battery is due to be charged today" });
    const row = batteryRow("Beta battery");
    const statistics = app.statisticsReads();
    await user.click(action);
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 503, message }));
    expect(batteryRow("Beta battery")).toBe(row);
    expect(within(row).getByText("2026-11-05 15:00:00")).toBeTruthy();
    expect(within(row).getByText("2026-11-06 15:00:00")).toBeTruthy();
    expect(screen.queryByText(/Tracked charge cycle/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(app.writes).toHaveLength(setting === "primaryFailure" ? 0 : 1);
    expect(app.detailReads).toHaveLength(setting === "primaryFailure" ? 0 : 1);
    expect(app.statisticsReads()).toBe(statistics);

    vi.setSystemTime(new Date("2026-11-06T12:00:01"));
    await user.click(action);
    await screen.findByText("Tracked charge cycle of battery Beta battery on 2026-11-06 12:00:01");
    expect(within(row).getByText("2026-11-06 12:00:01")).toBeTruthy();
    expect(within(row).getByText("2026-11-07 12:00:00")).toBeTruthy();
    expect(app.writes).toHaveLength(setting === "primaryFailure" ? 1 : 2);
    expect(app.writes.at(-1)).toEqual({ id: 2, tracked_time: "2026-11-06 12:00:01" });
    expect(app.detailReads).toEqual(setting === "primaryFailure" ? [2] : [2, 2]);
    expect(app.statisticsReads()).toBe(statistics + 1);
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  },
);

test("explicit invalid-JSON 200 details use the browser error channel and permit a later charge", async () => {
  // Vitest aliases window to Node's global; use JSDOM's real browser exception reporter.
  vi.stubGlobal("window", jsdom.window);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const callbackErrors: ErrorEvent[] = [];

  const captureError = (event: ErrorEvent) => {
    callbackErrors.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", captureError);
  onTestFinished(() => window.removeEventListener("error", captureError));

  const app = mount({ detailsInvalidJson: true });
  const user = userEvent.setup();
  const action = await screen.findByRole("button", { name: "Track charge cycle Beta battery" });
  await screen.findByRole("button", { name: "1 battery is due to be charged today" });
  const statistics = app.statisticsReads();
  await user.click(action);
  await waitFor(() => expect(callbackErrors).toHaveLength(1));
  expect(error).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  expect(screen.queryByText(/Tracked charge cycle/)).toBeNull();
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(app.writes).toHaveLength(1);
  expect(app.detailReads).toEqual([2]);
  expect(app.statisticsReads()).toBe(statistics);

  vi.setSystemTime(new Date("2026-11-06T12:00:01"));
  await user.click(action);
  await screen.findByText("Tracked charge cycle of battery Beta battery on 2026-11-06 12:00:01");
  expect(app.writes.at(-1)).toEqual({ id: 2, tracked_time: "2026-11-06 12:00:01" });
  expect(app.writes).toHaveLength(2);
  expect(app.detailReads).toEqual([2, 2]);
  expect(app.statisticsReads()).toBe(statistics + 1);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(callbackErrors).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
});

test("zero due-soon settings remove the due-soon option and status message", async () => {
  mount({ days: 0 });
  await screen.findByRole("button", { name: "1 battery is due to be charged today" });
  expect(
    within(screen.getByLabelText("Status")).queryByRole("option", { name: "Due soon" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: /within the next/ })).toBeNull();
});

test("native row menu keeps selected journal/editor/code actions and card details", async () => {
  const app = mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Actions for Beta battery" }));
  const menu = screen.getByRole("menu", { name: "Actions for Beta battery" });
  expect(
    within(menu).getByRole("menuitem", { name: "Battery journal" }).getAttribute("href"),
  ).toContain("battery=2");
  expect(
    within(menu).getByRole("menuitem", { name: "Edit battery" }).getAttribute("href"),
  ).toContain("/battery/2?embedded");
  await user.click(within(menu).getByRole("menuitem", { name: "Download Battery Grocycode" }));
  await waitFor(() =>
    expect(
      app.fetchMock.mock.calls.some(
        ([path]) => String(path) === "/battery/2/grocycode?download=true",
      ),
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Beta battery" }));
  const card = await screen.findByRole("dialog", { name: "Battery overview" });
  await within(card).findByText("12");
  expect(within(card).getByRole("link", { name: "Edit battery" }).getAttribute("href")).toBe(
    "/battery/2",
  );
  expect(
    within(card).getByRole("link", { name: "Battery journal" }).getAttribute("href"),
  ).toContain("battery=2");
});

test("readers keep native card links while row editing and charging remain permission-gated", async () => {
  mount({ allowed: false });
  await screen.findByRole("button", { name: "Beta battery" });
  expect(screen.queryByRole("button", { name: /Track charge cycle/ })).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Actions for Beta battery" }));
  expect(screen.queryByRole("menuitem", { name: "Edit battery" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("menuitem", { name: "Battery overview" }));
  const card = await screen.findByRole("dialog", { name: "Battery overview" });
  await within(card).findByText("12");
  expect(within(card).getByRole("link", { name: "Edit battery" }).getAttribute("href")).toBe(
    "/battery/2",
  );
});

function expectBlankBatteryCard(card: HTMLElement) {
  expect(within(card).getAllByRole("heading", { level: 3 })[0]!.textContent).toBe("");

  for (const label of ["Used in", "Charge cycles count", "Last charged"]) {
    const term = within(card).getByText(label, { selector: "dt" });
    expect(term.nextElementSibling?.textContent).toBe("");
  }

  for (const label of ["Edit battery", "Battery journal"]) {
    const link = within(card).getByRole("link", { name: label });
    expect(link.getAttribute("href")).toBe("#");
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.tabIndex).toBe(-1);
  }

  expect(within(card).queryByText("Loading…")).toBeNull();
  expect(within(card).queryByRole("alert")).toBeNull();
  expect(within(card).queryByRole("button", { name: "Retry" })).toBeNull();
}

test("the first pending battery Card is blank and a hidden initial failure logs without creating failure UI", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldDetails: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Alpha battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1]));
  expectBlankBatteryCard(screen.getByRole("dialog", { name: "Battery overview" }));
  expect(error).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => {
    app.releaseDetailResponse(
      0,
      Response.json({ error_message: "Battery details unavailable" }, { status: 503 }),
    );
  });
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ status: 503, message: "Battery details unavailable" }),
  );
  expect(screen.queryByRole("dialog", { name: "Battery overview" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Beta battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1, 2]));
  expectBlankBatteryCard(screen.getByRole("dialog", { name: "Battery overview" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(app.writes).toEqual([]);
  expect(error).toHaveBeenCalledTimes(1);
});

test("a failed selected battery Card retains accepted facts and response-ID links until a later selection succeeds", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldDetails: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Alpha battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1]));
  await act(async () => app.releaseDetail(0, "2026-11-05 12:00:00"));
  const first = screen.getByRole("dialog", { name: "Battery overview" });
  await within(first).findByRole("heading", { name: "Alpha battery" });
  const accepted = [...first.querySelectorAll("dt, dd")].map((node) => node.outerHTML);
  await user.click(within(first).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Beta battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1, 2]));
  const card = screen.getByRole("dialog", { name: "Battery overview" });
  const facts = [...card.querySelectorAll("dt, dd")];
  expect(facts.map((node) => node.outerHTML)).toEqual(accepted);
  const edit = within(card).getByRole("link", { name: "Edit battery" });
  const journal = within(card).getByRole("link", { name: "Battery journal" });
  expect(edit.getAttribute("href")).toBe("/battery/1");
  expect(journal.getAttribute("href")).toContain("battery=1");
  await act(async () => {
    app.releaseDetailResponse(
      1,
      Response.json({ error_message: "Battery does not exist" }, { status: 400 }),
    );
  });
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ status: 400, message: "Battery does not exist" }),
  );
  [...card.querySelectorAll("dt, dd")].forEach((node, index) => expect(node).toBe(facts[index]));
  expect([...card.querySelectorAll("dt, dd")].map((node) => node.outerHTML)).toEqual(accepted);
  expect(within(card).getByRole("link", { name: "Edit battery" })).toBe(edit);
  expect(within(card).getByRole("link", { name: "Battery journal" })).toBe(journal);
  expect(edit.getAttribute("href")).toBe("/battery/1");
  expect(journal.getAttribute("href")).toContain("battery=1");
  expect(within(card).queryByRole("alert")).toBeNull();
  expect(within(card).queryByRole("button", { name: "Retry" })).toBeNull();
  await user.click(within(card).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Gamma battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1, 2, 3]));
  await act(async () => app.releaseDetail(2, "2026-11-09 12:00:00"));
  const recovered = screen.getByRole("dialog", { name: "Battery overview" });
  await within(recovered).findByRole("heading", { name: "Gamma battery" });
  expect(within(recovered).getByRole("link", { name: "Edit battery" }).getAttribute("href")).toBe(
    "/battery/3",
  );
  expect(
    within(recovered).getByRole("link", { name: "Battery journal" }).getAttribute("href"),
  ).toContain("battery=3");
  expect(app.writes).toEqual([]);
  expect(error).toHaveBeenCalledTimes(1);
});

function captureBatteryCardErrors() {
  // Preserve the actual browser realm's uncaught callback reporter under Vitest.
  vi.stubGlobal("window", jsdom.window);
  const events: ErrorEvent[] = [];

  const capture = (event: ErrorEvent) => {
    events.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", capture);
  onTestFinished(() => window.removeEventListener("error", capture));

  return events;
}

test("malformed successful battery Card JSON raises a browser error and retains the accepted display", async () => {
  const callbackErrors = captureBatteryCardErrors();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldDetails: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Alpha battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1]));
  await act(async () => app.releaseDetail(0, "2026-11-05 12:00:00"));
  const first = screen.getByRole("dialog", { name: "Battery overview" });
  await within(first).findByRole("heading", { name: "Alpha battery" });
  await user.click(within(first).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Beta battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1, 2]));
  const card = screen.getByRole("dialog", { name: "Battery overview" });
  expect(within(card).getByRole("heading", { name: "Alpha battery" })).toBeTruthy();
  const before = card.innerHTML;
  await act(async () =>
    app.releaseDetailResponse(
      1,
      new Response("not JSON", { status: 200, headers: { "Content-Type": "application/json" } }),
    ),
  );
  await waitFor(() => expect(callbackErrors).toHaveLength(1));
  expect(card.innerHTML).toBe(before);
  expect(error).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await user.click(within(card).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Gamma battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([1, 2, 3]));
  await act(async () => app.releaseDetail(2, "2026-11-09 12:00:00"));
  await within(screen.getByRole("dialog", { name: "Battery overview" })).findByRole("heading", {
    name: "Gamma battery",
  });
  expect(callbackErrors).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
});

test.each(["HTTP 503", "malformed 200"])(
  "a retired battery Card %s cannot log or globally fail a fresh reset Card",
  async (responseKind) => {
    const callbackErrors = captureBatteryCardErrors();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount({ heldDetails: true, heldReload: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Beta battery" }));
    await waitFor(() => expect(app.detailReads).toEqual([2]));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Table options" }));
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
    await waitFor(() => expect(app.contextReads()).toBe(2));
    await act(async () => app.releaseReload());
    await user.click(await screen.findByRole("button", { name: "Alpha battery" }));
    await waitFor(() => expect(app.detailReads).toEqual([2, 1]));
    await act(async () => app.releaseDetail(1, "2026-11-05 12:00:00"));
    const card = screen.getByRole("dialog", { name: "Battery overview" });
    await within(card).findByRole("heading", { name: "Alpha battery" });
    const accepted = card.innerHTML;
    await act(async () => {
      app.releaseDetailResponse(
        0,
        responseKind === "HTTP 503"
          ? Response.json({ error_message: "Old Card unavailable" }, { status: 503 })
          : new Response("not JSON", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(card.innerHTML).toBe(accepted);
    expect(callbackErrors).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(app.detailReads).toEqual([2, 1]);
    expect(app.writes).toEqual([]);
  },
);

test("card replies retain native completion order across hidden and replaced selections", async () => {
  const app = mount({ heldDetails: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Beta battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([2]));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Alpha battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([2, 1]));
  await act(async () => {
    app.releaseDetail(1, "2026-11-05 12:00:00");
  });
  await within(screen.getByRole("dialog", { name: "Battery overview" })).findByRole("heading", {
    name: "Alpha battery",
  });
  await user.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => {
    app.releaseDetail(0, "2026-11-06 15:00:00");
  });
  await user.click(screen.getByRole("button", { name: "Gamma battery" }));
  const card = screen.getByRole("dialog", { name: "Battery overview" });
  expect(within(card).getByRole("heading", { name: "Beta battery" })).toBeTruthy();
  expect(within(card).getByRole("link", { name: "Edit battery" }).getAttribute("href")).toBe(
    "/battery/2",
  );
  await waitFor(() => expect(app.detailReads).toEqual([2, 1, 3]));
  await act(async () => {
    app.releaseDetail(2, "2026-11-09 12:00:00");
  });
  await within(card).findByRole("heading", { name: "Gamma battery" });
  await user.click(screen.getByRole("button", { name: "Close" }));
  app.stored.find((row) => row.id === 3)!.name = "Gamma refreshed battery";
  await user.click(screen.getByRole("button", { name: "Gamma battery" }));
  await waitFor(() => expect(app.detailReads).toEqual([2, 1, 3, 3]));
  await act(async () => app.releaseDetail(3, "2026-11-09 12:00:00"));
  const reopened = screen.getByRole("dialog", { name: "Battery overview" });
  await within(reopened).findByRole("heading", { name: "Gamma refreshed battery" });
  expect(within(reopened).getByRole("link", { name: "Edit battery" }).getAttribute("href")).toBe(
    "/battery/3",
  );
});

test.each([false, true])(
  "table reset discards old charge callbacks and errors when transport abort=%s",
  async (abortCharge) => {
    const app = mount({ heldCharge: true, heldReload: true, abortCharge });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Track charge cycle Beta battery" }),
    );
    await waitFor(() => expect(app.writes).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Table options" }));
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
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Table options" })).toBeNull());
    await waitFor(() => expect(app.contextReads()).toBe(2));
    expect(screen.queryByRole("button", { name: "Track charge cycle Beta battery" })).toBeNull();
    await act(async () => {
      app.releaseReload();
    });
    await screen.findByRole("button", { name: "Track charge cycle Beta battery" });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      app.releaseCharge();
    });
    expect(app.detailReads).toEqual([]);
    expect(screen.queryByText(/Tracked charge cycle/)).toBeNull();
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
  },
);
