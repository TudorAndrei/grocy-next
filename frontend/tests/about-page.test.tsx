import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { AboutContext } from "@/lib/about-page";
import type { JsonObject } from "@/lib/json";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function mountAbout(
  path = "/about",
  options: {
    hold?: boolean;
    fail?: boolean;
    basepath?: string;
    config?: JsonObject;
    browserSession?: boolean;
  } = {},
) {
  const context: AboutContext = {
    system_info: {
      grocy_version: { Version: "4.5.0", ReleaseDate: "2025-03-28" },
      php_version: "",
      python_version: "3.13.2",
      sqlite_version: "3.49.1",
      db_version: 254,
      os: "Linux test server",
      client: "Test <client>",
    },
    changelog: {
      newest_release_number: 80,
      changelog_items: [
        {
          release_number: 75,
          version: "4.2.0",
          release_date: "2024-03-15",
          body_html: "<p>Older release notes.</p>",
        },
        {
          release_number: 79,
          version: "4.4.2",
          release_date: "2025-02-28",
          body_html: "<ul><li>Recent maintenance.</li></ul>",
        },
        {
          release_number: 7,
          version: "1.1.0",
          release_date: "2017-04-21",
          body_html: "<p>Original release notes.</p>",
        },
        {
          release_number: 80,
          version: "4.5.0",
          release_date: "2025-03-28",
          body_html:
            '<p>A <strong>formatted change</strong> with <a href="https://grocy.info">release details</a>.</p>',
        },
        {
          release_number: 76,
          version: "4.3.0",
          release_date: "2024-12-23",
          body_html: "<p>Threshold release notes.</p>",
        },
      ],
    },
  };

  const pending = deferred();
  let failing = options.fail;
  let reads = 0;

  const app = mountNativeEditor(
    path,
    async (url) => {
      if (url === "/api/v2/user/permissions") return Response.json({});

      if (url === "/api/system/info") return Response.json(context.system_info);

      if (url === "/api/v2/system/about") {
        reads += 1;

        if (options.hold) await pending.promise;

        if (failing) {
          failing = false;

          return Response.json({ error_message: "About unavailable" }, { status: 503 });
        }

        return Response.json(context);
      }

      return undefined;
    },
    options.config ?? {},
    { basepath: options.basepath },
    { browserSession: options.browserSession },
  );

  return { ...app, context, pending, reads: () => reads };
}

async function systemTable() {
  return screen.findByRole("table", { name: "System info" });
}

function releaseButton(version: string) {
  return screen.getByRole("button", {
    name: new RegExp(`^Version ${version.replaceAll(".", "\\.")} Released on`),
  });
}

test("native About exposes real system fields, Python runtime and source links without domain grants", async () => {
  mountAbout();
  const table = await systemTable();
  expect(screen.getByRole("heading", { name: "About Grocy" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "System info" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  const rows = within(table).getAllByRole("row");
  expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([
    "Version",
    "Released on",
    "PHP Version",
    "Python Version",
    "SQLite Version",
    "Database Version",
    "OS",
    "Client",
  ]);
  expect(within(rows[2]!).getByRole("cell").textContent).toBe("");
  expect(within(table).getByText("3.13.2")).toBeTruthy();
  expect(within(table).getByText("Test <client>")).toBeTruthy();
  expect(within(table).getByText("Test <client>").querySelector("client")).toBeNull();
  expect(within(rows[1]!).getByRole("cell").querySelector("time")?.getAttribute("datetime")).toBe(
    "2025-03-28",
  );
  expect(screen.getByRole("link", { name: "Say thanks" }).getAttribute("href")).toBe(
    "https://grocy.info/#say-thanks",
  );
  expect(screen.getByRole("link", { name: "Bernd Bestel" }).getAttribute("href")).toBe(
    "https://berrnd.de",
  );
});

test("changelog sorts release numbers and expands by the inclusive numeric threshold, retaining collapse and tab state locally", async () => {
  const app = mountAbout("/about?tab=changelog&unrelated=kept");
  const panel = await screen.findByRole("tabpanel", { name: "Changelog" });
  expect(
    within(panel)
      .getAllByRole("button")
      .map((button) => button.textContent?.match(/Version ([\d.]+)/)?.[1]),
  ).toEqual(["4.5.0", "4.4.2", "4.3.0", "4.2.0", "1.1.0"]);
  expect(releaseButton("4.5.0").getAttribute("aria-expanded")).toBe("true");
  expect(releaseButton("4.3.0").getAttribute("aria-expanded")).toBe("true");
  expect(releaseButton("4.2.0").getAttribute("aria-expanded")).toBe("false");
  expect(within(panel).getByText("formatted change").tagName).toBe("STRONG");
  expect(within(panel).getByRole("link", { name: "release details" }).getAttribute("href")).toBe(
    "https://grocy.info",
  );
  const user = userEvent.setup();
  await user.click(releaseButton("4.2.0"));
  expect(releaseButton("4.2.0").getAttribute("aria-expanded")).toBe("true");
  await user.click(screen.getByRole("tab", { name: "System info" }));
  expect(screen.getByRole("table", { name: "System info" })).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Changelog" }));
  expect(releaseButton("4.2.0").getAttribute("aria-expanded")).toBe("true");
  expect(app.router.history.location.search).toBe("?tab=changelog&unrelated=kept");
});

test.each([
  ["?tab=changelog&tab=system-info", "Changelog"],
  ["?tab&tab=changelog", "System info"],
  ["?tab[]=changelog", "System info"],
  ["?tab=Changelog", "System info"],
  ["?tab=%", "System info"],
  ["?t%61b=changelog", "System info"],
  ["#changelog", "System info"],
])("native About tab uses exact first raw query spelling for %s", async (query, selected) => {
  mountAbout(`/about${query}`);
  await screen.findByRole("heading", { name: "About Grocy" });
  expect(screen.getByRole("tab", { name: selected }).getAttribute("aria-selected")).toBe("true");
});

test("About remains available embedded below a configured application prefix", async () => {
  const app = mountAbout("/pantry/about?embedded&tab=changelog", { basepath: "/pantry" });
  await screen.findByRole("tabpanel", { name: "Changelog" });
  expect(screen.getByRole("main").classList.contains("embedded-main")).toBe(true);
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(app.router.history.location.pathname).toBe("/pantry/about");
});

test("context failure exposes Retry and recovers system information", async () => {
  const app = mountAbout("/about", { fail: true });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "About unavailable");
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  await systemTable();
  expect(app.reads()).toBe(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a pending About read is retired on navigation and re-entry reads a fresh context", async () => {
  const app = mountAbout("/about", { hold: true });
  await waitFor(() => expect(app.reads()).toBe(1));
  await act(() => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings" });
  await act(async () => app.pending.release());
  expect(screen.queryByRole("heading", { name: "About Grocy" })).toBeNull();
  app.context.system_info.db_version = null;
  await act(() => app.router.navigate({ to: "/about", search: {} }));
  const table = await systemTable();
  const row = within(table).getByRole("rowheader", { name: "Database Version" }).closest("tr")!;
  expect(within(row).getByRole("cell").textContent).toBe("");
  expect(app.reads()).toBeGreaterThan(1);
});

test("shell About preserves a dirty parent across configured wider modal openings and modifier clicks", async () => {
  const configured = `${window.location.origin}/house.hold/`;

  const app = mountAbout("/pantry/task/new", {
    basepath: "/pantry",
    browserSession: true,
    config: { BASE_URL: configured, DISABLE_URL_REWRITING: true },
  });

  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await user.type(name, "Unsaved pantry task");
  const form = name.form!;
  expect(form.classList.contains("is-dirty")).toBe(true);
  const trigger = screen.getByRole<HTMLAnchorElement>("link", { name: "About Grocy" });
  const href = `${configured}index.php/about?embedded`;
  expect(trigger.getAttribute("href")).toBe(href);
  const originalOverflow = document.body.style.overflow;
  const intercepted: boolean[] = [];

  const observeClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("a") === trigger)
      intercepted.push(event.defaultPrevented);
  };

  document.addEventListener("click", observeClick);
  onTestFinished(() => document.removeEventListener("click", observeClick));

  const contextReads = () =>
    app.fetchMock.mock.calls.filter(([url]) => String(url).includes("/tasks/form-context")).length;

  const initialReads = contextReads();

  const aboutFrame = async () => {
    const dialog = await screen.findByRole("dialog", { name: "About Grocy" });
    expect(dialog.classList.contains("wider")).toBe(true);
    expect(app.router.history.location.pathname).toBe("/pantry/task/new");
    expect(screen.getByLabelText("Name")).toBe(name);
    expect(name.value).toBe("Unsaved pantry task");
    expect(name.form).toBe(form);
    expect(form.classList.contains("is-dirty")).toBe(true);
    expect(contextReads()).toBe(initialReads);
    expect(app.reads()).toBe(0);
    const frame = within(dialog).getByTitle<HTMLIFrameElement>("About Grocy");
    expect(frame.src).toBe(href);

    return { dialog, frame };
  };

  await user.click(trigger);
  const first = await aboutFrame();
  expect(document.body.style.overflow).toBe("hidden");
  await user.click(within(first.dialog).getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(trigger);
  expect(first.frame.isConnected).toBe(false);
  expect(document.body.style.overflow).toBe(originalOverflow);
  fireEvent.click(trigger, { button: 0, ctrlKey: true });
  const second = await aboutFrame();
  expect(second.frame).not.toBe(first.frame);
  // JSDOM does not turn an Escape key into the browser's native dialog cancel event.
  fireEvent(second.dialog, new Event("cancel", { cancelable: true }));
  expect(document.activeElement).toBe(trigger);
  expect(second.frame.isConnected).toBe(false);
  fireEvent.click(trigger, { button: 0, metaKey: true });
  const third = await aboutFrame();
  expect(third.frame).not.toBe(second.frame);
  expect(intercepted).toEqual([true, true, true]);
  await act(() => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings" });
  expect(third.frame.isConnected).toBe(false);
  expect(document.querySelector('iframe[title="About Grocy"]')).toBeNull();
  expect(document.body.style.overflow).toBe(originalOverflow);
  expect(app.reads()).toBe(0);
  expect(
    app.fetchMock.mock.calls.filter(
      ([, options]) => options?.method && !["GET", "HEAD"].includes(options.method),
    ),
  ).toEqual([]);
});

test("shell About forwards its configured wider request to the highest Grocy window", async () => {
  const hostFrame = document.createElement("iframe");
  document.body.appendChild(hostFrame);
  const host = hostFrame.contentWindow!;
  host.IsGrocy = true;
  Object.defineProperty(host, "parent", { configurable: true, value: host });
  vi.stubGlobal("parent", host);
  const post = vi.spyOn(host, "postMessage").mockImplementation(() => {});
  onTestFinished(() => hostFrame.remove());

  const app = mountAbout("/task/new", {
    browserSession: true,
    config: { BASE_URL: `${window.location.origin}/source/`, DISABLE_URL_REWRITING: true },
  });

  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await userEvent.setup().type(name, "Keep this parent");
  post.mockClear();
  await userEvent.setup().click(screen.getByRole("link", { name: "About Grocy" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith(
    {
      Message: "IframeModal",
      Payload: {
        Link: `${window.location.origin}/source/index.php/about?embedded`,
        DialogType: "wider",
      },
    },
    window.location.origin,
  );
  expect(screen.queryByRole("dialog", { name: "About Grocy" })).toBeNull();
  expect(document.querySelector('iframe[title="About Grocy"]')).toBeNull();
  expect(name.value).toBe("Keep this parent");
  expect(app.router.state.location.pathname).toBe("/task/new");
  expect(app.reads()).toBe(0);
});

test("Quick actions retains direct About navigation as an additional workflow", async () => {
  const app = mountAbout("/task/new", { browserSession: true });
  await screen.findByLabelText("Name");
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: /Quick actions/ })[0]!);
  await user.type(screen.getByRole("combobox", { name: "Command" }), "About Grocy");
  await user.click(await screen.findByRole("option", { name: /About Grocy/ }));
  await systemTable();
  expect(app.router.history.location.pathname).toBe("/about");
  expect(app.router.history.location.search).toBe("");
  expect(screen.queryByRole("dialog", { name: "About Grocy" })).toBeNull();
  expect(document.querySelector('iframe[title="About Grocy"]')).toBeNull();
  expect(screen.getByRole("main").classList.contains("embedded-main")).toBe(false);
  expect(app.reads()).toBeGreaterThan(0);
});
