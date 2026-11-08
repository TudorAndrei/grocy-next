import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";

function calendarContext() {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const config: JsonObject = {
    CALENDAR_SHOW_WEEK_OF_YEAR: true,
    CALENDAR_FIRST_DAY_OF_WEEK: "1",
    FEATURE_FLAG_TASKS: true,
  };

  return {
    events: [
      {
        title: "Date-only stock due",
        start: day,
        allDay: true,
        link: "/about?from=calendar",
        color: "#123456",
      },
      {
        title: "Timed offset chore",
        start: `${day}T09:30:00+03:00`,
        allDay: false,
        link: "/about",
        color: "#654321",
      },
    ],
    user_settings: { calendar_color_tasks: "#654321" },
    config,
    locale: "en",
  };
}

function mountCalendar(
  {
    path = "/calendar",
    width = 1024,
    denied = false,
    held = false,
    localized = false,
    holdLocale = false,
    basepath = "",
  } = {},
  config: JsonObject = {},
) {
  vi.stubGlobal("innerWidth", width);
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let contextReads = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  const data = calendarContext();
  data.config = { ...data.config, ...config };

  if (localized) data.locale = "de";

  const app = mountNativeEditor(
    path,
    async (url, options) => {
      if (url.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

      if (url === "/api/v2/calendar/context") {
        contextReads++;
        signals.push(options?.signal);

        if (held) await gate;

        if (denied && contextReads === 1)
          return Response.json({ error_message: "Calendar unavailable" }, { status: 503 });

        return Response.json(data);
      }

      if (url.startsWith("/api/v2/localization") && localized) {
        if (holdLocale) await gate;

        return Response.json({
          locale: "de",
          direction: "ltr",
          languages: ["de"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: { "": { moment_locale: ["de"], fullcalendar_locale: ["de"] } },
          },
        });
      }

      return undefined;
    },
    { FEATURE_FLAG_CALENDAR: false },
    { basepath },
  );

  return { ...app, data, release, signals, reads: () => contextReads };
}

async function bootCalendar() {
  const frame = await screen.findByTitle<HTMLIFrameElement>("Calendar");
  // The manual message bridge below is synchronous; browsers queue postMessage tasks.
  // Flush the mounted parent's effects before delivering the child's load/ready events.
  await act(async () => {});
  const transport = frame.contentWindow!;
  const source = readFileSync(resolve("public/vendor/fullcalendar/index.html"), "utf8");
  const html = source.replace(/<script\b[^>]*src=[^>]*><\/script>/g, "");

  const child = new JSDOM(html, {
    url: frame.src,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  const browser = child.window;
  Object.defineProperty(browser, "parent", { configurable: true, value: window });
  // Supply the layout primitives missing from JSDOM; all calendar parsing/rendering is upstream.
  Object.defineProperty(browser.HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(browser.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 24,
  });
  Object.defineProperty(browser.document.documentElement, "clientWidth", {
    configurable: true,
    get: () => 900,
  });
  Object.assign(browser, { scrollTo: () => {} });
  let resolveReady = () => {};

  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  vi.spyOn(transport, "postMessage").mockImplementation((data) => {
    browser.dispatchEvent(
      new browser.MessageEvent("message", { data, origin: window.location.origin, source: window }),
    );
  });
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin: window.location.origin, source: transport }),
    );

    if (data?.channel === "grocy-native-calendar" && data.kind === "ready") resolveReady();
  });

  for (const script of new browser.DOMParser()
    .parseFromString(source, "text/html")
    .querySelectorAll("script[src]"))
    browser.eval(
      readFileSync(resolve(`public/vendor/fullcalendar/${script.getAttribute("src")}`), "utf8"),
    );
  onTestFinished(() => {
    browser.dispatchEvent(new browser.Event("pagehide"));
    browser.close();
  });
  await act(async () => {
    fireEvent.load(frame);
    await ready;
  });
  await waitFor(() => expect(browser.document.querySelector(".fc-view")).not.toBeNull());
  // The child renders before its ready packet commits the parent's one-shot resize handler.
  await waitFor(() =>
    expect(within(frame.closest(".native-calendar")!).queryByRole("status")).toBeNull(),
  );

  return { frame, browser, ui: within(browser.document.body) };
}

test("the real native runtime renders month dates, wall-clock offset times, week numbers and all native views without reading URL state", async () => {
  const app = mountCalendar(
    { path: "/calendar?view=agendaDay&date=2000-01-01#old" },
    { CALENDAR_FIRST_DAY_OF_WEEK: 0, CALENDAR_SHOW_WEEK_OF_YEAR: "false" },
  );

  const { browser, ui } = await bootCalendar();
  expect(screen.queryByRole("link", { name: "Calendar" })).toBeNull();
  expect(browser.document.querySelector(".fc-month-view")).toBeTruthy();
  expect(browser.document.querySelector(".fc-week-number")).toBeTruthy();
  expect(browser.document.querySelector(".fc-day-header:not(.fc-week-number)")?.textContent).toBe(
    "Sun",
  );
  const allDay = await ui.findByText("Date-only stock due");
  expect(allDay.closest(".fc-event")?.querySelector(".fc-time")).toBeNull();
  expect(
    (await ui.findByText("Timed offset chore")).closest(".fc-event")?.querySelector(".fc-time")
      ?.textContent,
  ).toBe("09:30");
  const initialTitle = browser.document.querySelector(".fc-center")?.textContent;
  await userEvent.click(browser.document.querySelector<HTMLButtonElement>(".fc-next-button")!);
  expect(browser.document.querySelector(".fc-center")?.textContent).not.toBe(initialTitle);
  await userEvent.click(ui.getByRole("button", { name: "today" }));
  expect(browser.document.querySelector(".fc-center")?.textContent).toBe(initialTitle);

  for (const [name, selector] of [
    ["week", ".fc-agendaWeek-view"],
    ["day", ".fc-agendaDay-view"],
    ["list", ".fc-listWeek-view"],
    ["month", ".fc-month-view"],
  ]) {
    await userEvent.click(ui.getByRole("button", { name }));
    expect(browser.document.querySelector(selector)).toBeTruthy();
  }

  expect(app.router.history.location.search).toBe("?view=agendaDay&date=2000-01-01");
  expect(app.router.history.location.hash).toBe("#old");
});

test("responsive initialization uses the outer viewport and only its first resize changes the selected view", async () => {
  mountCalendar({ width: 500 });
  const { browser, ui } = await bootCalendar();
  expect(browser.document.querySelector(".fc-agendaDay-view")).toBeTruthy();
  await userEvent.click(ui.getByRole("button", { name: "list" }));
  vi.stubGlobal("innerWidth", 1024);
  act(() => fireEvent(window, new Event("resize")));
  await waitFor(() => expect(browser.document.querySelector(".fc-month-view")).toBeTruthy());
  await userEvent.click(ui.getByRole("button", { name: "week" }));
  vi.stubGlobal("innerWidth", 500);
  act(() => fireEvent(window, new Event("resize")));
  expect(browser.document.querySelector(".fc-agendaWeek-view")).toBeTruthy();
});

test("native event links retire the runtime and its parent-theme observer while event colors remain authoritative", async () => {
  const app = mountCalendar();
  const { browser, ui } = await bootCalendar();
  const root = document.documentElement;
  const previousStyle = root.getAttribute("style");
  const previousTheme = root.dataset.theme;
  onTestFinished(() => {
    if (previousStyle === null) root.removeAttribute("style");
    else root.setAttribute("style", previousStyle);

    if (previousTheme === undefined) delete root.dataset.theme;
    else root.dataset.theme = previousTheme;
  });
  act(() => {
    root.dataset.theme = "dark";
    root.style.setProperty("--surface", "#121212");
    root.style.setProperty("--ink", "#f4f4f4");
    root.style.setProperty("--line", "#454545");
    root.style.setProperty("--surface-sunk", "#222222");
  });
  await waitFor(() => expect(browser.document.documentElement.dataset.theme).toBe("dark"));
  expect(browser.document.documentElement.style.getPropertyValue("--surface")).toBe("#121212");
  expect(
    (await ui.findByText("Date-only stock due")).closest<HTMLElement>(".fc-event")?.style
      .backgroundColor,
  ).toBe("rgb(18, 52, 86)");
  await userEvent.click(await ui.findByText("Date-only stock due"));
  await waitFor(() => expect(app.router.history.location.pathname).toBe("/about"));
  expect(app.router.history.location.search).toBe("?from=calendar");
  expect(browser.document.querySelector(".fc-view")).toBeNull();
  await act(async () => {
    root.style.setProperty("--surface", "#ffffff");
  });
  expect(browser.document.documentElement.style.getPropertyValue("--surface")).toBe("#121212");
});

test("context and runtime-resource failures can retry a fresh native calendar", async () => {
  const app = mountCalendar({ denied: true });
  await screen.findByText("Calendar unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  const first = await bootCalendar();
  expect(app.reads()).toBe(2);
  const failedScript = first.browser.document.createElement("script");
  first.browser.document.body.append(failedScript);
  act(() => failedScript.dispatchEvent(new first.browser.Event("error")));
  await screen.findByText("Could not load calendar.");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(first.browser.document.querySelector(".fc-view")).toBeNull();
  await bootCalendar();
  await act(async () => {
    await app.router.navigate({ to: "/about" });
  });
  expect(screen.queryByTitle("Calendar")).toBeNull();
});

test("leaving a held context aborts it and its late response cannot initialize a departed calendar", async () => {
  const app = mountCalendar({ held: true });
  await waitFor(() => expect(app.reads()).toBe(1));
  await act(async () => {
    await app.router.navigate({ to: "/about" });
  });
  expect(app.signals[0]?.aborted).toBe(true);
  await act(async () => app.release());
  expect(screen.queryByTitle("Calendar")).toBeNull();
});

test("dismissing colors performs a fresh native page reload, clears URL state and resets the selected view", async () => {
  const app = mountCalendar({
    path: "/house.hold/calendar?date=2000-01-01#old",
    basepath: "/house.hold",
  });

  const first = await bootCalendar();
  await userEvent.click(first.ui.getByRole("button", { name: "week" }));
  await userEvent.click(screen.getByRole("button", { name: "Configure colors" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Configure colors" })).getByRole("button", {
      name: "OK",
    }),
  );
  await waitFor(() => expect(app.reads()).toBe(2));
  expect(first.browser.document.querySelector(".fc-view")).toBeNull();
  expect(app.router.history.location.search).toBe("");
  expect(app.router.history.location.hash).toBe("");
  expect(app.router.history.location.pathname).toBe("/house.hold/calendar");
  const second = await bootCalendar();
  expect(second.frame).not.toBe(first.frame);
  expect(second.browser.document.querySelector(".fc-month-view")).toBeTruthy();
});

test("the first ready localization snapshot controls native calendar labels and first weekday", async () => {
  const app = mountCalendar(
    { localized: true, holdLocale: true },
    { CALENDAR_FIRST_DAY_OF_WEEK: false },
  );

  await waitFor(() => expect(app.reads()).toBe(1));
  expect(screen.queryByTitle("Calendar")).toBeNull();
  await act(async () => app.release());
  const { browser, ui } = await bootCalendar();
  expect(ui.getByRole("button", { name: "Monat" })).toBeTruthy();
  expect(
    browser.document.querySelector(".fc-day-header:not(.fc-week-number)")?.textContent,
  ).toMatch(/^Mo/);
});
