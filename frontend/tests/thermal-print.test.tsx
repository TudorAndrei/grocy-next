import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import type { UserSettings } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { writeApiConfig } from "@/lib/config";

beforeEach(() => {
  for (const method of ["showModal", "close"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method);
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
    onTestFinished(() => {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    });
  }
});

function mount({
  path = "/shopping",
  hold = false,
  failOnce = false,
  header = true,
}: { path?: string; hold?: boolean; failOnce?: boolean; header?: boolean | string } = {}) {
  writeApiConfig({ baseUrl: "/house", apiKey: "thermal-key" });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
  const values: UserSettings = { shopping_list_print_show_header: header };
  let finish: (() => void) | undefined;
  let failed = false;

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/house/, "");

    if (path === "/api/system/config")
      return Response.json({
        FEATURE_FLAG_THERMAL_PRINTER: true,
        FEATURE_FLAG_LABEL_PRINTER: false,
      });

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path === "/api/user/settings") return Response.json(values);

    if (path.startsWith("/api/user/settings/")) {
      const body: { value: boolean | string } = JSON.parse(String(init?.body));
      values[path.split("/").at(-1)!] = body.value;

      return new Response(null, { status: 204 });
    }

    if (path.includes("/print?"))
      return Response.json({ error_message: "Could not load paper document" }, { status: 503 });

    if (path.startsWith("/api/print/shoppinglist/thermal?")) {
      if (failOnce && !failed) {
        failed = true;

        return Response.json({ error_message: "Printer is offline" }, { status: 400 });
      }

      if (hold)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });

      return Response.json({ result: "OK" });
    }

    if (path.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

    if (path === "/api/objects/shopping_lists")
      return Response.json([
        { id: 1, name: "Groceries" },
        { id: 7, name: "Weekend" },
      ]);

    if (path === "/api/stock/volatile?due_soon_days=5")
      return Response.json({ missing_products: [] });

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
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

  return { fetchMock, finish: () => finish?.() };
}

test("thermal printing saves header choices and sends one job for the selected list", async () => {
  const { fetchMock, finish } = mount({ hold: true });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "Shopping list" }), "7");
  await user.click(await screen.findByRole("button", { name: "Thermal print" }));
  let dialog = await screen.findByRole("dialog", { name: "Print" });
  const checkbox = within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Show header" });
  expect(checkbox.checked).toBe(true);
  await user.click(checkbox);
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Thermal printer" }).disabled,
    ).toBe(false),
  );
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Thermal print" }));
  dialog = await screen.findByRole("dialog", { name: "Print" });
  expect(
    within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Show header" }).checked,
  ).toBe(false);
  await user.click(within(dialog).getByRole("button", { name: "Thermal printer" }));
  dialog = await screen.findByRole("dialog", { name: "Printing" });
  expect(within(dialog).getByRole("status").textContent).toBe("Connecting to printer...");
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Thermal print" }).disabled).toBe(
    true,
  );
  await act(async () => finish());
  await screen.findByText("Print request sent");

  const jobs = fetchMock.mock.calls.filter(([path]) =>
    String(path).includes("/api/print/shoppinglist/thermal?"),
  );

  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.[0]).toBe("/house/api/print/shoppinglist/thermal?list=7&printHeader=false");
  expect(new Headers(jobs[0]?.[1]?.headers).get("GROCY-API-KEY")).toBe("thermal-key");

  const save = fetchMock.mock.calls.find(([path]) =>
    String(path).endsWith("/shopping_list_print_show_header"),
  );

  expect(JSON.parse(String(save?.[1]?.body))).toEqual({ value: false });
  expect(open).not.toHaveBeenCalled();
});

test("a failed thermal job shows its error and retries the retained options", async () => {
  const { fetchMock } = mount({ failOnce: true, header: "0" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Thermal print" }));
  const options = await screen.findByRole("dialog", { name: "Print" });
  expect(
    within(options).getByRole<HTMLInputElement>("checkbox", { name: "Show header" }).checked,
  ).toBe(false);
  await user.click(within(options).getByRole("button", { name: "Thermal printer" }));
  const dialog = await screen.findByRole("dialog", { name: "Printing" });
  expect(await within(dialog).findByRole("alert")).toHaveProperty(
    "textContent",
    "Printer is offline",
  );
  expect(within(dialog).getByRole("status").textContent).toBe("Unable to print");
  await user.click(within(dialog).getByRole("button", { name: "Retry" }));
  await screen.findByText("Print request sent");
  expect(
    fetchMock.mock.calls
      .filter(([path]) => String(path).includes("/api/print/shoppinglist/thermal?"))
      .map(([path]) => String(path)),
  ).toEqual([
    "/house/api/print/shoppinglist/thermal?list=1&printHeader=false",
    "/house/api/print/shoppinglist/thermal?list=1&printHeader=false",
  ]);
});

test("the labels page permits a thermal printer without a label printer", async () => {
  mount({ path: "/labels" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "Shopping" }));
  await user.click(screen.getByRole("button", { name: "Thermal print" }));
  const dialog = await screen.findByRole("dialog", { name: "Print" });
  await user.click(within(dialog).getByRole("button", { name: "Thermal printer" }));
  await screen.findByText("Print request sent");
});

test("paper print choices persist and use the selected list with authenticated error feedback", async () => {
  const { fetchMock } = mount();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "Shopping list" }), "7");
  await user.click(screen.getByRole("button", { name: "Print" }));
  let dialog = await screen.findByRole("dialog", { name: "Print" });
  await user.click(within(dialog).getByRole("checkbox", { name: "Show header" }));
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Group by product group" })
        .disabled,
    ).toBe(false),
  );
  await user.click(within(dialog).getByRole("checkbox", { name: "Group by product group" }));
  const layout = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Layout type" });
  await waitFor(() => expect(layout.disabled).toBe(false));
  await user.selectOptions(layout, "list");
  await waitFor(() => expect(layout.disabled).toBe(false));
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Print" }));
  dialog = await screen.findByRole("dialog", { name: "Print" });
  expect(
    within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Show header" }).checked,
  ).toBe(false);
  expect(
    within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Group by product group" })
      .checked,
  ).toBe(false);
  expect(
    within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Layout type" }).value,
  ).toBe("list");
  await user.click(within(dialog).getByRole("button", { name: "Print" }));
  await screen.findByText("Unable to print");
  const job = fetchMock.mock.calls.find(([path]) => String(path).includes("/print?"));
  expect(job?.[0]).toBe(
    "/house/api/v2/shopping-lists/7/print?header=false&grouped=false&layout=list",
  );
  expect(new Headers(job?.[1]?.headers).get("GROCY-API-KEY")).toBe("thermal-key");
  expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
});
