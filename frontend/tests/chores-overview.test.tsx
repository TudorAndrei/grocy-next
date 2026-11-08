import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type {} from "vitest/jsdom";
import { createAppRouter } from "@/router";
import type { JsonObject } from "@/lib/json";

function mount({
  search = "",
  swap = false,
  canTrack = true,
  canMaster = true,
  assignments = true,
  dueDays = 5,
  stringUser = false,
  hold = "",
  savedLayout = "",
  heldCards = false,
  heldDetails = false,
  detailResponses = {},
  heldReschedules = false,
  calculationResponses = {},
  rescheduleResponses = {},
  cardResponses = {},
  heldReload = false,
  heldStatistics = false,
  abortHeld = false,
  failureStage = "",
  nonJsonFinal = false,
  fakeTimeouts = false,
}: {
  search?: string;
  swap?: string | boolean;
  canTrack?: boolean;
  canMaster?: boolean;
  assignments?: boolean;
  dueDays?: number;
  stringUser?: boolean;
  hold?: string;
  savedLayout?: string;
  heldCards?: boolean;
  heldDetails?: boolean;
  detailResponses?: Record<number, 503 | "invalid-json">;
  heldReschedules?: boolean;
  calculationResponses?: Record<number, 503 | "invalid-json" | "valid-json">;
  rescheduleResponses?: Record<number, "invalid-json" | "valid-json">;
  cardResponses?: Record<number, 400 | 503 | "invalid-json">;
  heldReload?: boolean;
  heldStatistics?: boolean;
  abortHeld?: boolean;
  failureStage?: "" | "first-detail" | "execute" | "last-detail";
  nonJsonFinal?: boolean;
  fakeTimeouts?: boolean;
} = {}) {
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

  vi.useFakeTimers({
    toFake: fakeTimeouts ? ["Date", "setTimeout", "clearTimeout"] : ["Date"],
  });
  vi.setSystemTime(new Date(2028, 4, 1, 10));

  const users = [
    { id: 1, username: "owner", display_name: "Owner" },
    { id: 2, username: "helper", display_name: "Helper" },
  ];

  const base = {
    track_date_only: 0,
    last_tracked_time: "2028-04-29 10:00:00",
    is_rescheduled: 0,
    is_reassigned: 0,
    period_type: "daily",
    custom_values: { place: "Kitchen" },
  };

  const rows = [
    {
      ...base,
      chore_id: 1,
      name: "Overdue chore",
      next_estimated_execution_time: "2028-04-30 10:00:00",
      next_execution_assigned_to_user_id: 1,
      due_type: "overdue",
      is_rescheduled: 1,
      is_reassigned: 1,
    },
    {
      ...base,
      chore_id: 2,
      name: "Today chore",
      next_estimated_execution_time: "2028-05-01 23:59:59",
      next_execution_assigned_to_user_id: 2,
      due_type: "duetoday",
      track_date_only: 1,
      custom_values: { place: "Bathroom" },
    },
    {
      ...base,
      chore_id: 3,
      name: "Soon chore",
      next_estimated_execution_time: "2028-05-03 10:00:00",
      next_execution_assigned_to_user_id: 1,
      due_type: "duesoon",
      custom_values: { place: "Garden" },
    },
    {
      ...base,
      chore_id: 4,
      name: "Manual chore",
      next_estimated_execution_time: null,
      next_execution_assigned_to_user_id: null,
      due_type: "",
      period_type: "manually",
      last_tracked_time: null,
    },
    {
      ...base,
      chore_id: 5,
      name: "Later chore",
      next_estimated_execution_time: "2028-06-01 10:00:00",
      next_execution_assigned_to_user_id: 2,
      due_type: "",
      custom_values: { place: "Attic" },
    },
  ];

  const writes: Array<{ path: string; body: JsonObject }> = [];
  const acceptedExecutions: Array<{ path: string; body: JsonObject }> = [];
  const acceptedReschedules: Array<{ path: string; body: JsonObject }> = [];
  const acceptedCalculations: Array<{ path: string; body: JsonObject }> = [];
  const rescheduleOverrides = new Map<number, JsonObject>();
  const detailReads: number[] = [];
  const detailReplies: Array<() => void> = [];
  const rescheduleReplies: Array<() => void> = [];
  let calculationAttempts = 0;
  let rescheduleAttempts = 0;
  const calls: string[] = [];
  const cardReads: number[] = [];
  const cardReplies: Array<() => void> = [];
  const statisticsReplies: Array<() => void> = [];
  let statisticsReads = 0;
  let viewReads = 0;
  let trackingDetailReads = 0;
  let failureRemaining = failureStage ? 1 : 0;
  let nonJsonRemaining = nonJsonFinal ? 1 : 0;
  let release: () => void = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let releaseReload: () => void = () => {};

  const reloadGate = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });

  let releaseFreshDetail: () => void = () => {};

  const freshDetailGate = new Promise<void>((resolve) => {
    releaseFreshDetail = resolve;
  });

  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      calls.push(`${init?.method ?? "GET"} ${path}`);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "owner" }]);

      if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (path === "/api/v2/user/permissions")
        return Response.json({ CHORE_TRACK_EXECUTION: canTrack, MASTER_DATA_EDIT: canMaster });

      if (path === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_CHORES: true,
          FEATURE_FLAG_CHORES_ASSIGNMENTS: assignments,
          FEATURE_FLAG_STOCK: false,
          FEATURE_FLAG_TASKS: false,
          FEATURE_FLAG_BATTERIES: false,
          FEATURE_FLAG_LABEL_PRINTER: true,
          LABEL_PRINTER_RUN_SERVER: false,
          LABEL_PRINTER_WEBHOOK: "https://printer.example/print",
          LABEL_PRINTER_PARAMS: {},
        });

      if (path === "/api/user/settings") {
        const settings: JsonObject = { chores_overview_swap_tracking_buttons: swap };

        if (savedLayout) settings["datatables_state_chores-overview-table"] = savedLayout;

        return Response.json(settings);
      }

      if (path.startsWith("/api/user/settings/")) return new Response(null, { status: 204 });

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
            entity: "chores",
            name: "place",
            caption: "Place",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
            show_as_column_in_tables: 1,
          },
        ]);

      if (path === "/api/objects/chores" && !init?.method) return Response.json([]);

      if (path === "/api/v2/chores/overview") {
        viewReads++;

        if (heldReload && viewReads > 1) await reloadGate;

        return Response.json({ rows, users, next_x_days: dueDays, current_user_id: 1 });
      }

      if (path === "/api/chores") {
        statisticsReads++;
        const response = Response.json(rows);

        if (heldStatistics && statisticsReads > 1)
          await new Promise<void>((resolve) => statisticsReplies.push(resolve));

        return response;
      }

      if (/^\/api\/chores\/\d+\/printlabel$/.test(path)) {
        if (hold === "label") await gate;

        return Response.json({ data: "label-image" });
      }

      const detail = /^\/api\/(?:v2\/)?chores\/(\d+)(\/card)?$/.exec(path);

      if (detail && !init?.method) {
        const trackingDetail = Number(detail[1]) === 1 && !detail[2];

        if (trackingDetail) trackingDetailReads++;

        const detailAttempt = trackingDetailReads;

        if (detail[2]) {
          const ordinal = cardReads.length;
          cardReads.push(Number(detail[1]));

          if (heldCards)
            await new Promise<void>((resolve) => {
              cardReplies.push(resolve);
            });

          const response = cardResponses[ordinal];

          if (response === "invalid-json")
            return new Response("not JSON", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });

          if (response)
            return Response.json(
              { error_message: response === 400 ? "Chore does not exist" : "Card request failed" },
              { status: response },
            );
        }

        if (!detail[2]) {
          const ordinal = detailReads.length;
          detailReads.push(Number(detail[1]));

          if (heldDetails)
            await new Promise<void>((resolve) => {
              detailReplies.push(resolve);
            });

          const response = detailResponses[ordinal];

          if (response === "invalid-json")
            return new Response("not JSON", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });

          if (response)
            return Response.json({ error_message: "Reschedule read failed" }, { status: response });
        }

        if (hold === "detail" && !detail[2]) {
          if (abortHeld)
            await new Promise<void>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new Error("Cancelled old chore detail")),
                { once: true },
              );
            });
          else await gate;
        }

        if (hold === "detail-failure" && trackingDetail) {
          if (detailAttempt === 1) await gate;
          else if (detailAttempt === 2) await freshDetailGate;
        }

        if (
          trackingDetail &&
          failureRemaining &&
          ((failureStage === "first-detail" && detailAttempt === 1) ||
            (failureStage === "last-detail" && detailAttempt === 2))
        ) {
          failureRemaining--;

          return Response.json({ error_message: "Tracking request failed" }, { status: 503 });
        }

        if (trackingDetail && detailAttempt === 2 && nonJsonRemaining) {
          nonJsonRemaining--;

          return new Response("not JSON", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const row = rows.find((row) => row.chore_id === Number(detail[1]))!;

        const user =
          users.find((user) => user.id === row.next_execution_assigned_to_user_id) ?? null;

        const result = {
          chore: {
            id: row.chore_id,
            name: row.name,
            description: "Description",
            period_type: row.period_type,
            track_date_only: row.track_date_only,
            next_execution_assigned_to_user_id:
              stringUser && row.next_execution_assigned_to_user_id !== null
                ? String(row.next_execution_assigned_to_user_id)
                : row.next_execution_assigned_to_user_id,
            rescheduled_date: rescheduleOverrides.has(row.chore_id)
              ? rescheduleOverrides.get(row.chore_id)!.rescheduled_date
              : row.is_rescheduled
                ? row.next_estimated_execution_time
                : null,
          },
          next_estimated_execution_time: row.next_estimated_execution_time,
          next_execution_assigned_user: user,
          last_tracked: row.last_tracked_time,
          tracked_count: detail[2] ? 1234 : 3,
          last_done_by: user,
          average_execution_frequency_hours: 48,
        };

        return Response.json(
          detail[2]
            ? { ...result, description_html: "<strong>Rich description</strong><br>Second line" }
            : result,
        );
      }

      if (init?.method === "POST" || init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push({ path, body });
        const execution = /^\/api\/chores\/(\d+)\/execute$/.exec(path);

        if (execution) {
          if (hold === "execute") await gate;

          if (failureStage === "execute" && failureRemaining) {
            failureRemaining--;

            return Response.json({ error_message: "Tracking request failed" }, { status: 503 });
          }

          acceptedExecutions.push({ path, body });
          const row = rows.find((row) => row.chore_id === Number(execution[1]))!;
          row.next_estimated_execution_time = "2028-05-01 23:59:59";
          row.next_execution_assigned_to_user_id = 2;

          if (!body.skipped) row.last_tracked_time = body.tracked_time;
          row.is_rescheduled = 0;
          row.is_reassigned = 0;

          return Response.json({ id: 99 });
        }

        if (/^\/api\/objects\/chores\/\d+$/.test(path)) {
          const ordinal = rescheduleAttempts++;

          if (hold === "reschedule") await gate;

          if (heldReschedules)
            await new Promise<void>((resolve) => {
              rescheduleReplies.push(resolve);
            });

          if (!canMaster)
            return Response.json(
              { error_message: "Permission missing: MASTER_DATA_EDIT" },
              { status: 403 },
            );

          acceptedReschedules.push({ path, body });
          rescheduleOverrides.set(Number(path.split("/").at(-1)), body);

          if (rescheduleResponses[ordinal] === "invalid-json")
            return new Response("not JSON", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });

          if (rescheduleResponses[ordinal] === "valid-json")
            return Response.json({ success: true });

          return new Response(null, { status: 204 });
        }

        if (path === "/api/chores/executions/calculate-next-assignments") {
          const response = calculationResponses[calculationAttempts++];

          if (response === 503)
            return Response.json(
              { error_message: "Calculation request failed" },
              { status: response },
            );

          acceptedCalculations.push({ path, body });

          if (response === "invalid-json")
            return new Response("not JSON", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });

          if (response === "valid-json") return Response.json({ success: true });

          return new Response(null, { status: 204 });
        }
      }

      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/choresoverview${search}`] }),
  });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
    vi.useRealTimers();
  });

  return {
    router,
    writes,
    acceptedExecutions,
    acceptedReschedules,
    acceptedCalculations,
    detailReads,
    releaseDetail: (index: number) => detailReplies[index]?.(),
    releaseReschedule: (index: number) => rescheduleReplies[index]?.(),
    calls,
    rows,
    release,
    releaseReload,
    releaseFreshDetail,
    client,
    viewReads: () => viewReads,
    cardReads,
    releaseCard: (index: number) => cardReplies[index]?.(),
    statisticsReplies,
  };
}

const rowFor = (name: string) => screen.getByRole("button", { name }).closest("tr")!;

async function chooseReschedule(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(rowFor(name)).getByRole("button", { name: "More" }));
  await user.click(
    within(rowFor(name)).getByRole("menuitem", { name: "Reschedule next execution" }),
  );
}

const pipelineCalls = (calls: string[]) =>
  calls.filter((call) => ["GET /api/chores/1", "POST /api/chores/1/execute"].includes(call));

test("overview exposes native date/status/custom columns, statistics, filters and user URL behavior", async () => {
  const app = mount({ search: "?user=1&keep=present" });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await screen.findByText("2 chores are due to be done within the next 5 days");
  expect(screen.queryByRole("button", { name: "Today chore" })).toBeNull();
  expect(screen.getByRole("button", { name: "Soon chore" })).toBeTruthy();
  expect(screen.getByText("Rescheduled")).toBeTruthy();
  expect(screen.getByText("Reassigned")).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Assignment" }), "");
  await screen.findByRole("button", { name: "Manual chore" });
  expect(app.router.state.location.search.user).toBe("1");
  expect(
    within(rowFor("Manual chore")).getByRole<HTMLButtonElement>("button", {
      name: "Skip next chore schedule",
    }).disabled,
  ).toBe(true);
  await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "duesoon");
  expect(screen.queryByRole("button", { name: "Overdue chore" })).toBeNull();
  expect(screen.getByRole("button", { name: "Today chore" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
    target: { value: "Garden" },
  });
  expect(screen.queryByRole("button", { name: "Today chore" })).toBeNull();
  expect(screen.getByRole("button", { name: "Soon chore" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await waitFor(() => expect(app.router.state.location.search.user).toBeUndefined());
  expect(app.router.state.location.search.keep).toBe("present");
  expect(screen.getByRole("button", { name: "Today chore" })).toBeTruthy();
});

test("tracking refreshes only its row and preserves native stale user/status filter defects", async () => {
  const app = mount({ search: "?user=1", fakeTimeouts: true });
  await vi.waitFor(
    async () => {
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.queryByRole("button", { name: "Overdue chore" })).toBeTruthy();
    },
    { interval: 1 },
  );
  const source = rowFor("Overdue chore");
  await vi.waitFor(
    async () => {
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(
        within(source).getByRole<HTMLButtonElement>("button", {
          name: "Track next chore schedule",
        }).disabled,
      ).toBe(false);
    },
    { interval: 1 },
  );
  expect(Date.now() - new Date(2028, 4, 1, 10).getTime()).toBeLessThan(1000);
  await act(async () => {
    fireEvent.click(within(source).getByRole("button", { name: "Track next chore schedule" }));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(
    screen.getByText("Tracked execution of chore Overdue chore on 2028-04-30 10:00:00"),
  ).toBeTruthy();
  expect(app.writes[0]?.body).toEqual({ tracked_time: "2028-04-30 10:00:00", skipped: false });
  expect(app.calls.filter((call) => call === "GET /api/chores/1")).toHaveLength(2);
  expect(app.viewReads()).toBe(1);
  expect(within(rowFor("Overdue chore")).getByText("Helper")).toBeTruthy();
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Assignment" }).value).toBe("1");
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByText("Rescheduled")).toBeNull();

  const search = screen.getByRole("searchbox", { name: "Search" });
  fireEvent.change(search, { target: { value: "Helper" } });
  expect(screen.queryByRole("button", { name: "Overdue chore" })).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(499));
  expect(screen.queryByRole("button", { name: "Overdue chore" })).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole("button", { name: "Overdue chore" })).toBeTruthy();

  // A later callback uses the source's zero-delay draw after the startup second.
  await act(() => vi.advanceTimersByTimeAsync(1000));
  fireEvent.change(search, { target: { value: "" } });
  await act(async () => {
    fireEvent.click(
      within(rowFor("Soon chore")).getByRole("button", {
        name: "Track next chore schedule",
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(
    screen.getByText("Tracked execution of chore Soon chore on 2028-05-03 10:00:00"),
  ).toBeTruthy();
  expect(app.acceptedExecutions[1]?.body).toEqual({
    tracked_time: "2028-05-03 10:00:00",
    skipped: false,
  });
  await act(() => vi.advanceTimersByTimeAsync(1));
  fireEvent.change(search, { target: { value: "Helper" } });
  expect(screen.getByRole("button", { name: "Soon chore" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
    target: { value: "duesoon" },
  });
  expect(screen.queryByRole("button", { name: "Overdue chore" })).toBeNull();
  expect(screen.getByRole("button", { name: "Today chore" })).toBeTruthy();
});

test("date-only skip uses the next schedule, while PHP boolval swap and alternate missing-name receipt remain native", async () => {
  const app = mount({ swap: "false" });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Today chore" });
  const today = rowFor("Today chore");
  await waitFor(() =>
    expect(
      within(today).getByRole<HTMLButtonElement>("button", { name: "Skip next chore schedule" })
        .disabled,
    ).toBe(false),
  );
  await user.click(within(today).getByRole("button", { name: "Skip next chore schedule" }));
  await screen.findByText("Tracked execution of chore Today chore on 2028-05-01");
  expect(app.writes[0]?.body).toEqual({ tracked_time: "2028-05-01", skipped: true });
  const later = rowFor("Later chore");
  expect(within(later).getByRole("button", { name: "Track chore execution now" })).toBeTruthy();
  await user.click(within(later).getByRole("button", { name: "More" }));
  await user.click(within(later).getByRole("menuitem", { name: "Track next chore schedule" }));
  await screen.findByText("Tracked execution of chore undefined on 2028-06-01 10:00:00");
  expect(app.writes[1]?.body).toEqual({ tracked_time: "2028-06-01 10:00:00", skipped: false });
  await waitFor(() => {
    const names = within(screen.getByRole("table", { name: "Chores overview" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent);

    expect(names.indexOf("Later chore")).toBeLessThan(names.indexOf("Soon chore"));
  });
});

test.each([
  { stage: "first-detail", calls: ["GET /api/chores/1"], attempted: 0, accepted: 0 },
  {
    stage: "execute",
    calls: ["GET /api/chores/1", "POST /api/chores/1/execute"],
    attempted: 1,
    accepted: 0,
  },
  {
    stage: "last-detail",
    calls: ["GET /api/chores/1", "POST /api/chores/1/execute", "GET /api/chores/1"],
    attempted: 1,
    accepted: 1,
  },
] as const)(
  "$stage HTTP failure logs once and retains the row until a fresh manual tracking attempt succeeds",
  async ({ stage, calls, attempted, accepted }) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount({ failureStage: stage });
    const user = userEvent.setup();
    const row = (await screen.findByRole("button", { name: "Overdue chore" })).closest("tr")!;

    const action = within(row).getByRole<HTMLButtonElement>("button", {
      name: "Track next chore schedule",
    });

    await waitFor(() => expect(action.disabled).toBe(false));
    await screen.findByText("1 chore is due to be done today");
    const statistics = app.calls.filter((call) => call === "GET /api/chores").length;
    await user.click(action);
    await waitFor(() => expect(pipelineCalls(app.calls)).toEqual(calls));
    await waitFor(() => expect(document.body.classList.contains("cursor-busy")).toBe(false));
    expect(app.writes).toHaveLength(attempted);
    expect(app.acceptedExecutions).toHaveLength(accepted);
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503, message: "Tracking request failed" }),
    );
    expect(rowFor("Overdue chore")).toBe(row);
    expect(within(row).getByText("2028-04-29 10:00:00")).toBeTruthy();
    expect(within(row).getByText("2028-04-30 10:00:00")).toBeTruthy();
    expect(within(row).getByText("Owner")).toBeTruthy();
    expect(within(row).getByText("Rescheduled")).toBeTruthy();
    expect(within(row).getByText("Reassigned")).toBeTruthy();
    expect(screen.getByText("1 chore is overdue to be done")).toBeTruthy();
    expect(screen.getByText("1 chore is due to be done today")).toBeTruthy();
    expect(screen.queryByText(/Tracked execution of chore/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(app.calls.filter((call) => call === "GET /api/chores")).toHaveLength(statistics);
    expect(app.viewReads()).toBe(1);

    await user.click(action);
    const tracked = stage === "last-detail" ? "2028-05-01 23:59:59" : "2028-04-30 10:00:00";
    await screen.findByText("Tracked execution of chore Overdue chore on " + tracked);
    expect(pipelineCalls(app.calls)).toEqual([
      ...calls,
      "GET /api/chores/1",
      "POST /api/chores/1/execute",
      "GET /api/chores/1",
    ]);
    expect(app.writes).toHaveLength(attempted + 1);
    expect(app.acceptedExecutions).toHaveLength(accepted + 1);
    expect(app.acceptedExecutions.at(-1)?.body).toEqual({ tracked_time: tracked, skipped: false });
    expect(within(rowFor("Overdue chore")).getByText("Helper")).toBeTruthy();
    expect(within(rowFor("Overdue chore")).getAllByText(tracked)).toHaveLength(
      stage === "last-detail" ? 2 : 1,
    );
    expect(within(rowFor("Overdue chore")).queryByText("Rescheduled")).toBeNull();
    await waitFor(() =>
      expect(app.calls.filter((call) => call === "GET /api/chores")).toHaveLength(statistics + 1),
    );
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(app.viewReads()).toBe(1);
  },
);

test("invalid-JSON 200 final details stay outside the HTTP failure channel after an accepted execution", async () => {
  // Keep JSDOM's real browser exception reporter instead of Vitest's Node-global window alias.
  vi.stubGlobal("window", jsdom.window);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const callbackErrors: ErrorEvent[] = [];

  const captureError = (event: ErrorEvent) => {
    callbackErrors.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", captureError);
  onTestFinished(() => window.removeEventListener("error", captureError));

  const app = mount({ nonJsonFinal: true });
  const user = userEvent.setup();
  const row = (await screen.findByRole("button", { name: "Overdue chore" })).closest("tr")!;

  const action = within(row).getByRole<HTMLButtonElement>("button", {
    name: "Track next chore schedule",
  });

  await waitFor(() => expect(action.disabled).toBe(false));
  await screen.findByText("1 chore is due to be done today");
  const statistics = app.calls.filter((call) => call === "GET /api/chores").length;
  await user.click(action);
  await waitFor(() => expect(app.acceptedExecutions).toHaveLength(1));
  expect(pipelineCalls(app.calls)).toEqual([
    "GET /api/chores/1",
    "POST /api/chores/1/execute",
    "GET /api/chores/1",
  ]);
  await waitFor(() => expect(callbackErrors).toHaveLength(1));
  expect(error).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Tracked execution of chore/)).toBeNull();
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(app.calls.filter((call) => call === "GET /api/chores")).toHaveLength(statistics);

  await user.click(action);
  await screen.findByText("Tracked execution of chore Overdue chore on 2028-05-01 23:59:59");
  expect(app.acceptedExecutions).toHaveLength(2);
  expect(app.acceptedExecutions.at(-1)?.body).toEqual({
    tracked_time: "2028-05-01 23:59:59",
    skipped: false,
  });
  expect(within(rowFor("Overdue chore")).getByText("Helper")).toBeTruthy();
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(callbackErrors).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
});

test("rescheduling clears numeric user prefill, allows past dates, and uses native object-then-calculation writes", async () => {
  const app = mount({
    rescheduleResponses: { 0: "valid-json" },
    calculationResponses: { 0: "valid-json" },
  });

  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await user.click(within(rowFor("Overdue chore")).getByRole("button", { name: "More" }));
  await user.click(
    within(rowFor("Overdue chore")).getByRole("menuitem", { name: "Reschedule next execution" }),
  );
  const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
  const date = await within(modal).findByLabelText<HTMLInputElement>("Next estimated tracking");
  expect(date.value).toBe("2028-04-30 10:00:00");
  expect(within(modal).getByRole<HTMLInputElement>("combobox", { name: "Assigned to" }).value).toBe(
    "",
  );
  fireEvent.change(date, { target: { value: "2000-01-02T03:04" } });
  await user.type(within(modal).getByRole("combobox", { name: "Assigned to" }), "Helper{Enter}");
  await user.click(within(modal).getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull(),
  );
  expect(app.writes).toEqual([
    {
      path: "/api/objects/chores/1",
      body: {
        rescheduled_date: "2000-01-02 03:04:00",
        rescheduled_next_execution_assigned_to_user_id: "2",
      },
    },
    { path: "/api/chores/executions/calculate-next-assignments", body: { chore_id: "1" } },
  ]);
  await waitFor(() => expect(app.viewReads()).toBe(2));
  await screen.findByRole("button", { name: "Overdue chore" });
});

test("reset sends null overrides and a tracker without master-data permission receives the native write error", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ canMaster: false, stringUser: true });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await user.click(within(rowFor("Overdue chore")).getByRole("button", { name: "More" }));
  await user.click(
    within(rowFor("Overdue chore")).getByRole("menuitem", { name: "Reschedule next execution" }),
  );
  const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
  await within(modal).findByLabelText("Next estimated tracking");
  expect(within(modal).getByRole<HTMLInputElement>("combobox", { name: "Assigned to" }).value).toBe(
    "Owner",
  );
  await user.click(within(modal).getByRole("button", { name: "Reset" }));
  await screen.findByText("Error while saving, probably this item already exists");
  expect(app.writes).toEqual([
    {
      path: "/api/objects/chores/1",
      body: { rescheduled_date: null, rescheduled_next_execution_assigned_to_user_id: null },
    },
  ]);
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledWith('{"error_message":"Permission missing: MASTER_DATA_EDIT"}');
  expect(within(modal).queryByRole("alert")).toBeNull();
  expect(within(modal).queryByText("Permission missing: MASTER_DATA_EDIT")).toBeNull();
  expect(within(modal).getByLabelText<HTMLInputElement>("Next estimated tracking").disabled).toBe(
    false,
  );
  expect(within(modal).getByRole<HTMLInputElement>("combobox", { name: "Assigned to" }).value).toBe(
    "Owner",
  );
  expect(app.acceptedReschedules).toEqual([]);
  expect(app.viewReads()).toBe(1);
  await user.click(within(modal).getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(error).toHaveBeenCalledTimes(2));
  expect(app.writes).toHaveLength(2);
  expect(app.writes[1]).toEqual(app.writes[0]);
  expect(app.viewReads()).toBe(1);
});

test("reschedule opens only after a successful read and an initial HTTP failure remains silent", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldDetails: true, detailResponses: { 0: 503 } });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await chooseReschedule(user, "Overdue chore");
  await waitFor(() => expect(app.detailReads).toEqual([1]));
  expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  await act(async () => {
    app.releaseDetail(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(error).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
  await chooseReschedule(user, "Today chore");
  await waitFor(() => expect(app.detailReads).toEqual([1, 2]));
  expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  await act(async () => app.releaseDetail(1));
  const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
  expect(within(modal).getByRole("heading", { name: "Today chore" })).toBeTruthy();
  expect(within(modal).getByLabelText<HTMLInputElement>("Next estimated tracking").value).toBe(
    "2028-05-01",
  );
  expect(error).not.toHaveBeenCalled();
});

test("independent reschedule replies refill and reopen the same retained controls in completion order", async () => {
  const app = mount({ heldDetails: true, heldReschedules: true, stringUser: true });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await chooseReschedule(user, "Overdue chore");
  await chooseReschedule(user, "Today chore");
  await waitFor(() => expect(app.detailReads).toEqual([1, 2]));
  await act(async () => app.releaseDetail(1));
  const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
  const date = within(modal).getByLabelText<HTMLInputElement>("Next estimated tracking");
  const assigned = within(modal).getByRole<HTMLInputElement>("combobox", { name: "Assigned to" });
  expect(date.value).toBe("2028-05-01");
  expect(assigned.value).toBe("Helper");
  fireEvent.change(date, { target: { value: "2000-01-02" } });
  await user.click(within(modal).getByRole("button", { name: "Cancel" }));
  expect(date.isConnected).toBe(true);
  expect(date.value).toBe("2000-01-02");
  expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  await act(async () => app.releaseDetail(0));
  expect(await screen.findByRole("dialog", { name: "Reschedule next execution" })).toBe(modal);
  expect(within(modal).getByRole("heading", { name: "Overdue chore" })).toBeTruthy();
  expect(within(modal).getByLabelText("Next estimated tracking")).toBe(date);
  expect(within(modal).getByRole("combobox", { name: "Assigned to" })).toBe(assigned);
  expect(date.value).toBe("2028-04-30 10:00:00");
  expect(assigned.value).toBe("Owner");
  // Late A fills the shared form, while the last clicked B remains the live write target.
  await user.click(within(modal).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toEqual({
    path: "/api/objects/chores/2",
    body: {
      rescheduled_date: "2028-04-30 10:00:00",
      rescheduled_next_execution_assigned_to_user_id: "1",
    },
  });
  await user.click(within(modal).getByRole("button", { name: "Cancel" }));
  await chooseReschedule(user, "Overdue chore");
  await waitFor(() => expect(app.detailReads).toEqual([1, 2, 1]));
  expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  expect(date.isConnected).toBe(true);
  await act(async () => app.releaseDetail(2));
  expect(await screen.findByRole("dialog", { name: "Reschedule next execution" })).toBe(modal);
  expect(within(modal).getByLabelText("Next estimated tracking")).toBe(date);
  await act(async () => app.releaseReschedule(0));
  await waitFor(() => expect(app.viewReads()).toBe(2));
  expect(app.writes[1]).toEqual({
    path: "/api/chores/executions/calculate-next-assignments",
    body: { chore_id: "1" },
  });
});

test("reschedule permits independent editable Save and Reset while calculation failures retain accepted writes and visible values", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldReschedules: true, calculationResponses: { 0: 503, 1: 503 } });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await chooseReschedule(user, "Overdue chore");
  const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
  const date = within(modal).getByLabelText<HTMLInputElement>("Next estimated tracking");
  const assigned = within(modal).getByRole<HTMLInputElement>("combobox", { name: "Assigned to" });
  fireEvent.change(date, { target: { value: "2000-01-02 03:04:00" } });
  await user.click(within(modal).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(date.disabled).toBe(false);
  expect(date.closest("fieldset")?.disabled ?? false).toBe(false);
  expect(assigned.disabled).toBe(false);
  expect(within(modal).getByRole<HTMLButtonElement>("button", { name: "Reset" }).disabled).toBe(
    false,
  );
  expect(within(modal).getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false);
  // Reset bypasses validation and must leave this invalid visible draft untouched.
  fireEvent.change(date, { target: { value: "" } });
  await user.type(assigned, "Helper{Enter}");
  await user.click(within(modal).getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes).toEqual([
    {
      path: "/api/objects/chores/1",
      body: {
        rescheduled_date: "2000-01-02 03:04:00",
        rescheduled_next_execution_assigned_to_user_id: "",
      },
    },
    {
      path: "/api/objects/chores/1",
      body: { rescheduled_date: null, rescheduled_next_execution_assigned_to_user_id: null },
    },
  ]);

  for (const index of [0, 1]) {
    await act(async () => app.releaseReschedule(index));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(index + 1));
    expect(error).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 503, message: "Calculation request failed" }),
    );
    expect(app.acceptedReschedules).toHaveLength(index + 1);
    expect(app.viewReads()).toBe(1);
    expect(within(modal).queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
    expect(screen.queryByText(/Tracked execution of chore/)).toBeNull();
    expect(date.value).toBe("");
    expect(app.writes.at(-1)).toEqual({
      path: "/api/chores/executions/calculate-next-assignments",
      body: { chore_id: "1" },
    });
    expect(assigned.value).toBe("Helper");
  }

  fireEvent.change(date, { target: { value: "2001-02-03 04:05:00" } });
  await user.click(within(modal).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(5));
  await act(async () => app.releaseReschedule(2));
  await waitFor(() => expect(app.viewReads()).toBe(2));
  expect(app.acceptedReschedules).toHaveLength(3);
  expect(app.writes.at(-2)?.body).toEqual({
    rescheduled_date: "2001-02-03 04:05:00",
    rescheduled_next_execution_assigned_to_user_id: "2",
  });
  expect(error).toHaveBeenCalledTimes(2);
});

test("a hidden reschedule PUT continues using the live next selection before its GET reply", async () => {
  const app = mount({ heldDetails: true, heldReschedules: true });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await chooseReschedule(user, "Overdue chore");
  await waitFor(() => expect(app.detailReads).toEqual([1]));
  await act(async () => app.releaseDetail(0));
  const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
  const date = within(modal).getByLabelText<HTMLInputElement>("Next estimated tracking");
  fireEvent.change(date, { target: { value: "2000-01-02 03:04:00" } });
  await user.click(within(modal).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toEqual({
    path: "/api/objects/chores/1",
    body: {
      rescheduled_date: "2000-01-02 03:04:00",
      rescheduled_next_execution_assigned_to_user_id: "",
    },
  });
  await user.click(within(modal).getByRole("button", { name: "Cancel" }));
  expect(date.isConnected).toBe(true);
  await chooseReschedule(user, "Today chore");
  await waitFor(() => expect(app.detailReads).toEqual([1, 2]));
  expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  await act(async () => app.releaseReschedule(0));
  await waitFor(() => expect(app.viewReads()).toBe(2));
  expect(app.writes[1]).toEqual({
    path: "/api/chores/executions/calculate-next-assignments",
    body: { chore_id: "2" },
  });
  await screen.findByRole("button", { name: "Overdue chore" });
  await act(async () => {
    app.releaseDetail(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  expect(app.writes).toHaveLength(2);
});

test.each(["read", "put", "calculation"] as const)(
  "a malformed successful reschedule %s body raises globally without running the next stage",
  async (stage) => {
    vi.stubGlobal("window", jsdom.window);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const errors: ErrorEvent[] = [];

    const capture = (event: ErrorEvent) => {
      errors.push(event);
      event.preventDefault();
    };

    window.addEventListener("error", capture);
    onTestFinished(() => window.removeEventListener("error", capture));

    const app = mount({
      detailResponses: stage === "read" ? { 0: "invalid-json" } : {},
      rescheduleResponses: stage === "put" ? { 0: "invalid-json" } : {},
      calculationResponses: stage === "calculation" ? { 0: "invalid-json" } : {},
    });

    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Overdue chore" });
    await chooseReschedule(user, "Overdue chore");

    if (stage !== "read") {
      const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
      fireEvent.change(within(modal).getByLabelText("Next estimated tracking"), {
        target: { value: "2000-01-02 03:04:00" },
      });
      await user.click(within(modal).getByRole("button", { name: "OK" }));
    }

    await waitFor(() => expect(errors).toHaveLength(1));
    expect(error).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
    expect(app.viewReads()).toBe(1);
    expect(app.acceptedReschedules).toHaveLength(stage === "read" ? 0 : 1);
    expect(app.acceptedCalculations).toHaveLength(stage === "calculation" ? 1 : 0);
    expect(app.writes.map((w) => w.path)).toEqual(
      stage === "read"
        ? []
        : stage === "put"
          ? ["/api/objects/chores/1"]
          : ["/api/objects/chores/1", "/api/chores/executions/calculate-next-assignments"],
    );

    if (stage === "read") {
      expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
      await chooseReschedule(user, "Today chore");
      await screen.findByRole("dialog", { name: "Reschedule next execution" });
    } else {
      const modal = screen.getByRole("dialog", { name: "Reschedule next execution" });
      expect(within(modal).getByLabelText<HTMLInputElement>("Next estimated tracking").value).toBe(
        "2000-01-02 03:04:00",
      );
      await user.click(within(modal).getByRole("button", { name: "OK" }));
      await waitFor(() => expect(app.viewReads()).toBe(2));
      expect(app.acceptedReschedules).toHaveLength(2);
      expect(app.acceptedCalculations).toHaveLength(stage === "put" ? 1 : 2);
    }

    expect(errors).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  },
);

test.each(["detail", "execute", "reschedule", "reschedule-read"])(
  "owner departure during held %s stops later reads, writes and receipt",
  async (hold) => {
    const app = mount({ hold, heldDetails: hold === "reschedule-read" });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Overdue chore" });

    if (hold === "reschedule-read") {
      await chooseReschedule(user, "Overdue chore");
      await waitFor(() => expect(app.detailReads).toEqual([1]));
    } else if (hold === "reschedule") {
      await user.click(within(rowFor("Overdue chore")).getByRole("button", { name: "More" }));
      await user.click(
        within(rowFor("Overdue chore")).getByRole("menuitem", {
          name: "Reschedule next execution",
        }),
      );
      const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
      await within(modal).findByLabelText("Next estimated tracking");
      await user.click(within(modal).getByRole("button", { name: "Reset" }));
      await waitFor(() => expect(app.writes).toHaveLength(1));
    } else {
      await waitFor(() =>
        expect(
          within(rowFor("Overdue chore")).getByRole<HTMLButtonElement>("button", {
            name: "Track next chore schedule",
          }).disabled,
        ).toBe(false),
      );
      await user.click(
        within(rowFor("Overdue chore")).getByRole("button", { name: "Track next chore schedule" }),
      );
      await waitFor(() =>
        expect(
          hold === "detail" ? app.calls.includes("GET /api/chores/1") : app.writes.length === 1,
        ).toBe(true),
      );
    }

    await act(async () => {
      await app.router.navigate({ href: "/chores" });
    });
    await act(async () => {
      if (hold === "reschedule-read") app.releaseDetail(0);
      else app.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(app.writes).toHaveLength(hold === "detail" || hold === "reschedule-read" ? 0 : 1);
    expect(app.calls.filter((call) => call === "GET /api/chores/1")).toHaveLength(1);
    expect(screen.queryByText(/Tracked execution of chore/)).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Reschedule next execution" })).toBeNull();
  },
);

test.each(["detail", "execute", "label", "detail-abort", "detail-failure"])(
  "table reset replaces a held %s scope while its new overview reload can finish",
  async (hold) => {
    const app = mount({
      hold: hold === "detail-abort" ? "detail" : hold,
      heldReload: true,
      abortHeld: hold === "detail-abort",
      failureStage: hold === "detail-failure" ? "first-detail" : "",
    });

    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Overdue chore" });

    if (hold === "label") {
      await user.click(within(rowFor("Overdue chore")).getByRole("button", { name: "More" }));
      await user.click(
        within(rowFor("Overdue chore")).getByRole("menuitem", {
          name: "Print Chore Grocycode on label printer",
        }),
      );
    } else {
      await user.click(
        within(rowFor("Overdue chore")).getByRole("button", { name: "Track next chore schedule" }),
      );
    }

    await waitFor(() =>
      expect(
        hold === "execute"
          ? app.writes.length === 1
          : app.calls.includes(
              hold === "label" ? "GET /api/chores/1/printlabel" : "GET /api/chores/1",
            ),
      ).toBe(true),
    );

    const pendingBeforeReset = app.client
      .getMutationCache()
      .getAll()
      .filter((item) => item.state.status === "pending");

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
    await waitFor(() => expect(app.viewReads()).toBe(2));

    if (hold === "detail-failure") {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => app.releaseReload());
      await screen.findByRole("button", { name: "Overdue chore" });

      const action = within(rowFor("Overdue chore")).getByRole<HTMLButtonElement>("button", {
        name: "Track next chore schedule",
      });

      await waitFor(() => expect(action.disabled).toBe(false));
      await user.click(
        within(rowFor("Overdue chore")).getByRole("button", {
          name: "Track next chore schedule",
        }),
      );
      await waitFor(() =>
        expect(app.calls.filter((call) => call === "GET /api/chores/1")).toHaveLength(2),
      );
      expect(document.body.classList.contains("cursor-busy")).toBe(true);
      await act(async () => app.release());
      // Await the old operation's real terminal state; the new operation stays held.
      await waitFor(() =>
        expect(pendingBeforeReset.some((item) => item.state.status === "error")).toBe(true),
      );
      expect(error).not.toHaveBeenCalled();
      expect(document.body.classList.contains("cursor-busy")).toBe(true);
      expect(app.writes).toHaveLength(0);
      expect(screen.queryByText(/Tracked execution of chore/)).toBeNull();
      await act(async () => app.releaseFreshDetail());
      await screen.findByText("Tracked execution of chore Overdue chore on 2028-04-30 10:00:00");
      expect(pipelineCalls(app.calls)).toEqual([
        "GET /api/chores/1",
        "GET /api/chores/1",
        "POST /api/chores/1/execute",
        "GET /api/chores/1",
      ]);
      expect(app.acceptedExecutions).toHaveLength(1);
      expect(error).not.toHaveBeenCalled();
      expect(document.body.classList.contains("cursor-busy")).toBe(false);

      return;
    }

    await act(async () => {
      app.release();
    });
    expect(app.writes).toHaveLength(hold === "execute" ? 1 : 0);
    expect(app.calls.filter((call) => call === "GET /api/chores/1")).toHaveLength(
      hold === "label" ? 0 : 1,
    );
    expect(app.calls.includes("POST /print")).toBe(false);
    expect(screen.queryByText(/Tracked execution of chore|Label request sent/)).toBeNull();
    expect(screen.queryByText("Cancelled old chore detail")).toBeNull();

    await act(async () => {
      app.releaseReload();
    });
    await screen.findByRole("button", { name: "Overdue chore" });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Table options" }).closest("fieldset")
          ?.disabled,
      ).toBe(false),
    );
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
  },
);

test("overlapping completion statistics apply every response in native arrival order", async () => {
  const app = mount({ heldStatistics: true });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Overdue chore" });
  await screen.findByText("1 chore is due to be done today");
  await user.click(
    within(rowFor("Overdue chore")).getByRole("button", { name: "Track next chore schedule" }),
  );
  await waitFor(() => expect(app.statisticsReplies).toHaveLength(1));
  await user.click(
    within(rowFor("Soon chore")).getByRole("button", { name: "Track next chore schedule" }),
  );
  await waitFor(() => expect(app.statisticsReplies).toHaveLength(2));
  await act(async () => app.statisticsReplies[1]!());
  await screen.findByText("3 chores are due to be done today");
  await act(async () => app.statisticsReplies[0]!());
  await screen.findByText("2 chores are due to be done today");
});

test("overview restores native saved columns and sort, and keeps zero-days and disabled assignment controls hidden", async () => {
  const savedLayout = JSON.stringify({
    time: 1,
    order: [[1, "desc"]],
    columns: Array.from({ length: 8 }, (_, index) => ({ visible: index !== 3 })),
    ColReorder: [0, 1, 2, 3, 4, 5, 6, 7],
  });

  mount({ savedLayout, dueDays: 0, assignments: false, canTrack: false });
  await screen.findByRole("button", { name: "Soon chore" });
  expect(screen.queryByRole("combobox", { name: "Assignment" })).toBeNull();
  expect(screen.queryByRole("option", { name: "Due soon" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Last tracked" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "Chore" }).getAttribute("aria-sort")).toBe(
    "descending",
  );
  expect(
    within(rowFor("Soon chore")).getByRole<HTMLButtonElement>("button", {
      name: "Track next chore schedule",
    }).disabled,
  ).toBe(true);
});

test("card preserves rich description, date-only last tracking and embedded journal navigation", async () => {
  const app = mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Today chore" }));
  const card = await screen.findByRole("dialog", { name: "Chore overview" });
  const description = await within(card).findByText("Rich description");
  expect(description.tagName).toBe("STRONG");
  expect(within(card).getByText("1234")).toBeTruthy();
  expect(within(card).getByText("2028-04-29")).toBeTruthy();
  expect(within(card).getByRole("link", { name: "Edit chore" }).getAttribute("href")).toBe(
    "/chore/2",
  );
  await user.click(within(card).getByRole("link", { name: "Chore journal" }));
  const frame = screen.getByTitle<HTMLIFrameElement>("Chores journal");
  expect(new URL(frame.src).searchParams.get("chore")).toBe("2");
  expect(new URL(frame.src).searchParams.has("embedded")).toBe(true);
  expect(app.router.state.location.pathname).toBe("/choresoverview");
});

test("native card callbacks retain last completion across hidden and replaced selections", async () => {
  const app = mount({ heldCards: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Today chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2]));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Overdue chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2, 1]));
  await act(async () => {
    app.releaseCard(1);
  });
  await within(screen.getByRole("dialog", { name: "Chore overview" })).findByRole("heading", {
    name: "Overdue chore",
  });
  await user.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => {
    app.releaseCard(0);
  });
  await user.click(screen.getByRole("button", { name: "Soon chore" }));
  const modal = screen.getByRole("dialog", { name: "Chore overview" });
  expect(within(modal).getByRole("heading", { name: "Today chore" })).toBeTruthy();
  expect(within(modal).getByRole("link", { name: "Edit chore" }).getAttribute("href")).toBe(
    "/chore/2",
  );
  await waitFor(() => expect(app.cardReads).toEqual([2, 1, 3]));
  await act(async () => {
    app.releaseCard(2);
  });
  await within(modal).findByRole("heading", { name: "Soon chore" });
  await user.click(within(modal).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Soon chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2, 1, 3, 3]));
  await act(async () => {
    app.releaseCard(3);
  });
  await within(screen.getByRole("dialog", { name: "Chore overview" })).findByRole("heading", {
    name: "Soon chore",
  });
});

test("a failed replacement Card read logs quietly and retains its accepted display until explicit recovery", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldCards: true, cardResponses: { 1: 400 } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Today chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2]));
  await act(async () => app.releaseCard(0));
  let modal = screen.getByRole("dialog", { name: "Chore overview" });
  await within(modal).findByRole("heading", { name: "Today chore" });
  await user.click(within(modal).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Overdue chore" }));
  modal = screen.getByRole("dialog", { name: "Chore overview" });
  await waitFor(() => expect(app.cardReads).toEqual([2, 1]));
  const accepted = within(modal).getByRole("heading", { name: "Today chore" });
  const edit = within(modal).getByRole("link", { name: "Edit chore" });
  const journal = within(modal).getByRole<HTMLAnchorElement>("link", { name: "Chore journal" });
  const facts = modal.querySelector("dl")!.textContent;
  await act(async () => app.releaseCard(1));
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ status: 400, message: "Chore does not exist" }),
  );
  expect(screen.getByRole("dialog", { name: "Chore overview" })).toBe(modal);
  expect(within(modal).getByRole("heading", { name: "Today chore" })).toBe(accepted);
  expect(within(modal).getByRole("link", { name: "Edit chore" })).toBe(edit);
  expect(edit.getAttribute("href")).toBe("/chore/2");
  expect(within(modal).getByRole("link", { name: "Chore journal" })).toBe(journal);
  expect(new URL(journal.href).searchParams.get("chore")).toBe("2");
  expect(modal.querySelector("dl")!.textContent).toBe(facts);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(app.writes).toEqual([]);
  await user.click(within(modal).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Overdue chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2, 1, 1]));
  await act(async () => app.releaseCard(2));
  await within(screen.getByRole("dialog", { name: "Chore overview" })).findByRole("heading", {
    name: "Overdue chore",
  });
  expect(screen.getByRole("link", { name: "Edit chore" }).getAttribute("href")).toBe("/chore/1");
  expect(error).toHaveBeenCalledTimes(1);
});

test("a first failed Card read retains blank named fields and disabled actions without a loading trap", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldCards: true, cardResponses: { 0: 503 } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Today chore" }));
  const modal = screen.getByRole("dialog", { name: "Chore overview" });
  await waitFor(() => expect(app.cardReads).toEqual([2]));
  await act(async () => app.releaseCard(0));
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ status: 503, message: "Card request failed" }),
  );
  expect(modal.querySelector("h3")?.textContent).toBe("");
  const captions = [...modal.querySelectorAll("dt")].map((node) => node.textContent);
  expect(captions).toEqual([
    "Tracked count",
    "Average execution frequency",
    "Last tracked",
    "Last done by",
  ]);
  expect([...modal.querySelectorAll("dd")].map((node) => node.textContent)).toEqual([
    "",
    "",
    "",
    "",
  ]);

  for (const name of ["Edit chore", "Chore journal"]) {
    const link = within(modal).getByRole("link", { name });
    expect(link.getAttribute("href")).toBe("#");
    expect(link.getAttribute("aria-disabled")).toBe("true");
  }

  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(within(modal).queryByText(/Loading/)).toBeNull();
  expect(within(modal).queryByText("Unknown")).toBeNull();
  expect(within(modal).queryByText("never")).toBeNull();
  expect(app.router.state.location.pathname).toBe("/choresoverview");
  expect(app.writes).toEqual([]);
  await user.click(within(modal).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Soon chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2, 3]));
  await act(async () => app.releaseCard(1));
  await within(screen.getByRole("dialog", { name: "Chore overview" })).findByRole("heading", {
    name: "Soon chore",
  });
  expect(error).toHaveBeenCalledTimes(1);
});

test("a successful malformed Card body raises a browser error while retaining the accepted display", async () => {
  vi.stubGlobal("window", jsdom.window);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const callbackErrors: ErrorEvent[] = [];

  const capture = (event: ErrorEvent) => {
    callbackErrors.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", capture);
  onTestFinished(() => window.removeEventListener("error", capture));
  const app = mount({ heldCards: true, cardResponses: { 1: "invalid-json" } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Today chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2]));
  await act(async () => app.releaseCard(0));
  let modal = screen.getByRole("dialog", { name: "Chore overview" });
  await within(modal).findByRole("heading", { name: "Today chore" });
  await user.click(within(modal).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Overdue chore" }));
  modal = screen.getByRole("dialog", { name: "Chore overview" });
  await waitFor(() => expect(app.cardReads).toEqual([2, 1]));
  await act(async () => app.releaseCard(1));
  await waitFor(() => expect(callbackErrors).toHaveLength(1));
  expect(error).not.toHaveBeenCalled();
  expect(within(modal).getByRole("heading", { name: "Today chore" })).toBeTruthy();
  expect(within(modal).getByRole("link", { name: "Edit chore" }).getAttribute("href")).toBe(
    "/chore/2",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await user.click(within(modal).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Overdue chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2, 1, 1]));
  await act(async () => app.releaseCard(2));
  await within(screen.getByRole("dialog", { name: "Chore overview" })).findByRole("heading", {
    name: "Overdue chore",
  });
  expect(callbackErrors).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
});

test("table reset retires a held failed Card read without logging or replacing its new accepted Card", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldCards: true, cardResponses: { 0: 503 } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Today chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2]));
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
  await waitFor(() => expect(app.viewReads()).toBe(2));
  await user.click(await screen.findByRole("button", { name: "Overdue chore" }));
  await waitFor(() => expect(app.cardReads).toEqual([2, 1]));
  await act(async () => app.releaseCard(1));
  const modal = screen.getByRole("dialog", { name: "Chore overview" });
  await within(modal).findByRole("heading", { name: "Overdue chore" });
  await act(async () => {
    app.releaseCard(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(error).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Chore overview" })).toBe(modal);
  expect(within(modal).getByRole("heading", { name: "Overdue chore" })).toBeTruthy();
  expect(within(modal).getByRole("link", { name: "Edit chore" }).getAttribute("href")).toBe(
    "/chore/1",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(app.writes).toEqual([]);
});

test("statistics and untouched relative cells stay cached until a native statistics refresh", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("1 chore is due to be done today");
  await screen.findByRole("button", { name: "Today chore" });
  vi.setSystemTime(new Date(2028, 4, 10, 10));
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Today chore");
  expect(screen.getByText("1 chore is due to be done today")).toBeTruthy();
  expect(within(rowFor("Today chore")).getByText("Today")).toBeTruthy();
});

test("date-only reschedule keeps native string user prefill and sends a date without imposing a future limit", async () => {
  const app = mount({ stringUser: true });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Today chore" });
  await user.click(within(rowFor("Today chore")).getByRole("button", { name: "More" }));
  await user.click(
    within(rowFor("Today chore")).getByRole("menuitem", { name: "Reschedule next execution" }),
  );
  const modal = await screen.findByRole("dialog", { name: "Reschedule next execution" });
  const date = await within(modal).findByLabelText<HTMLInputElement>("Next estimated tracking");
  expect(date.type).toBe("text");
  expect(date.classList.contains("date-only-datetimepicker")).toBe(true);
  expect(within(modal).getByRole<HTMLInputElement>("combobox", { name: "Assigned to" }).value).toBe(
    "Helper",
  );
  fireEvent.change(date, { target: { value: "2000-01-02" } });
  await user.click(within(modal).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes[1]).toEqual({
    path: "/api/chores/executions/calculate-next-assignments",
    body: { chore_id: "2" },
  });
  expect(app.writes[0]?.body).toEqual({
    rescheduled_date: "2000-01-02",
    rescheduled_next_execution_assigned_to_user_id: "2",
  });
});

test.each([false, true])(
  "held label response starts a webhook only while its page owner remains (depart=%s)",
  async (depart) => {
    const app = mount({ hold: "label" });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Overdue chore" });
    await user.click(within(rowFor("Overdue chore")).getByRole("button", { name: "More" }));
    await user.click(
      within(rowFor("Overdue chore")).getByRole("menuitem", {
        name: "Print Chore Grocycode on label printer",
      }),
    );
    await waitFor(() => expect(app.calls.includes("GET /api/chores/1/printlabel")).toBe(true));

    if (depart)
      await act(async () => {
        await app.router.navigate({ href: "/chores" });
      });
    await act(async () => {
      app.release();
      await Promise.resolve();
    });

    if (depart) {
      expect(app.calls.includes("POST /print")).toBe(false);
      expect(screen.queryByText("Label request sent")).toBeNull();
    } else {
      await waitFor(() => expect(app.calls.includes("POST /print")).toBe(true));
      await screen.findByText("Label request sent");
    }
  },
);
