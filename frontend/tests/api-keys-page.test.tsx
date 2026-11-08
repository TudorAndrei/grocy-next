import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { NativeApiKey } from "@/lib/native-api-keys";
import type { SystemInfo, UserSettings } from "@/lib/types";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function mountKeys(
  path = "/manageapikeys",
  options: {
    holdDelete?: boolean;
    failDelete?: boolean;
    holdCreate?: boolean;
    holdCreatesIndividually?: boolean;
    rejectAbortedDelete?: boolean;
    revokeCredential?: boolean;
    failRead?: boolean;
    basepath?: string;
  } = {},
) {
  const keys: NativeApiKey[] = [
    {
      id: 1,
      user_id: 7,
      api_key: "FIRST-SECRET",
      description: "Phone",
      key_type: "default",
      expires: "2999-12-31 23:59:59",
      last_used: null,
      row_created_timestamp: "2025-01-02 09:00:00",
    },
    {
      id: 2,
      user_id: 7,
      api_key: "CALENDAR-SECRET",
      description: "Calendar",
      key_type: "special-purpose-calendar-ical",
      expires: "2999-12-31 23:59:59",
      last_used: "2025-01-03 10:00:00",
      row_created_timestamp: "2025-01-03 09:00:00",
    },
  ];

  const settings: UserSettings = {};
  const create = deferred();
  const deletion = deferred();
  let reads = 0;
  const creations: string[] = [];

  const createReplies: Array<{ path: string; signal?: AbortSignal | null; release: () => void }> =
    [];

  const deletes: number[] = [];
  let revoked = false;
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/user" && revoked)
        return Response.json({ error_message: "Invalid API key" }, { status: 401 });

      if (url === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "test", ReleaseDate: "2026-01-01" },
          php_version: "test",
          python_version: "test",
          sqlite_version: "test",
          db_version: 1,
          os: "test",
          client: "fixture",
        } satisfies SystemInfo);

      if (url === "/api/v2/user/permissions") return Response.json({});

      if (url === "/api/user/settings") return Response.json(settings);

      if (url.startsWith("/api/user/settings/")) {
        const key = decodeURIComponent(url.slice("/api/user/settings/".length));

        if (init?.method === "DELETE") delete settings[key];
        else settings[key] = JSON.parse(String(init?.body)).value;

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/v2/access/api-keys-context")) {
        reads += 1;

        if (options.failRead)
          return Response.json({ error_message: "Key read failed" }, { status: 503 });
        const selected = new URL(url, "http://grocy.test").searchParams.get("key");

        return Response.json({
          keys,
          users: [{ id: 7, username: "owner", first_name: "Alex", last_name: "Smith" }],
          selected_key_id: selected ?? -1,
        });
      }

      if (url.startsWith("/api/v2/access/api-keys/new")) {
        creations.push(url);
        const id = 7 + creations.length;

        if (options.holdCreatesIndividually)
          await new Promise<void>((release) =>
            createReplies.push({ path: url, signal: init?.signal, release }),
          );
        else if (options.holdCreate) await create.promise;
        keys.push({
          ...keys[0]!,
          id,
          description: new URL(url, "http://grocy.test").searchParams.get("description"),
          api_key: "NEW-SECRET",
          row_created_timestamp: "2025-01-04 10:00:00",
        });

        return Response.json({ id });
      }

      if (url.startsWith("/api/objects/api_keys/") && init?.method === "DELETE") {
        const id = Number(url.split("/").at(-1));
        deletes.push(id);

        if (options.holdDelete) await deletion.promise;

        if (options.failDelete)
          return Response.json({ error_message: "Delete failed" }, { status: 403 });
        const index = keys.findIndex((key) => key.id === id);

        if (index >= 0) keys.splice(index, 1);

        if (options.revokeCredential) revoked = true;

        if (options.rejectAbortedDelete && init?.signal?.aborted)
          throw new DOMException("Response aborted after commit", "AbortError");

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    {},
    { basepath: options.basepath },
  );

  return {
    ...app,
    keys,
    settings,
    creations,
    createReplies,
    deletes,
    create,
    deletion,
    logger,
    reads: () => reads,
  };
}

async function table() {
  return screen.findByRole("table", { name: "API keys" });
}

function rowFor(table: HTMLElement, secret: string) {
  const row = within(table).getByRole("cell", { name: secret }).closest("tr");

  if (!row) throw new Error("Missing key row");

  return row;
}

function decodeQr(element: HTMLElement) {
  const svg = within(element).getByRole("img", { name: "QR-Code" });
  const dimensions = svg.getAttribute("viewBox")!.split(" ").map(Number);
  const width = dimensions[2]!;
  const height = dimensions[3]!;
  const pixels = new Uint8ClampedArray(width * height).fill(255);

  for (const rect of svg.querySelectorAll("g rect"))
    pixels[Number(rect.getAttribute("y")) * width + Number(rect.getAttribute("x"))] = 0;

  return new QRCodeReader()
    .decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))))
    .getText();
}

test("native own-key page exposes full secrets, selected raw ID, newest-first rows and saved table controls without admin grants", async () => {
  const app = mountKeys("/manageapikeys?key=%2B1");
  const list = await table();
  expect(
    within(list)
      .getAllByRole("cell")
      .find((cell) => cell.textContent === "2999-12-31 23:59:59"),
  ).toBeTruthy();
  expect(rowFor(list, "FIRST-SECRET").getAttribute("aria-selected")).toBe("true");
  expect(
    within(list)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent),
  ).toEqual(["Calendar", "Phone"]);
  expect(within(rowFor(list, "FIRST-SECRET")).getByText("never")).toBeTruthy();
  expect(within(rowFor(list, "FIRST-SECRET")).getByText("Alex Smith")).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(screen.getByRole("checkbox", { name: "API key" }));
  await waitFor(() => expect(app.settings["datatables_state_apikeys-table"]).toBeTruthy());
});

test("native delayed search, literal all and Clear filter retain full unfiltered snapshot", async () => {
  mountKeys();
  const list = await table();
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", { name: "Search" });
  await user.type(search, "Calendar");
  await waitFor(() => expect(within(list).queryByText("FIRST-SECRET")).toBeNull());
  await user.clear(search);
  await user.type(search, "all");
  await waitFor(() => expect(within(list).getByText("FIRST-SECRET")).toBeTruthy());
  await user.clear(search);
  await user.type(search, "no match");
  await waitFor(() => expect(within(list).queryByText("FIRST-SECRET")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(within(list).getByText("FIRST-SECRET")).toBeTruthy();
});

test("description modal retains Cancel draft, creates once and replaces the selected list", async () => {
  const app = mountKeys("/pantry/manageapikeys", { holdCreate: true, basepath: "/pantry" });
  await table();
  app.client.setQueryData(["api-keys"], []);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add" }));
  const modal = screen.getByRole("dialog", { name: "Create new API key" });
  const description = within(modal).getByRole("textbox", { name: "Description" });
  await waitFor(() => expect(document.activeElement).toBe(description));
  await user.type(description, "Phone + tablet");
  await user.click(within(modal).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("textbox", { name: "Description" }).getAttribute("value")).toBe(
    "Phone + tablet",
  );
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.creations).toEqual(["/api/v2/access/api-keys/new?description=Phone+%2B+tablet"]),
  );
  await act(async () => app.create.release());
  await waitFor(() => expect(app.router.history.location.pathname).toBe("/pantry/manageapikeys"));
  await waitFor(() =>
    expect(
      rowFor(screen.getByRole("table", { name: "API keys" }), "NEW-SECRET").getAttribute(
        "aria-selected",
      ),
    ).toBe("true"),
  );
  expect(app.creations).toHaveLength(1);
  expect(app.router.state.location.searchStr).toBe("?key=8");
  const previousKeys = app.client.getQueryState(["api-keys"]);
  expect(previousKeys === undefined || previousKeys.isInvalidated).toBe(true);
});

test.each(["FIRST-SECRET", "CALENDAR-SECRET"])(
  "rendered QR independently decodes the native payload for %s",
  async (secret) => {
    mountKeys();
    const list = await table();
    await userEvent.setup().click(
      within(rowFor(list, secret)).getByRole("button", {
        name: "Show a QR-Code for this API key",
      }),
    );
    const modal = screen.getByRole("dialog", { name: "API key" });
    expect(decodeQr(modal)).toBe(
      secret === "FIRST-SECRET"
        ? "http://localhost:3000/api|FIRST-SECRET"
        : "http://localhost:3000/api/calendar/ical?secret=CALENDAR-SECRET",
    );
  },
);

test("delete confirmation closes immediately and success reloads native unfiltered page", async () => {
  const app = mountKeys("/manageapikeys?key=1", { holdDelete: true });
  const list = await table();
  const user = userEvent.setup();
  await user.click(
    within(rowFor(list, "FIRST-SECRET")).getByRole("button", { name: "Delete this item" }),
  );
  const modal = screen.getByRole("dialog", { name: "Delete this item" });
  expect(within(modal).getByText('Are you sure you want to delete API key "Phone"?')).toBeTruthy();
  await user.click(within(modal).getByRole("button", { name: "Yes" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.deletes).toEqual([1]);
  await act(async () => app.deletion.release());
  await waitFor(() => expect(app.router.state.location.searchStr).toBe(""));
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "API keys" })).queryByText("FIRST-SECRET"),
    ).toBeNull(),
  );
});

test("native deletion errors only log, keep row, and permit retry", async () => {
  const app = mountKeys("/manageapikeys", { failDelete: true });
  const list = await table();
  const user = userEvent.setup();
  await user.click(
    within(rowFor(list, "FIRST-SECRET")).getByRole("button", { name: "Delete this item" }),
  );
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(within(list).getByText("FIRST-SECRET")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("deleting the sole current credential reauthenticates the native page", async () => {
  const app = mountKeys("/manageapikeys", { revokeCredential: true });
  const list = await table();
  const user = userEvent.setup();
  await user.click(
    within(rowFor(list, "FIRST-SECRET")).getByRole("button", { name: "Delete this item" }),
  );
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await screen.findByRole("button", { name: "OK" });
  expect(app.deletes).toEqual([1]);
  expect(screen.queryByRole("table", { name: "API keys" })).toBeNull();
});

test("settled deletion invalidates caches but cannot navigate after owner departure", async () => {
  const app = mountKeys("/manageapikeys?key=1", { holdDelete: true, rejectAbortedDelete: true });
  const list = await table();
  app.client.setQueryData(["api-keys"], []);
  const user = userEvent.setup();
  await user.click(
    within(rowFor(list, "FIRST-SECRET")).getByRole("button", { name: "Delete this item" }),
  );
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await act(() => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings" });
  await act(async () => app.deletion.release());
  await waitFor(() =>
    expect(app.client.getQueryState(["native-api-keys", "?key=1"])?.isInvalidated).toBe(true),
  );
  expect(app.client.getQueryState(["api-keys"])?.isInvalidated).toBe(true);
  expect(app.router.state.location.pathname).toBe("/settings");
});

test("creation URL preloading is read-only, while each subsequent real activation creates exactly one key", async () => {
  const app = mountKeys();
  await table();
  await act(() =>
    app.router.preloadRoute({ to: "/manageapikeys/new", search: { description: "Repeated" } }),
  );
  expect(app.creations).toEqual([]);
  await act(() =>
    app.router.navigate({ to: "/manageapikeys/new", search: { description: "Repeated" } }),
  );
  await waitFor(() => expect(app.router.state.location.searchStr).toBe("?key=8"));
  expect(app.creations).toHaveLength(1);
  await table();
  await act(() =>
    app.router.navigate({ to: "/manageapikeys/new", search: { description: "Repeated" } }),
  );
  await waitFor(() => expect(app.creations).toHaveLength(2));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/manageapikeys"));
});

test("same-URL creation activation retires a held result and selects only its replacement", async () => {
  const app = mountKeys("/manageapikeys/new?description=Repeated", {
    holdCreatesIndividually: true,
  });

  await waitFor(() => expect(app.createReplies).toHaveLength(1));
  expect(app.createReplies[0]!.signal?.aborted).toBe(false);
  await act(async () =>
    app.router.navigate({ to: "/manageapikeys/new", search: { description: "Repeated" } }),
  );
  await waitFor(() => expect(app.createReplies).toHaveLength(2));
  expect(app.createReplies[0]!.signal?.aborted).toBe(true);
  expect(app.creations).toEqual([
    "/api/v2/access/api-keys/new?description=Repeated",
    "/api/v2/access/api-keys/new?description=Repeated",
  ]);
  await act(async () => app.createReplies[0]!.release());
  expect(app.router.state.location.pathname).toBe("/manageapikeys/new");
  expect(app.router.state.location.searchStr).toBe("?description=Repeated");
  expect(screen.queryByRole("table", { name: "API keys" })).toBeNull();
  await act(async () => app.createReplies[1]!.release());
  await table();
  expect(app.router.state.location.pathname).toBe("/manageapikeys");
  expect(app.router.state.location.searchStr).toBe("?key=9");
  expect(app.keys.some((key) => key.id === 8)).toBe(true);
  expect(app.keys.some((key) => key.id === 9)).toBe(true);
});

test("a successful creation after departure cannot redirect the replacement page", async () => {
  const app = mountKeys("/manageapikeys/new?description=Late", { holdCreate: true });
  await waitFor(() => expect(app.creations).toHaveLength(1));
  app.client.setQueryData(["api-keys"], []);
  await act(() => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings" });
  await act(async () => app.create.release());
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(screen.queryByRole("table", { name: "API keys" })).toBeNull();
  await waitFor(() => expect(app.client.getQueryState(["api-keys"])?.isInvalidated).toBe(true));
});

test("table reset restores native columns and retires an in-flight delete callback", async () => {
  const app = mountKeys("/manageapikeys", { holdDelete: true });
  const list = await table();
  const user = userEvent.setup();
  await user.click(
    within(rowFor(list, "FIRST-SECRET")).getByRole("button", { name: "Delete this item" }),
  );
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("checkbox", { name: "API key" }));
  await waitFor(() =>
    expect(
      JSON.parse(String(app.settings["datatables_state_apikeys-table"])).columns[2].visible,
    ).toBe(false),
  );
  await user.click(within(options).getByRole("radio", { name: "Key type" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(within(list).getByRole("button", { name: "special-purpose-calendar-ical" })).toBeTruthy();
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
  await waitFor(() => expect(app.reads()).toBeGreaterThan(1));
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "API keys" })).getByText("FIRST-SECRET"),
    ).toBeTruthy(),
  );
  const reads = app.reads();
  await act(async () => app.deletion.release());
  await waitFor(() =>
    expect(app.client.getQueryState(["native-api-keys", ""])?.isInvalidated).toBe(true),
  );
  expect(app.reads()).toBe(reads);
  expect(
    within(screen.getByRole("table", { name: "API keys" })).getByText("FIRST-SECRET"),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
