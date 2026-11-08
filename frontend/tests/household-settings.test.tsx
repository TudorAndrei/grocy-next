import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { UserSettings } from "@/lib/types";

type Kind = "chores" | "batteries" | "tasks";

const titles = {
  chores: "Chores settings",
  batteries: "Batteries settings",
  tasks: "Tasks settings",
};

function mount(
  kind: Kind,
  {
    values = {},
    enabled = true,
    fail = false,
    holdWrites = false,
    startAt,
    productionCache = false,
  }: {
    values?: UserSettings;
    enabled?: boolean;
    fail?: boolean;
    holdWrites?: boolean;
    startAt?: string;
    productionCache?: boolean;
  } = {},
) {
  const settings: UserSettings = {
    chores_due_soon_days: 5,
    batteries_due_soon_days: 5,
    tasks_due_soon_days: 5,
    chores_overview_swap_tracking_buttons: false,
    ...values,
  };

  const writes: Array<{ key: string; value: UserSettings[string] }> = [];
  const pendingWrites: Array<{ signal: AbortSignal | undefined; release: () => void }> = [];
  let settingsReads = 0;
  let releaseSettings = () => {};
  let heldSettings: Promise<void> | undefined;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (path === "/api/user") return Response.json([{ id: 1, username: "owner" }]);

      if (path === "/api/v2/user/permissions") return Response.json({});

      if (path === "/api/system/config")
        return Response.json({ [`FEATURE_FLAG_${kind.toUpperCase()}`]: enabled });

      if (path === "/api/user/settings") {
        settingsReads += 1;
        const snapshot = { ...settings };

        if (heldSettings) await heldSettings;

        return Response.json(snapshot);
      }

      if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
        return Response.json([]);

      if (path === "/api/v2/chores/overview")
        return Response.json({
          rows: [
            {
              chore_id: 1,
              name: "Water plants",
              period_type: "daily",
              track_date_only: 0,
              last_tracked_time: null,
              next_estimated_execution_time: "2099-01-04 08:00:00",
              next_execution_assigned_to_user_id: null,
              is_rescheduled: 0,
              is_reassigned: 0,
              due_type: "duesoon",
              custom_values: {},
            },
          ],
          users: [],
          next_x_days: Number(settings.chores_due_soon_days),
          current_user_id: 1,
        });

      if (path === "/api/v2/batteries/overview")
        return Response.json({ rows: [], next_x_days: Number(settings.batteries_due_soon_days) });

      if (path.startsWith("/api/user/settings/") && init?.method === "PUT") {
        const key = decodeURIComponent(path.slice("/api/user/settings/".length));
        const value = JSON.parse(String(init.body)).value;
        writes.push({ key, value });

        // The fixture commits accepted writes before optionally holding their HTTP replies.
        if (!fail) settings[key] = value;

        if (holdWrites)
          await new Promise<void>((release) => {
            pendingWrites.push({ signal: init.signal ?? undefined, release });
          });

        if (fail) return Response.json({ error_message: "Setting save failed" }, { status: 503 });

        return new Response(null, { status: 204 });
      }

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (path === "/api/v2/tasks/overview")
        return Response.json({
          rows: [],
          categories: [],
          next_days: String(settings.tasks_due_soon_days),
          include_done: false,
        });

      return Response.json([]);
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: productionCache ? 30_000 : 0 } },
  });

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [startAt ?? `/${kind}settings`] }),
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
    settings,
    writes,
    router,
    client,
    pendingWrites,
    settingsReads: () => settingsReads,
    holdSettings: () => {
      heldSettings = new Promise<void>((resolve) => {
        releaseSettings = resolve;
      });

      return () => releaseSettings();
    },
  };
}

test("native settings entry waits for the fresh held read instead of latching warm cached days", async () => {
  const app = mount("tasks", { startAt: "/barcodescannertesting", productionCache: true });
  await screen.findByRole("heading", { name: "Barcode scanner testing" });
  await waitFor(() =>
    expect(app.client.getQueryData<UserSettings>(["user", "settings"])?.tasks_due_soon_days).toBe(
      5,
    ),
  );
  app.settings.tasks_due_soon_days = 9;
  const release = app.holdSettings();
  await act(() => app.router.navigate({ to: "/taskssettings" }));
  expect(screen.queryByRole("spinbutton", { name: "Due soon days" })).toBeNull();
  await act(async () => release());
  expect(
    (await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" })).value,
  ).toBe("9");
  expect(app.writes).toEqual([]);
});

test.each(["chores", "batteries", "tasks"] as const)(
  "native %s settings show the canonical default and overview destination",
  async (kind) => {
    mount(kind);
    await screen.findByRole("heading", { name: titles[kind], level: 1 });
    expect(
      (await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" })).value,
    ).toBe("5");
    expect(screen.getByRole("link", { name: "OK" }).getAttribute("href")).toBe(
      kind === "tasks" ? "/tasks" : `/${kind}overview`,
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
  },
);

test.each(["chores", "batteries", "tasks"] as const)(
  "%s settings save committed valid changes with the native key spelling and skip invalid or unchanged values",
  async (kind) => {
    const app = mount(kind);
    const user = userEvent.setup();
    const days = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" });
    await user.click(days);
    await user.tab();
    expect(app.writes).toEqual([]);
    await user.clear(days);
    await user.type(days, "8");
    expect(app.writes).toEqual([]);
    await user.tab();
    const key = kind === "tasks" ? "tasks_due_soon_days" : ` ${kind}_due_soon_days`;
    await waitFor(() => expect(app.writes).toEqual([{ key, value: "8" }]));
    expect(app.settings[key]).toBe("8");
    expect(app.settings[`${kind}_due_soon_days`]).toBe(kind === "tasks" ? "8" : 5);

    for (const invalid of ["-1", "0.5", ""]) {
      await user.clear(days);

      if (invalid) await user.type(days, invalid);
      await user.tab();
      expect(days.checkValidity()).toBe(false);
      expect(app.writes).toHaveLength(1);
    }

    await user.type(days, "8");
    await user.tab();
    expect(app.writes).toHaveLength(1);
  },
);

test("settings number controls change by one and retain an invalid draft without saving it", async () => {
  const app = mount("tasks", { values: { tasks_due_soon_days: 0 } });
  const user = userEvent.setup();
  const days = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" });
  await user.click(screen.getByRole("button", { name: "Decrease Due soon days" }));
  expect(days.value).toBe("-1");
  expect(app.writes).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Increase Due soon days" }));
  expect(days.value).toBe("0");
  expect(app.writes).toEqual([]);
  await user.click(days);
  await user.keyboard("{ArrowUp}");
  await waitFor(() => expect(app.settings.tasks_due_soon_days).toBe("1"));
  await user.keyboard("{ArrowDown}");
  await waitFor(() => expect(app.settings.tasks_due_soon_days).toBe("0"));
  expect(app.writes).toEqual([
    { key: "tasks_due_soon_days", value: "1" },
    { key: "tasks_due_soon_days", value: "0" },
  ]);
});

test.each([
  { value: "ON", checked: true },
  { value: "false", checked: false },
])(
  "chore checkbox reads native BoolVal $value and persists a boolean",
  async ({ value, checked }) => {
    const app = mount("chores", { values: { chores_overview_swap_tracking_buttons: value } });
    const user = userEvent.setup();

    const checkbox = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: "Swap track next schedule / track now buttons",
    });

    expect(checkbox.checked).toBe(checked);
    await user.click(checkbox);
    await waitFor(() => expect(app.settings.chores_overview_swap_tracking_buttons).toBe(!checked));
    expect(app.writes).toEqual([{ key: "chores_overview_swap_tracking_buttons", value: !checked }]);
  },
);

test("a failed settings write logs quietly and retains the local choice without claiming persistence or retrying it", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("tasks", { fail: true, holdWrites: true });
  const user = userEvent.setup();
  const days = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" });
  await user.clear(days);
  await user.type(days, "8");
  await user.tab();
  await waitFor(() => expect(app.pendingWrites).toHaveLength(1));

  const localBeforeReply = app.client.getQueryData<UserSettings>([
    "user",
    "settings",
  ])?.tasks_due_soon_days;

  expect(error).not.toHaveBeenCalled();
  await act(async () => app.pendingWrites[0]!.release());
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(error.mock.calls[0]?.[0]).toMatchObject({ message: "Setting save failed" });
  expect(localBeforeReply).toBe("8");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(days.value).toBe("8");
  expect(app.settings.tasks_due_soon_days).toBe(5);
  await user.click(days);
  await user.tab();
  expect(app.writes).toEqual([{ key: "tasks_due_soon_days", value: "8" }]);
  expect(app.client.getQueryData<UserSettings>(["user", "settings"])?.tasks_due_soon_days).toBe(
    "8",
  );
  await user.clear(days);
  await user.type(days, "9");
  await user.tab();
  await waitFor(() => expect(app.pendingWrites).toHaveLength(2));
  expect(app.writes[1]).toEqual({ key: "tasks_due_soon_days", value: "9" });
  await act(async () => app.pendingWrites[1]!.release());
  await waitFor(() => expect(error).toHaveBeenCalledTimes(2));
  expect(days.value).toBe("9");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("independent checkbox receipts cannot overwrite the newer local choice or refetch active settings", async () => {
  const app = mount("chores", { holdWrites: true });
  const user = userEvent.setup();

  const checkbox = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: "Swap track next schedule / track now buttons",
  });

  await user.click(checkbox);
  await user.click(checkbox);
  await waitFor(() => expect(app.pendingWrites).toHaveLength(2));
  expect(checkbox.checked).toBe(false);
  expect(app.settings.chores_overview_swap_tracking_buttons).toBe(false);
  const reads = app.settingsReads();
  await act(async () => app.pendingWrites[1]!.release());
  await act(async () => app.pendingWrites[0]!.release());
  expect(
    app.client.getQueryData<UserSettings>(["user", "settings"])
      ?.chores_overview_swap_tracking_buttons,
  ).toBe(false);
  expect(app.settingsReads()).toBe(reads);
  expect(checkbox.checked).toBe(false);
  expect(app.writes).toEqual([
    { key: "chores_overview_swap_tracking_buttons", value: true },
    { key: "chores_overview_swap_tracking_buttons", value: false },
  ]);
});

test("a sent preference failure after native departure stays silent and only marks successor settings stale", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("tasks", { fail: true, holdWrites: true, productionCache: true });
  const user = userEvent.setup();
  const days = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" });
  await user.clear(days);
  await user.type(days, "8");
  await user.tab();
  await waitFor(() => expect(app.pendingWrites).toHaveLength(1));
  await act(() => app.router.navigate({ to: "/barcodescannertesting" }));
  await screen.findByRole("heading", { name: "Barcode scanner testing" });
  expect(app.pendingWrites[0]!.signal?.aborted).toBe(true);
  const reads = app.settingsReads();
  const value = app.client.getQueryData<UserSettings>(["user", "settings"]);
  await act(async () => app.pendingWrites[0]!.release());
  await waitFor(() =>
    expect(app.client.getQueryState(["user", "settings"])?.isInvalidated).toBe(true),
  );
  expect(app.settingsReads()).toBe(reads);
  expect(app.client.getQueryData(["user", "settings"])).toEqual(value);
  expect(error).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("heading", { name: "Barcode scanner testing" })).toBeTruthy();
});

test.each(["chores", "batteries", "tasks"] as const)(
  "native %s settings controls remain readable when navigation is disabled",
  async (kind) => {
    const app = mount(kind, { enabled: false });

    const control = await screen.findByRole<HTMLInputElement>("spinbutton", {
      name: "Due soon days",
    });

    expect(control.value).not.toBe("");
    expect(app.writes).toEqual([]);
  },
);

test.each(["chores", "batteries"] as const)(
  "%s settings preserve the native space-prefixed write defect and reopen the canonical value",
  async (kind) => {
    const app = mount(kind);
    const user = userEvent.setup();
    const days = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" });
    await user.clear(days);
    await user.type(days, "0");
    await user.tab();
    await waitFor(() => expect(app.settings[` ${kind}_due_soon_days`]).toBe("0"));
    expect(days.value).toBe("0");
    expect(app.settings[`${kind}_due_soon_days`]).toBe(5);
    await user.click(screen.getByRole("link", { name: "OK" }));
    await screen.findByRole("heading", {
      name: kind === "chores" ? "Chores overview" : "Batteries overview",
      level: 1,
    });
    const status = await screen.findByRole("combobox", { name: "Status" });
    expect(within(status).getByRole("option", { name: "Due soon" })).toBeTruthy();
    await act(async () => {
      await app.router.navigate({ href: `/${kind}settings` });
    });
    expect(
      (await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" })).value,
    ).toBe("5");
  },
);

test("task settings update the canonical threshold and hide the Due soon overview filter after OK", async () => {
  const app = mount("tasks");
  const user = userEvent.setup();
  const days = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" });
  await user.clear(days);
  await user.type(days, "0");
  await user.tab();
  await waitFor(() => expect(app.settings.tasks_due_soon_days).toBe("0"));
  await user.click(screen.getByRole("link", { name: "OK" }));
  await screen.findByRole("heading", { name: "Tasks", level: 1 });
  const status = await screen.findByRole("combobox", { name: "Status" });
  expect(within(status).queryByRole("option", { name: "Due soon" })).toBeNull();
  await act(async () => {
    await app.router.navigate({ href: "/taskssettings" });
  });
  expect(
    (await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Due soon days" })).value,
  ).toBe("0");
});

test("chore button settings retain the native BoolVal versus PHP truthiness distinction and change the primary action", async () => {
  const app = mount("chores", { values: { chores_overview_swap_tracking_buttons: "false" } });
  const user = userEvent.setup();

  const checkbox = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: "Swap track next schedule / track now buttons",
  });

  expect(checkbox.checked).toBe(false);
  await user.click(screen.getByRole("link", { name: "OK" }));
  const initialPrimary = await screen.findByRole("button", { name: "Track chore execution now" });
  expect(initialPrimary.getAttribute("aria-label")).toBe("Track chore execution now");
  expect(
    app.writes.filter((write) => write.key === "chores_overview_swap_tracking_buttons"),
  ).toEqual([]);
  await act(async () => {
    await app.router.navigate({ href: "/choressettings" });
  });
  await user.click(
    await screen.findByRole("checkbox", { name: "Swap track next schedule / track now buttons" }),
  );
  await waitFor(() => expect(app.settings.chores_overview_swap_tracking_buttons).toBe(true));
  await user.click(
    screen.getByRole("checkbox", { name: "Swap track next schedule / track now buttons" }),
  );
  await waitFor(() => expect(app.settings.chores_overview_swap_tracking_buttons).toBe(false));
  await user.click(screen.getByRole("link", { name: "OK" }));
  const primary = await screen.findByRole("button", { name: "Track next chore schedule" });
  expect(primary.getAttribute("aria-label")).toBe("Track next chore schedule");
  expect(
    app.writes.filter((write) => write.key === "chores_overview_swap_tracking_buttons"),
  ).toEqual([
    { key: "chores_overview_swap_tracking_buttons", value: true },
    { key: "chores_overview_swap_tracking_buttons", value: false },
  ]);
});
