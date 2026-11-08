import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import {
  NativeProductActionsScope,
  NativeProductRowActions,
} from "@/components/NativeProductRowActions";
import { Toaster } from "@/components/Toaster";
import { supportDialogs } from "./fixtures/dialogs";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

const products = [
  { id: 1, name: "Rice", active: 1 },
  { id: 7, name: "Retired rice", active: 0 },
  { id: 4, name: null, active: 1 },
];

function mountActions(
  options: {
    hold?: boolean;
    failDelete?: boolean;
    failMerge?: boolean;
    rejectAfterAbort?: boolean;
    basepath?: string;
  } = {},
) {
  supportDialogs();

  const writes: Array<{
    method: string;
    url: string;
    body: unknown;
    signal?: AbortSignal | null;
    complete: ReturnType<typeof deferred>;
  }> = [];

  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  for (const key of [
    ["native-products", "?include_disabled"],
    ["products"],
    ["stock", "overview"],
    ["recipe-view", 3],
  ])
    client.setQueryData(key, []);

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const complete = deferred();
    writes.push({
      method: init?.method ?? "GET",
      url,
      body: JSON.parse(String(init?.body)),
      signal: init?.signal,
      complete,
    });

    if (options.hold) await complete.promise;

    if (options.rejectAfterAbort && init?.signal?.aborted)
      throw new DOMException("Committed response aborted", "AbortError");

    if (options.failDelete && init?.method === "DELETE")
      return Response.json({ error_message: "Master data denied" }, { status: 403 });

    if (options.failMerge && init?.method === "POST")
      return Response.json(
        { error_message: "Stock edit denied <script>unsafe()</script>" },
        { status: 403 },
      );

    return new Response(null, { status: 204 });
  });

  vi.stubGlobal("fetch", fetchMock);
  let hideRow = () => {};

  function Page() {
    const [visible, setVisible] = useState(true);
    useEffect(() => {
      hideRow = () => setVisible(false);
    }, []);

    return (
      <NativeProductActionsScope>
        <h1>Product actions</h1>
        {visible ? (
          <NativeProductRowActions product={products[0]!} products={products} onReload={reload} />
        ) : (
          <p>Row filtered out</p>
        )}
      </NativeProductActionsScope>
    );
  }

  const root = createRootRoute({
    component: () => (
      <Toaster>
        <Outlet />
      </Toaster>
    ),
  });

  const list = createRoute({ getParentRoute: () => root, path: "/products", component: Page });

  const elsewhere = createRoute({
    getParentRoute: () => root,
    path: "/elsewhere",
    component: () => <h1>Replacement page</h1>,
  });

  const router = createRouter({
    routeTree: root.addChildren([list, elsewhere]),
    basepath: options.basepath,
    history: createMemoryHistory({
      initialEntries: [`${options.basepath ?? ""}/products?include_disabled&only_in_stock=1#saved`],
    }),
  });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
    logger.mockRestore();
  });

  return { ...app, client, router, writes, logger, reload, hideRow: () => hideRow() };
}

async function openMerge() {
  await userEvent.click(await screen.findByRole("button", { name: "Actions for Rice" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Merge" }));

  return screen.getByRole<HTMLDialogElement>("dialog", { name: "Merge products" });
}

test("selected Edit and Copy remain real configured-path anchors in the native row menu", async () => {
  mountActions({ basepath: "/house.hold" });
  expect((await screen.findByRole("link", { name: "Edit this item" })).getAttribute("href")).toBe(
    "/house.hold/product/1",
  );
  await userEvent.click(screen.getByRole("button", { name: "Actions for Rice" }));
  const copy = screen.getByRole("menuitem", { name: "Copy" });
  expect(copy.getAttribute("href")).toBe("/house.hold/product/new?copy-of=1");
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
  fireEvent(copy, click);
  expect(click.defaultPrevented).toBe(false);
});

test("Delete confirms permanent reference removal, sends a real empty-body DELETE and closes before its response", async () => {
  const app = mountActions({ hold: true });
  const button = await screen.findByRole("button", { name: "Delete this item" });
  await userEvent.click(button);
  let dialog = screen.getByRole("dialog", { name: "Delete this item" });
  expect(within(dialog).getByText('Are you sure you want to delete product "Rice"?')).toBeTruthy();
  expect(
    within(dialog).getByText(
      "This also removes any stock amount, the journal and all other references of this product - consider disabling it instead, if you want to keep that and just hide the product.",
    ),
  ).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Yes" }));
  expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "No" }));
  expect(app.writes).toEqual([]);
  await userEvent.click(button);
  dialog = screen.getByRole("dialog", { name: "Delete this item" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Yes" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.writes.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: "DELETE", url: "/api/objects/products/1", body: {} },
  ]);
  expect(app.reload).not.toHaveBeenCalled();
  await act(async () => app.writes[0]!.complete.release());
  await waitFor(() => expect(app.reload).toHaveBeenCalledTimes(1));
  expect(app.client.getQueryState(["native-products", "?include_disabled"])?.isInvalidated).toBe(
    true,
  );
  expect(app.client.getQueryState(["stock", "overview"])?.isInvalidated).toBe(true);
  expect(app.client.getQueryState(["recipe-view", 3])?.isInvalidated).toBe(true);
});

test("failed deletion is console-only, retains the catalog action and does not deactivate or reload", async () => {
  const app = mountActions({ failDelete: true });
  await userEvent.click(await screen.findByRole("button", { name: "Delete this item" }));
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(app.logger).toHaveBeenCalledTimes(1));
  expect(app.writes).toHaveLength(1);
  expect(app.writes[0]?.method).toBe("DELETE");
  expect(app.writes[0]?.body).toEqual({});
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Master data denied")).toBeNull();
  expect(screen.getByRole("button", { name: "Delete this item" })).toBeTruthy();
  expect(app.reload).not.toHaveBeenCalled();
});

test("merge validates both raw selections and includes every supplied product, including self and inactive names", async () => {
  const app = mountActions();
  const dialog = await openMerge();
  const keep = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Product to keep" });

  const remove = within(dialog).getByRole<HTMLSelectElement>("combobox", {
    name: "Product to remove",
  });

  expect(keep.value).toBe("1");
  expect(remove.value).toBe("");
  expect(Array.from(remove.options).map((option) => [option.value, option.text])).toEqual([
    ["", ""],
    ["1", "Rice"],
    ["7", "Retired rice"],
    ["4", ""],
  ]);
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(app.writes).toEqual([]);
  await userEvent.selectOptions(remove, "1");
  await userEvent.selectOptions(keep, "");
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(app.writes).toEqual([]);
  await userEvent.selectOptions(keep, "7");
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.reload).toHaveBeenCalledTimes(1));
  expect(app.writes.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: "POST", url: "/api/stock/products/7/merge/1", body: {} },
  ]);
});

test("self merge reaches the native operation and a denied merge retains both choices with inert generic error details", async () => {
  const app = mountActions({ failMerge: true });
  const dialog = await openMerge();
  await userEvent.selectOptions(
    within(dialog).getByRole("combobox", { name: "Product to remove" }),
    "1",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await screen.findByText("Error while merging");
  expect(app.writes[0]?.url).toBe("/api/stock/products/1/merge/1");
  expect(
    within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Product to keep" }).value,
  ).toBe("1");
  expect(
    within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Product to remove" }).value,
  ).toBe("1");
  await userEvent.click(screen.getByRole("button", { name: /Error while merging/ }));
  const details = await screen.findByRole("dialog", { name: "Error details" });
  expect(details.textContent).toContain("Stock edit denied <script>unsafe()</script>");
  expect(details.querySelector("script")).toBeNull();
  expect(app.reload).not.toHaveBeenCalled();
});

test("merge permits overlapping requests and Cancel/reopen changes no submitted payload or living-page callback", async () => {
  const app = mountActions({ hold: true });
  let dialog = await openMerge();
  const user = userEvent.setup();
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Product to remove" }),
    "7",
  );
  await user.click(within(dialog).getByRole("button", { name: "OK" }));
  await user.selectOptions(within(dialog).getByRole("combobox", { name: "Product to keep" }), "7");
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Product to remove" }),
    "1",
  );
  await user.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(app.writes.map((write) => write.url)).toEqual([
    "/api/stock/products/1/merge/7",
    "/api/stock/products/7/merge/1",
  ]);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  dialog = await openMerge();
  expect(
    within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Product to keep" }).value,
  ).toBe("1");
  expect(
    within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Product to remove" }).value,
  ).toBe("");
  expect(app.reload).not.toHaveBeenCalled();
  expect(app.writes.every((write) => !write.signal?.aborted)).toBe(true);
  await act(async () => app.writes[1]!.complete.release());
  await waitFor(() => expect(app.reload).toHaveBeenCalledTimes(1));
  await act(async () => app.writes[0]!.complete.release());
  await waitFor(() => expect(app.reload).toHaveBeenCalledTimes(2));
});

test.each([false, true])(
  "row unmount keeps a canceled dispatched merge owned by its living page (failure=%s)",
  async (failure) => {
    const app = mountActions({ hold: true, failMerge: failure });
    const dialog = await openMerge();
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: "Product to remove" }),
      "7",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await act(() => app.hideRow());
    expect(screen.getByText("Row filtered out")).toBeTruthy();
    expect(app.writes[0]?.signal?.aborted).toBe(false);
    await act(async () => app.writes[0]!.complete.release());

    if (failure) {
      await screen.findByText("Error while merging");
      expect(app.reload).not.toHaveBeenCalled();
    } else await waitFor(() => expect(app.reload).toHaveBeenCalledTimes(1));
  },
);

test("page departure aborts dispatched requests, suppresses old notices/reload and still invalidates uncertain committed state", async () => {
  const app = mountActions({ hold: true, rejectAfterAbort: true });
  const dialog = await openMerge();
  await userEvent.selectOptions(
    within(dialog).getByRole("combobox", { name: "Product to remove" }),
    "7",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await act(() => app.router.navigate({ href: "/elsewhere" }));
  await screen.findByRole("heading", { name: "Replacement page" });
  expect(app.writes[0]?.signal?.aborted).toBe(true);
  await act(async () => app.writes[0]!.complete.release());
  await waitFor(() => expect(app.client.getQueryState(["products"])?.isInvalidated).toBe(true));
  expect(app.client.getQueryState(["stock", "overview"])?.isInvalidated).toBe(true);
  expect(app.client.getQueryState(["recipe-view", 3])?.isInvalidated).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Error while merging")).toBeNull();
  expect(app.logger).not.toHaveBeenCalled();
  expect(app.reload).not.toHaveBeenCalled();
});
