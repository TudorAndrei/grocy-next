import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountMainDate, type MainDateHost } from "./fixtures/native-main-dates";
import { mountNativeUserfieldsHost, nativeUserfieldHosts } from "./fixtures/native-userfield-hosts";
import tamil from "./fixtures/tamil-localization.json";

const TAMIL_NOW = "௨௦௩௦-௦௫-௦௬ ௦௭:௦௮:௦௯";
const TAMIL_DAY = "௨௦௩௦-௦௫-௦௬";
const TAMIL_PAST = "௨௦௨௦-௦௧-௦௨ ௦௩:௦௪:௦௦";

function freezeClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

async function mainControl(host: MainDateHost) {
  const user = userEvent.setup();

  if (host === "choretracking" || host === "batterytracking") {
    const kind = host === "choretracking" ? "Chore" : "Battery";
    const name = host === "choretracking" ? "Water plants" : "Camera battery";
    await user.type(await screen.findByRole("combobox", { name: kind }), `${name}{Enter}`);
    await screen.findByRole("heading", { name });

    return screen.getByLabelText<HTMLInputElement>("Tracked time");
  }

  if (host === "reschedule") {
    const chore = await screen.findByRole("button", { name: "Water plants" });
    const row = chore.closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "More" }));
    await user.click(within(row).getByRole("menuitem", { name: "Reschedule next execution" }));
    const dialog = await screen.findByRole("dialog", { name: "Reschedule next execution" });

    return within(dialog).findByLabelText<HTMLInputElement>("Next estimated tracking");
  }

  if (host === "mealplan") {
    const actions = await screen.findAllByRole("button", { name: "More actions" });
    await user.click(actions[0]!);
    await user.click(screen.getByRole("button", { name: "Add note" }));
    const dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });

    return within(dialog).getByLabelText<HTMLInputElement>("Day");
  }

  if (host === "recipes") {
    await user.click(
      await screen.findByRole("button", { name: "More actions for recipe Rice dinner" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Add to meal plan" }));
    const dialog = await screen.findByRole("dialog", { name: "Add meal plan entry" });

    return within(dialog).getByLabelText<HTMLInputElement>("Day");
  }

  return screen.findByLabelText<HTMLInputElement>("Start date");
}

test.each([
  { host: "chore", initial: TAMIL_PAST, path: "/api/objects/chores/1", key: "start_date" },
  { host: "choretracking", initial: TAMIL_NOW, path: "/api/chores/1/execute", key: "tracked_time" },
  {
    host: "batterytracking",
    initial: TAMIL_NOW,
    path: "/api/batteries/1/charge",
    key: "tracked_time",
  },
  {
    host: "reschedule",
    initial: "௨௦௩௦-௦௫-௦௫ ௦௬:௦௭:௦௮",
    path: "/api/objects/chores/1",
    key: "rescheduled_date",
  },
] as const)(
  "$host retains the source Tamil main datetime and sends exact live text",
  async ({ host, initial, path, key }) => {
    freezeClock();
    const app = mountMainDate(host, { localizedNext: host === "reschedule" });

    if (host === "reschedule") {
      const overdue = await screen.findByRole("button", { name: /overdue to be done/ });
      expect(overdue.textContent).toBe("1 chore is overdue to be done");
    }

    const input = await mainControl(host);
    await waitFor(() => expect(input.value).toBe(initial));
    expect(input.type).toBe("text");
    const user = userEvent.setup();
    await user.clear(input);
    await user.paste(TAMIL_PAST);
    await user.keyboard("{End}");
    expect(input.value).toBe(TAMIL_PAST);
    expect(input.validity.valid).toBe(true);
    const scope = within(input.closest("form")!);
    await user.click(scope.getByRole("button", { name: host === "chore" ? "சேமி" : "OK" }));
    await waitFor(() =>
      expect(app.writes.find((write) => write.path === path)?.body[key]).toBe(TAMIL_PAST),
    );

    if (host === "reschedule")
      await waitFor(() =>
        expect(app.writes.filter((write) => !write.path.startsWith("/api/user/settings/"))).toEqual(
          [
            {
              path,
              body: {
                rescheduled_date: TAMIL_PAST,
                rescheduled_next_execution_assigned_to_user_id: "7",
              },
            },
            { path: "/api/chores/executions/calculate-next-assignments", body: { chore_id: "1" } },
          ],
        ),
      );
    expect(app.errors).not.toHaveBeenCalled();
  },
);

test.each([
  { host: "chore", label: "Start date", datetime: true },
  { host: "choretracking", label: "Tracked time", datetime: true },
  { host: "batterytracking", label: "Tracked time", datetime: true },
  { host: "reschedule", label: "Next estimated tracking", datetime: true },
  { host: "task", label: "Due", route: "/task/new", namespace: "tasks" },
  { host: "purchase", label: "Due date", route: "/purchase", namespace: "stock" },
  { host: "inventory", label: "Due date", route: "/inventory", namespace: "stock" },
  { host: "stockentry", label: "Due date", route: "/stockentry/51", namespace: "stock" },
  { host: "mealplan", label: "Day" },
  { host: "recipes", label: "Day" },
] as const)(
  "$host exposes the actual native main picker with supported locale and calendar configuration",
  async (profile) => {
    freezeClock();
    let input: HTMLInputElement;

    if (profile.route) {
      const host = nativeUserfieldHosts.find((host) => host.route === profile.route)!;
      mountNativeUserfieldsHost(host, {
        noFields: true,
        localization: tamil,
        config: {
          FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: true,
          CALENDAR_FIRST_DAY_OF_WEEK: "1",
          CALENDAR_SHOW_WEEK_OF_YEAR: "0",
        },
      });
      input = await screen.findByLabelText<HTMLInputElement>(profile.label);
    } else {
      mountMainDate(profile.host);
      input = await mainControl(profile.host);
    }

    expect(input.type).toBe("text");
    const raw = "datetime" in profile && profile.datetime ? TAMIL_PAST : TAMIL_DAY;
    const user = userEvent.setup();
    await user.clear(input);
    await user.paste(raw);
    await user.keyboard("{End}");
    expect(input.value).toBe(raw);
    expect(input.validity.valid).toBe(true);
    const name = `${profile.label}: நாட்காட்டி`;
    await user.click(screen.getByRole("button", { name }));
    const calendar = await screen.findByRole("dialog", { name });
    expect(
      within(calendar)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["தி", "செ", "பு", "வி", "வெ", "ச", "ஞா"]);
  },
);

test("Chore date-only tracking changes the real widget format, sends localized day and retains source full-time invalid reset", async () => {
  freezeClock();
  const app = mountMainDate("choretracking", { dateOnly: true });
  const input = await mainControl("choretracking");
  await waitFor(() => expect(input.value).toBe(TAMIL_DAY));
  expect(input.type).toBe("text");
  expect(input.validity.valid).toBe(true);
  await userEvent.click(within(input.closest("form")!).getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(
      app.writes.find((write) => write.path === "/api/chores/1/execute")?.body.tracked_time,
    ).toBe(TAMIL_DAY),
  );
  await waitFor(() => expect(input.value).toBe(TAMIL_NOW));
  expect(input.validity.customError).toBe(true);
});

test("history-disabled Chore Start still reads exact native raw datetime when another primary value is saved", async () => {
  freezeClock();
  const app = mountMainDate("chore", { history: true });
  const input = await mainControl("chore");
  await waitFor(() => expect(input.value).toBe(TAMIL_PAST));
  expect(input.disabled).toBe(true);
  // Source GetValue reads the live input even when history disables natural edits.
  input.value = TAMIL_NOW;
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Edited plants" } });
  await userEvent.click(within(input.closest("form")!).getByRole("button", { name: "சேமி" }));
  await waitFor(() =>
    expect(
      app.writes.find((write) => write.path === "/api/objects/chores/1")?.body.start_date,
    ).toBe(TAMIL_NOW),
  );
});

test("native main datetime validates required seconds and the Battery end-to-now boundary before Save", async () => {
  freezeClock();
  const app = mountMainDate("batterytracking", { english: true });
  const input = await mainControl("batterytracking");
  fireEvent.input(input, { target: { value: "2030-05-06 07:08" } });
  fireEvent.keyUp(input, { key: "8" });
  expect(input.validity.customError).toBe(true);
  fireEvent.input(input, { target: { value: "2030-05-07 07:08:09" } });
  fireEvent.keyUp(input, { key: "9" });
  expect(input.validity.customError).toBe(true);
  expect(app.writes).toEqual([]);
  await act(async () => {
    fireEvent.input(input, { target: { value: "2030-05-06 07:08:09" } });
    fireEvent.keyUp(input, { key: "9" });
  });
  expect(input.validity.valid).toBe(true);
  await userEvent.click(within(input.closest("form")!).getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(
      app.writes.find((write) => write.path === "/api/batteries/1/charge")?.body.tracked_time,
    ).toBe("2030-05-06 07:08:09"),
  );
});

test("the real Date1 runtime handles localized datetime shortcuts under Strict Mode and retires its open popup at document departure", async () => {
  freezeClock();
  const app = mountMainDate("chore", { strict: true });
  const input = await mainControl("chore");
  await waitFor(() => expect(input.value).toBe(TAMIL_PAST));
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, "+1d");
  expect(input.value).toBe("௨௦௩௦-௦௫-௦௭ ௦௭:௦௮:௦௯");
  // The pinned runtime consumes the legacy keyCode and Shift modifier for month arrows.
  fireEvent.keyUp(input, { key: "ArrowUp", keyCode: 38, shiftKey: true });
  expect(input.value).toBe("௨௦௩௦-௦௪-௦௭ ௦௭:௦௮:௦௯");
  await user.click(screen.getByRole("button", { name: "Start date: நாட்காட்டி" }));
  await screen.findByRole("dialog", { name: "Start date: நாட்காட்டி" });
  await act(async () => app.router.navigate({ href: "/settings" }));
  await screen.findByRole("heading", { name: "Settings", level: 1 });
  expect(screen.queryByRole("dialog", { name: "Start date: நாட்காட்டி" })).toBeNull();
  expect(app.errors).not.toHaveBeenCalled();
});

test.each([
  { route: "/purchase", namespace: "stock", action: "add" },
  { route: "/inventory", namespace: "stock", action: "inventory" },
] as const)("$route releases the busy form before native Never/date reset", async (host) => {
  const app = mountNativeUserfieldsHost(host, {
    noFields: true,
    config: { FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: true },
  });

  const user = userEvent.setup();
  const product = await screen.findByRole<HTMLInputElement>("combobox", { name: "Product" });
  await user.type(product, "Coffee{Enter}");

  const amount = await screen.findByRole<HTMLInputElement>("spinbutton", {
    name: host.route === "/purchase" ? /^Amount/ : /^New stock amount/,
  });

  await user.clear(amount);
  await user.type(amount, "6");
  const due = screen.getByLabelText<HTMLInputElement>("Due date");
  const never = screen.getByRole<HTMLInputElement>("checkbox", { name: "Never overdue" });
  await user.click(never);
  expect({ due: due.value, checked: never.checked, readonly: due.readOnly }).toEqual({
    due: "2999-12-31",
    checked: true,
    readonly: true,
  });
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(
      app.writes.find((write) => write.path === `/api/stock/products/7/${host.action}`)?.body
        .best_before_date,
    ).toBe("2999-12-31"),
  );
  await waitFor(() => expect(product.value).toBe(""));
  expect(due.matches(":disabled")).toBe(false);
  expect({ due: due.value, checked: never.checked, readonly: due.readOnly }).toEqual({
    due: "",
    checked: false,
    readonly: false,
  });
});

test.each([false, true])(
  "Meal plan copy uses its standalone native Date2 locale/config and exact target bytes (English=%s)",
  async (english) => {
    freezeClock();
    const originalValue = Object.getOwnPropertyDescriptor(globalThis, "value");

    const sentinel = {
      configurable: true,
      enumerable: false,
      writable: true,
      value: "before-mealplan-clear",
    };

    if (!english) Object.defineProperty(globalThis, "value", sentinel);

    const app = mountMainDate("mealplan", {
      english,
      localizedCopyRow: !english,
      config: { CALENDAR_FIRST_DAY_OF_WEEK: "1", CALENDAR_SHOW_WEEK_OF_YEAR: "0" },
    });

    if (!english)
      onTestFinished(() => {
        cleanup();

        if (originalValue) Object.defineProperty(globalThis, "value", originalValue);
        else Reflect.deleteProperty(globalThis, "value");
      });

    const user = userEvent.setup();
    await screen.findByText("Rice dinner");
    await user.click((await screen.findAllByRole("button", { name: "More actions" }))[0]!);
    await user.click(screen.getByRole("button", { name: "Copy this day" }));

    let dialog = await screen.findByRole("dialog", {
      name: `Copy all meal plan entries of ${english ? "2026-11-02" : "௨௦௨௬-௧௧-௦௨"}`,
    });

    if (!english) {
      expect(Object.getOwnPropertyDescriptor(globalThis, "value")?.value).toBe("");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(Object.getOwnPropertyDescriptor(globalThis, "value")?.value).toBe("");
      await user.click(screen.getAllByRole("button", { name: "More actions" })[0]!);
      await user.click(screen.getByRole("button", { name: "Copy this day" }));
      dialog = await screen.findByRole("dialog", {
        name: "Copy all meal plan entries of ௨௦௨௬-௧௧-௦௨",
      });
    }

    const input = within(dialog).getByLabelText<HTMLInputElement>("Day");
    expect(input.value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(input));
    const target = english ? "2030-05-06" : TAMIL_DAY;
    await user.click(input);
    await user.paste(target);
    await user.keyboard("{End}");
    expect(input.value).toBe(target);
    const name = `Day: ${english ? "Calendar" : "நாட்காட்டி"}`;
    await user.click(within(dialog).getByRole("button", { name }));
    const calendar = await screen.findByRole("dialog", { name });
    expect(
      within(calendar)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(
      english
        ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
        : ["தி", "செ", "பு", "வி", "வெ", "ச", "ஞா"],
    );
    await user.click(within(calendar).getByRole("button", { name: "Close the picker" }));
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(app.writes.filter((write) => write.path === "/api/objects/meal_plan")).toHaveLength(1),
    );
    expect(app.reads).toContain(
      `/api/objects/meal_plan?query[]=day=${english ? "2026-11-02" : "௨௦௨௬-௧௧-௦௨"}`,
    );
    expect(app.writes.find((write) => write.path === "/api/objects/meal_plan")?.body).toMatchObject(
      { day: target, type: "recipe", recipe_id: 7, done: 0 },
    );

    if (!english) {
      await waitFor(() => expect(dialog.isConnected).toBe(false));
      await user.click((await screen.findAllByRole("button", { name: "More actions" }))[0]!);
      await user.click(screen.getByRole("button", { name: "Copy this day" }));
      await screen.findByRole("dialog", { name: "Copy all meal plan entries of ௨௦௨௬-௧௧-௦௨" });
      expect(Object.getOwnPropertyDescriptor(globalThis, "value")?.value).toBe("");
      await act(async () => app.router.navigate({ href: "/settings" }));
      await screen.findByRole("heading", { name: "Settings", level: 1 });
      expect(Object.getOwnPropertyDescriptor(globalThis, "value")).toEqual(sentinel);
    }
  },
);

test("Tamil Meal plan preserves the localized literal copy lookup for ASCII-only rows and Today returns a usable current week", async () => {
  freezeClock();
  const app = mountMainDate("mealplan");
  const user = userEvent.setup();
  await screen.findByText("Rice dinner");
  await user.click((await screen.findAllByRole("button", { name: "More actions" }))[0]!);
  await user.click(screen.getByRole("button", { name: "Copy this day" }));

  const dialog = await screen.findByRole("dialog", {
    name: "Copy all meal plan entries of ௨௦௨௬-௧௧-௦௨",
  });

  const input = within(dialog).getByLabelText<HTMLInputElement>("Day");
  await user.click(input);
  await user.paste(TAMIL_DAY);
  await user.keyboard("{End}");
  await user.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(app.reads).toContain("/api/objects/meal_plan?query[]=day=௨௦௨௬-௧௧-௦௨"));
  expect(app.writes.filter((write) => write.path === "/api/objects/meal_plan")).toEqual([]);
  expect(dialog.isConnected).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "இன்று" }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "இன்று" }).disabled).toBe(true),
  );
  expect(app.router.state.location.search).toEqual({ start: TAMIL_DAY });
  expect(screen.getAllByRole("button", { name: "More actions" }).length).toBeGreaterThan(0);
});
