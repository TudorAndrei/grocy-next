import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";

function mountSidebar(path = "/tasks", strictMode = false) {
  const mutations: string[] = [];

  const config = {
    MODE: "production",
    FEATURE_FLAG_STOCK: true,
    FEATURE_FLAG_SHOPPINGLIST: false,
  };

  const settings = { night_mode: "off", night_mode_enabled_internal: false };
  const storage = vi.spyOn(Storage.prototype, "setItem");

  const app = mountNativeEditor(
    path,
    (url, options) => {
      if (options?.method && !["GET", "HEAD"].includes(options.method)) {
        mutations.push(url);

        return new Response(null, { status: 204 });
      }

      if (url === "/api/user/settings") return Response.json(settings);

      if (url === "/api/v2/tasks/overview")
        return Response.json({ rows: [], categories: [], next_days: 5, include_done: false });

      if (url === "/api/system/db-changed-time")
        return Response.json({ changed_time: "2026-01-01 12:00:00" });

      if (url.startsWith("/api/v2/products/context"))
        return Response.json({
          products: [],
          locations: [],
          quantity_units: [],
          product_groups: [],
          shopping_locations: [],
          userfields: [],
          userfield_values: [],
          user_settings: settings,
          config,
          locale: "en",
        });

      return undefined;
    },
    config,
    {},
    { browserSession: true, strictMode },
  );

  return {
    ...app,
    sidebarWrites: () =>
      storage.mock.calls.filter(([key]) => key === "sidebar_state").map(([, value]) => value),
    nonTableWrites: () =>
      mutations.filter((path) => !path.startsWith("/api/user/settings/datatables_state_")),
  };
}

test.each([
  { label: "missing", stored: null, compact: false },
  { label: "unknown", stored: "COLLAPSED", compact: false },
  { label: "exact collapsed", stored: "collapsed", compact: true },
])(
  "sidebar restores $label storage without inventing an expanded preference",
  async ({ stored, compact }) => {
    if (stored !== null) localStorage.setItem("sidebar_state", stored);
    const app = mountSidebar("/chores", compact);
    await screen.findByRole("heading", { name: "Chores", level: 1 });
    expect(
      screen.getByRole("button", { name: compact ? "Expand sidebar" : "Collapse sidebar" }),
    ).toBeTruthy();
    const manage = screen.getByRole("button", { name: "Manage master data" });
    expect(manage.getAttribute("aria-expanded")).toBe(String(!compact));
    expect(localStorage.getItem("sidebar_state")).toBe(stored);

    if (compact) expect(app.sidebarWrites()).toEqual(["collapsed"]);
    else expect(app.sidebarWrites()).toEqual([]);
    expect(app.nonTableWrites()).toEqual([]);
  },
);

test("Manage expands before opening its unique Products link and the desktop toggle closes the disclosure", async () => {
  localStorage.setItem("sidebar_state", "collapsed");
  const app = mountSidebar("/chores");
  await screen.findByRole("button", { name: "Expand sidebar" });
  const nav = screen.getByRole("navigation", { name: "Primary" });
  const manage = within(nav).getByRole("button", { name: "Manage master data" });
  const user = userEvent.setup();
  expect(manage.getAttribute("aria-expanded")).toBe("false");
  expect(within(nav).queryByRole("link", { name: "Products" })).toBeNull();
  const before = app.sidebarWrites().length;
  const opened: Array<string | null> = [];

  const observer = new MutationObserver(() => {
    if (manage.getAttribute("aria-expanded") === "true")
      opened.push(localStorage.getItem("sidebar_state"));
  });

  observer.observe(manage, { attributes: true, attributeFilter: ["aria-expanded"] });
  onTestFinished(() => observer.disconnect());
  await user.click(manage);
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  expect(manage.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(opened).toEqual(["expanded"]));
  const products = within(nav).getByRole("link", { name: "Products" });
  expect(nav.querySelectorAll('a[href="/products"]')).toHaveLength(1);
  expect(document.getElementById(manage.getAttribute("aria-controls")!)?.contains(products)).toBe(
    true,
  );
  await user.click(manage);
  expect(manage.getAttribute("aria-expanded")).toBe("false");
  expect(app.sidebarWrites().slice(before)).toEqual(["expanded", "expanded"]);
  await user.click(manage);
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(manage.getAttribute("aria-expanded")).toBe("false");
  expect(localStorage.getItem("sidebar_state")).toBe("collapsed");
  await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(localStorage.getItem("sidebar_state")).toBe("expanded");
  expect(manage.getAttribute("aria-expanded")).toBe("false");
  expect(within(nav).queryByRole("link", { name: "Products" })).toBeNull();
  expect(app.nonTableWrites()).toEqual([]);
});

test("collapsed choice survives native navigation and remount while account and View controls remain reachable", async () => {
  const first = mountSidebar();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Collapse sidebar" }));
  expect(localStorage.getItem("sidebar_state")).toBe("collapsed");
  await user.click(screen.getByRole("button", { name: "View settings" }));
  expect(screen.getByRole("region", { name: "View settings" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "User: owner" }));
  expect(screen.getByRole("link", { name: "Logout" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("link", { name: "Equipment" }));
  await screen.findByRole("heading", { name: "Equipment", level: 1 });
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  expect(localStorage.getItem("sidebar_state")).toBe("collapsed");
  expect(first.nonTableWrites()).toEqual([]);
  cleanup();
  first.client.clear();
  const next = mountSidebar("/chores");
  await screen.findByRole("heading", { name: "Chores", level: 1 });
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Manage master data" }).getAttribute("aria-expanded"),
  ).toBe("false");
  expect(localStorage.getItem("sidebar_state")).toBe("collapsed");
  expect(next.nonTableWrites()).toEqual([]);
});

test("embedded documents omit sidebar controls and never rewrite the stored choice", async () => {
  localStorage.setItem("sidebar_state", "collapsed");
  const app = mountSidebar("/tasks?embedded");
  await screen.findByRole("heading", { name: "Tasks", level: 1 });
  expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
  expect(screen.queryByRole("button", { name: /sidebar/i })).toBeNull();
  expect(screen.queryByRole("button", { name: "Manage master data" })).toBeNull();
  expect(screen.queryByRole("button", { name: "View settings" })).toBeNull();
  expect(app.sidebarWrites()).toEqual([]);
  expect(localStorage.getItem("sidebar_state")).toBe("collapsed");
  expect(app.nonTableWrites()).toEqual([]);
});

test.each([
  { label: "visible", activeTop: 100, calls: 0 },
  { label: "offscreen", activeTop: 650, calls: 1 },
])(
  "native initial active item scrolls only when $label within declared rail geometry",
  async ({ activeTop, calls }) => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.matches('.site-nav a[aria-current="page"]'))
        return new DOMRect(20, activeTop, 150, 20);

      if (this.matches(".site-rail")) return new DOMRect(0, 0, 236, 500);

      return new DOMRect(0, 0, 0, 0);
    });
    mountSidebar();
    await screen.findByRole("heading", { name: "Tasks", level: 1 });
    await screen.findByRole("button", { name: "Collapse sidebar" });
    expect(scroll).toHaveBeenCalledTimes(calls);

    if (calls) expect(scroll.mock.contexts[0]).toBe(screen.getByRole("link", { name: "Tasks" }));
    // Another real disclosure render must not repeat the document's initial scroll.
    await userEvent.setup().click(screen.getByRole("button", { name: "Manage master data" }));
    expect(scroll).toHaveBeenCalledTimes(calls);
  },
);
