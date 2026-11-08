import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { queryKeys } from "@/lib/api";
import type { UserSettings } from "@/lib/types";
import { mountNativeEditor } from "./fixtures/native-editor";

type Write = {
  key: string;
  value: UserSettings[string];
  local: UserSettings;
  theme: string | undefined;
  release: (status?: number) => void;
};

function mountView({
  settings = {},
  hold = [],
  config = {},
  path = "/tasks",
}: {
  settings?: UserSettings;
  hold?: string[];
  config?: Record<string, string | boolean>;
  path?: string;
} = {}) {
  const saved: UserSettings = {
    night_mode: "off",
    night_mode_enabled_internal: false,
    auto_night_mode_enabled: false,
    auto_night_mode_time_range_from: "09:00",
    auto_night_mode_time_range_to: "18:00",
    auto_night_mode_time_range_goes_over_midnight: false,
    auto_reload_on_db_change: false,
    show_clock_in_header: false,
    keep_screen_on: false,
    keep_screen_on_when_fullscreen_card: false,
    ...settings,
  };

  const writes: Write[] = [];
  const bulkWrites: UserSettings[] = [];
  const request = vi.fn(async () => ({ released: false, release: vi.fn(async () => {}) }));
  const originalWake = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
  const originalActivation = Object.getOwnPropertyDescriptor(navigator, "userActivation");
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { hasBeenActive: false },
  });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  onTestFinished(() => {
    if (originalWake) Object.defineProperty(navigator, "wakeLock", originalWake);
    else Reflect.deleteProperty(navigator, "wakeLock");

    if (originalActivation) Object.defineProperty(navigator, "userActivation", originalActivation);
    else Reflect.deleteProperty(navigator, "userActivation");
    vi.useRealTimers();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  const app = mountNativeEditor(
    path,
    (url, options) => {
      if (url === "/api/user/settings") return Response.json({ ...saved });

      if (url === "/api/system/info") return Response.json({ grocy_version: { Version: "test" } });

      if (url === "/api/v2/user/settings" && options?.method === "PUT") {
        const body: UserSettings = JSON.parse(String(options.body));
        bulkWrites.push(body);
        Object.assign(saved, body);

        return Response.json(body);
      }

      if (url === "/api/v2/tasks/overview")
        return Response.json({ rows: [], categories: [], next_days: 5, include_done: false });

      if (url === "/api/system/db-changed-time")
        return Response.json({ changed_time: "2026-01-01 12:00:00" });

      if (url.startsWith("/api/user/settings/") && options?.method === "PUT") {
        const key = decodeURIComponent(url.slice("/api/user/settings/".length));
        const value: UserSettings[string] = JSON.parse(String(options.body)).value;
        let release!: Write["release"];

        const reply = new Promise<Response>((resolve) => {
          release = (status = 204) => {
            if (status < 300) saved[key] = value;
            resolve(
              status === 204
                ? new Response(null, { status })
                : Response.json({ error_message: "Preference denied" }, { status }),
            );
          };
        });

        writes.push({
          key,
          value,
          local: { ...app.client.getQueryData<UserSettings>(queryKeys.userSettings) },
          theme: document.documentElement.dataset.theme,
          release,
        });

        if (!hold.includes(key)) release();

        return reply;
      }

      return undefined;
    },
    { MODE: "production", DISABLE_AUTH: false, ...config },
    {},
    { browserSession: true },
  );

  return {
    ...app,
    // Native Tasks independently saves its table layout during initialization.
    allWrites: writes,
    get writes() {
      return writes.filter(({ key }) => !key.startsWith("datatables_state_"));
    },
    bulkWrites,
    saved,
    request,
  };
}

async function openView() {
  const trigger = await screen.findByRole("button", { name: "View settings" });
  await userEvent.setup().click(trigger);

  return { trigger, region: screen.getByRole("region", { name: "View settings" }) };
}

test("global controls autosave independently before held requests and keep quiet failed choices locally", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mountView({
    settings: { keep_screen_on: true, keep_screen_on_when_fullscreen_card: true },
    hold: ["show_clock_in_header", "auto_reload_on_db_change"],
  });

  const { region } = await openView();
  const user = userEvent.setup();

  const clock = within(region).getByRole<HTMLInputElement>("checkbox", {
    name: "Show clock in header",
  });

  expect(
    within(region).getByRole<HTMLInputElement>("checkbox", { name: "Keep screen on" }).checked,
  ).toBe(false);
  expect(
    within(region).getByRole<HTMLInputElement>("checkbox", {
      name: 'Keep screen on while displaying a "fullscreen-card"',
    }).checked,
  ).toBe(false);
  expect(within(region).getByLabelText<HTMLInputElement>("From").readOnly).toBe(true);
  expect(within(region).getByLabelText<HTMLInputElement>("To").readOnly).toBe(true);
  expect(within(region).getByRole("radio", { name: "Off" })).toBeTruthy();
  expect(within(region).getByRole("radio", { name: "On" })).toBeTruthy();
  expect(within(region).getByRole("radio", { name: "Use system setting" })).toBeTruthy();
  await user.click(within(region).getByRole("checkbox", { name: "Keep screen on" }));
  await user.click(
    within(region).getByRole("checkbox", {
      name: 'Keep screen on while displaying a "fullscreen-card"',
    }),
  );
  expect(app.writes).toEqual([]);
  await user.click(clock);
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toMatchObject({
    key: "show_clock_in_header",
    value: true,
    local: { show_clock_in_header: true },
  });
  await waitFor(() => expect(document.querySelector("time.header-clock[datetime]")).not.toBeNull());
  expect(app.saved.show_clock_in_header).toBe(false);
  expect(clock.disabled).toBe(false);
  await user.click(
    within(region).getByRole("checkbox", { name: "Auto reload on external changes" }),
  );
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes[1]).toMatchObject({
    key: "auto_reload_on_db_change",
    value: true,
    local: { auto_reload_on_db_change: true },
  });
  expect(Array.from(region.querySelectorAll("input")).every((input) => input.form === null)).toBe(
    true,
  );
  expect(document.querySelector("form.is-dirty")).toBeNull();
  await act(async () => app.writes[0]!.release(503));
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(clock.checked).toBe(true);
  expect(document.querySelector("time.header-clock[datetime]")).not.toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await user.click(within(region).getByRole("checkbox", { name: "Time range goes over midnight" }));
  expect(app.writes.at(-1)).toMatchObject({
    key: "auto_night_mode_time_range_goes_over_midnight",
    value: true,
  });
  await act(async () => app.writes[1]!.release());
  expect(app.router.state.location.pathname).toBe("/tasks");
});

test("night radio saves the selected mode before its changed internal flag without a duplicate generic write", async () => {
  const app = mountView({ hold: ["night_mode"] });
  const { region } = await openView();
  const user = userEvent.setup();
  const on = within(region).getByRole("radio", { name: "On" });
  await user.click(on);
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes.map(({ key, value }) => ({ key, value }))).toEqual([
    { key: "night_mode", value: "on" },
    { key: "night_mode_enabled_internal", value: true },
  ]);
  expect(app.writes[0]!.local.night_mode).toBe("on");
  expect(app.writes[1]!.theme).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(on);
  expect(app.writes).toHaveLength(2);
  await act(async () => app.writes[0]!.release());
  await user.click(within(region).getByRole("radio", { name: "Use system setting" }));
  expect(app.writes.slice(2).map(({ key, value }) => ({ key, value }))).toEqual([
    { key: "night_mode", value: "follow-system" },
    { key: "night_mode_enabled_internal", value: false },
  ]);
  expect(document.documentElement.dataset.theme).toBe("light");
  await act(async () => app.writes[2]!.release());
  await user.click(within(region).getByRole("radio", { name: "Off" }));
  expect(app.writes.at(-1)).toMatchObject({ key: "night_mode", value: "off" });
  expect(app.writes).toHaveLength(5);
  await act(async () => app.writes[4]!.release());
});

test("auto range waits for its timer, and invalid raw From and To retain distinct source outcomes", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2030, 4, 6, 12, 0, 0));
  const app = mountView();
  const { region, trigger } = await openView();
  const user = userEvent.setup();

  const auto = within(region).getByRole<HTMLInputElement>("checkbox", {
    name: "Auto enable in time range",
  });

  const from = within(region).getByLabelText<HTMLInputElement>("From");
  const to = within(region).getByLabelText<HTMLInputElement>("To");
  await user.click(auto);
  expect(from.readOnly).toBe(false);
  expect(to.readOnly).toBe(false);
  expect(within(region).getByRole<HTMLInputElement>("radio", { name: "Off" }).checked).toBe(true);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(app.writes.map(({ key }) => key)).toEqual(["auto_night_mode_enabled"]);
  const tableWrites = app.allWrites.filter(({ key }) => key.startsWith("datatables_state_")).length;
  await user.click(within(screen.getByRole("columnheader", { name: "Task" })).getByRole("button"));
  await waitFor(() =>
    expect(
      app.allWrites.filter(({ key }) => key.startsWith("datatables_state_")).length,
    ).toBeGreaterThan(tableWrites),
  );
  // An unrelated real table-preference update must not consume the deferred night check.
  expect(document.documentElement.dataset.theme).toBe("light");
  await user.click(trigger);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(auto);
  expect(from.readOnly).toBe(true);
  expect(document.documentElement.dataset.theme).toBe("dark");
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(document.documentElement.dataset.theme).toBe("light");
  await user.click(auto);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(document.documentElement.dataset.theme).toBe("dark");
  const count = app.writes.length;
  await user.clear(from);
  await user.type(from, "not-time");
  expect(from.type).toBe("text");
  expect(from.checkValidity()).toBe(true);
  expect(from.getAttribute("aria-invalid")).toBe("true");
  expect(app.writes).toHaveLength(count);
  await user.click(to);
  expect(app.writes.at(-1)).toMatchObject({
    key: "auto_night_mode_time_range_from",
    value: "not-time",
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(from);
  await user.keyboard("{End}");
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.clear(from);
  await user.type(from, "09:00");
  await user.click(to);
  await user.clear(to);
  await user.type(to, "invalid-end");
  expect(to.checkValidity()).toBe(true);
  expect(to.getAttribute("aria-invalid")).toBe("true");
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(from);
  expect(app.writes.at(-1)).toMatchObject({
    key: "auto_night_mode_time_range_to",
    value: "invalid-end",
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(to);
  await user.keyboard("{End}");
  expect(document.documentElement.dataset.theme).toBe("light");
});

test("the first keep-screen-on checkbox gesture requests a wake lock without a second interaction", async () => {
  const app = mountView();
  const { region } = await openView();
  expect(app.request).not.toHaveBeenCalled();
  await userEvent.setup().click(within(region).getByRole("checkbox", { name: "Keep screen on" }));
  expect(app.request).toHaveBeenCalledWith("screen");
  expect(app.request).toHaveBeenCalledTimes(1);
  expect(app.writes.map(({ key, value }) => ({ key, value }))).toEqual([
    { key: "keep_screen_on", value: true },
  ]);
  await userEvent.setup().click(
    within(region).getByRole("checkbox", {
      name: 'Keep screen on while displaying a "fullscreen-card"',
    }),
  );
  expect(app.writes.at(-1)).toMatchObject({
    key: "keep_screen_on_when_fullscreen_card",
    value: true,
  });
});

test("View disclosure preserves internal edits and supports Escape, outside and Tab-away dismissal", async () => {
  mountView();
  const trigger = await screen.findByRole("button", { name: "View settings" });
  const user = userEvent.setup();
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  const region = screen.getByRole("region", { name: "View settings" });
  expect(document.activeElement).toBe(
    within(region).getByRole("checkbox", { name: "Auto reload on external changes" }),
  );
  await user.click(within(region).getByRole("checkbox", { name: "Show clock in header" }));
  expect(screen.getByRole("region", { name: "View settings" })).toBe(region);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "View settings" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await user.click(trigger);
  await user.click(screen.getByRole("heading", { name: "Tasks" }));
  expect(screen.queryByRole("region", { name: "View settings" })).toBeNull();
  trigger.focus();
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(
    screen.getByRole("checkbox", { name: 'Keep screen on while displaying a "fullscreen-card"' }),
  );
  await user.tab();
  expect(screen.queryByRole("region", { name: "View settings" })).toBeNull();
  expect(document.activeElement).not.toBe(trigger);
});

test.each([
  {
    label: "auth-disabled",
    config: { DISABLE_AUTH: true },
    path: "/tasks",
    visible: true,
    settings: { night_mode: "on", night_mode_enabled_internal: false },
  },
  {
    label: "embedded",
    config: { DISABLE_AUTH: false },
    path: "/tasks?embedded",
    visible: false,
    settings: { night_mode: "off", night_mode_enabled_internal: false },
  },
])(
  "View settings stays available for $label according to the shell boundary",
  async ({ config, path, visible, settings }) => {
    const app = mountView({ config, path, settings });
    await screen.findByRole("heading", { name: "Tasks" });

    if (visible) {
      expect(screen.getByRole("button", { name: "View settings" })).toBeTruthy();
      await waitFor(() =>
        expect(app.writes.map(({ key, value }) => ({ key, value }))).toEqual([
          { key: "night_mode_enabled_internal", value: true },
        ]),
      );
      expect(app.bulkWrites).toEqual([]);
      expect(document.documentElement.dataset.theme).toBe("dark");
    } else expect(screen.queryByRole("button", { name: "View settings" })).toBeNull();
  },
);

test("modern Appearance Save refreshes the mounted global controls and clean times without navigation", async () => {
  const app = mountView({ path: "/settings?tab=appearance" });
  const user = userEvent.setup();
  const mode = await screen.findByRole("combobox", { name: "Night mode" });
  await user.selectOptions(mode, "on");
  await user.click(screen.getByRole("checkbox", { name: "Show clock in header" }));
  await user.click(screen.getByRole("checkbox", { name: "Auto enable in time range" }));
  const form = mode.closest("form")!;
  const from = within(form).getByLabelText("From");
  const to = within(form).getByLabelText("To");
  await user.clear(from);
  await user.type(from, "20:30");
  await user.clear(to);
  await user.type(to, "19:45");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Preferences saved.");
  expect(app.bulkWrites).toContainEqual({
    night_mode: "on",
    show_clock_in_header: true,
    auto_night_mode_enabled: true,
    auto_night_mode_time_range_from: "20:30",
    auto_night_mode_time_range_to: "19:45",
  });
  const { region } = await openView();
  expect(within(region).getByRole<HTMLInputElement>("radio", { name: "On" }).checked).toBe(true);
  expect(
    within(region).getByRole<HTMLInputElement>("checkbox", { name: "Show clock in header" })
      .checked,
  ).toBe(true);
  expect(
    within(region).getByRole<HTMLInputElement>("checkbox", { name: "Auto enable in time range" })
      .checked,
  ).toBe(true);
  expect(within(region).getByLabelText<HTMLInputElement>("From").value).toBe("20:30");
  expect(within(region).getByLabelText<HTMLInputElement>("From").readOnly).toBe(false);
  expect(within(region).getByLabelText<HTMLInputElement>("To").value).toBe("19:45");
  expect(app.router.state.location.pathname).toBe("/settings");
});

test("a fresh native document checks an enabled range immediately after the prior document deferred it", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2030, 4, 6, 12, 0, 0));
  const app = mountView();
  const { region } = await openView();
  const user = userEvent.setup();
  await user.click(within(region).getByRole("checkbox", { name: "Auto enable in time range" }));
  await waitFor(() => expect(app.saved.auto_night_mode_enabled).toBe(true));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(app.writes.map(({ key }) => key)).toEqual(["auto_night_mode_enabled"]);
  // No clock tick: entering a different native document runs its startup check.
  await user.click(screen.getByRole("link", { name: "Equipment" }));
  await screen.findByRole("heading", { name: "Equipment", level: 1 });
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  expect(
    app.writes.filter(({ key }) => key === "night_mode_enabled_internal").map(({ value }) => value),
  ).toEqual([true]);
  expect(app.router.state.location.pathname).toBe("/equipment");
});
