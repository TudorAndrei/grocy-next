import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type {} from "vitest/jsdom";
import { createAppRouter } from "@/router";
import type { UserfieldDefinition } from "@/lib/userfields";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, Result } from "@zxing/library";
import { supportDialogs } from "./fixtures/dialogs";
import tamil from "./fixtures/tamil-localization.json";

function mount(
  kind: "chore" | "battery",
  {
    fieldFailure = false,
    dateOnly = false,
    enabled = true,
    caseDistinct = false,
    fileField = false,
    deniedPermissions = false,
    customFields,
    detailsResponse,
    primaryResponse,
    metadataResponse,
    fileFailure = false,
    selectionResponse,
    localization,
    assignments = true,
  }: {
    fieldFailure?: boolean;
    dateOnly?: boolean;
    enabled?: boolean;
    caseDistinct?: boolean;
    fileField?: boolean;
    deniedPermissions?: boolean;
    customFields?: UserfieldDefinition[];
    detailsResponse?: (
      index: number,
      request: { path: string; rawId: string; signal?: AbortSignal | null },
    ) => Response | Promise<Response> | undefined;
    primaryResponse?: (index: number) => Response | Promise<Response>;
    metadataResponse?: (body: Record<string, string>) => Response | Promise<Response>;
    fileFailure?: boolean;
    selectionResponse?: (id: number) => Response | Promise<Response>;
    localization?: typeof tamil;
    assignments?: boolean;
  } = {},
) {
  const entity = kind === "chore" ? "chores" : "batteries";
  const log = kind === "chore" ? "chores_log" : "battery_charge_cycles";

  const record = {
    id: 1,
    name: kind === "chore" ? "Water plants" : "Camera battery",
    active: 1,
    period_type: "daily",
    track_date_only: dateOnly ? 1 : 0,
    description: null,
    used_in: "Camera",
  };

  const records = [
    record,
    {
      ...record,
      id: 2,
      name: caseDistinct ? record.name.toLowerCase() : "Manual",
      period_type: "manually",
      track_date_only: 0,
    },
    { ...record, id: 3, name: "Retired", active: 0 },
  ];

  const saved: Array<{
    recordId: number;
    tracked_time: string;
    done_by?: string;
    skipped?: boolean;
    undone: boolean;
  }> = [];

  const savedFields = new Map<number, Record<string, string>>();
  const storedFiles = new Map<string, BodyInit | null | undefined>();
  const deletedFiles: string[] = [];
  let fieldWrites = 0;
  let detailReads = 0;
  let primaryWrites = 0;
  const reads: string[] = [];
  const writes: { path: string; body: Record<string, string>; signal?: AbortSignal | null }[] = [];
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (!init?.method || init.method === "GET") reads.push(path);

      if (!path.startsWith("/api/files/") && (init?.method === "POST" || init?.method === "PUT"))
        writes.push({ path, body: JSON.parse(String(init.body)), signal: init.signal });

      if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/v2/user/permissions")
        return Response.json({
          CHORE_TRACK_EXECUTION: !deniedPermissions,
          BATTERIES_TRACK_CHARGE_CYCLE: !deniedPermissions,
        });

      if (path === "/api/user") return Response.json([{ id: 1, username: "owner" }]);

      if (path === "/api/v2/chores/tracking/users")
        return Response.json([
          { id: 1, username: "owner", display_name: "Owner" },
          { id: 2, username: "helper", display_name: "Helper" },
        ]);

      if (path === "/api/system/config")
        return Response.json({
          [`FEATURE_FLAG_${entity.toUpperCase()}`]: enabled,
          FEATURE_FLAG_CHORES_ASSIGNMENTS: assignments,
        });

      if (path === "/api/user/settings") return Response.json({});

      if (path === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "" },
          php_version: "",
          python_version: "3",
          sqlite_version: "3",
          db_version: 1,
          os: "test",
          client: "test",
        });

      if (path.startsWith("/api/v2/localization"))
        return Response.json(
          localization ?? {
            locale: "en",
            direction: "ltr",
            languages: ["en"],
            catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
          },
        );

      if (path === `/api/objects/${entity}`) return Response.json(records);

      if (path === `/api/objects/${entity}/1` || path === `/api/objects/${entity}/2`)
        return selectionResponse
          ? await selectionResponse(Number(path.split("/").at(-1)))
          : Response.json(records.find((row) => path.endsWith(`/${row.id}`)));

      if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
        return Response.json(
          customFields?.map((field) => ({ ...field, entity: log })) ?? [
            ...(fileField
              ? [
                  {
                    id: 2,
                    entity: log,
                    name: "attachment",
                    caption: "Attachment",
                    type: "file",
                    input_required: 0,
                    default_value: null,
                    config: null,
                  },
                ]
              : []),
            {
              id: 1,
              entity: log,
              name: "note",
              caption: "Tracking note",
              type: "text-single-line",
              input_required: 0,
              default_value: null,
              config: null,
            },
          ],
        );

      if (
        path === `/api/${entity}/1` ||
        path === `/api/${entity}/2` ||
        path === `/api/${entity}/`
      ) {
        detailReads++;
        const rawId = path.slice(`/api/${entity}/`.length);
        const response = detailsResponse?.(detailReads, { path, rawId, signal: init?.signal });

        if (response) return await response;

        if (!rawId)
          return Response.json(
            { error_message: "Method not allowed. Must be one of: OPTIONS" },
            { status: 405 },
          );
        const selectedRecord = records.find((item) => path.endsWith(`/${item.id}`))!;
        const current = saved.filter((item) => item.recordId === selectedRecord.id && !item.undone);

        return Response.json(
          kind === "chore"
            ? {
                chore: selectedRecord,
                last_tracked: current.at(-1)?.tracked_time ?? null,
                tracked_count: current.length,
                last_done_by: null,
                average_execution_frequency_hours: null,
              }
            : {
                battery: selectedRecord,
                last_charged: current.at(-1)?.tracked_time ?? null,
                charge_cycles_count: current.length,
              },
        );
      }

      if (
        new RegExp(`^/api/${entity}/[12]/${kind === "chore" ? "execute" : "charge"}$`).test(path) &&
        init?.method === "POST"
      ) {
        primaryWrites++;

        if (deniedPermissions)
          return Response.json(
            { error_message: "Permission missing" },
            {
              status: kind === "chore" ? 400 : 403,
            },
          );

        const response = primaryResponse ? await primaryResponse(primaryWrites) : undefined;

        if (response && !response.ok) return response;
        saved.push({
          ...JSON.parse(String(init.body)),
          recordId: Number(path.split("/")[3]),
          undone: false,
        });

        return response ?? Response.json({ id: saved.length });
      }

      if (path.startsWith(`/api/userfields/${log}/`) && init?.method === "PUT") {
        fieldWrites++;

        if (metadataResponse) return await metadataResponse(JSON.parse(String(init.body)));

        if (fieldFailure && fieldWrites === 1)
          return Response.json({ error_message: "Field save failed" }, { status: 503 });
        const id = Number(path.split("/").at(-1));
        savedFields.set(id, { ...savedFields.get(id), ...JSON.parse(String(init.body)) });

        return new Response(null, { status: 204 });
      }

      if (path.startsWith("/api/files/userfiles/") && init?.method === "PUT") {
        if (fileFailure)
          return Response.json({ error_message: "Upload rejected" }, { status: 503 });
        storedFiles.set(path, init.body);

        return new Response(null, { status: 204 });
      }

      if (path.startsWith("/api/files/userfiles/") && init?.method === "DELETE") {
        deletedFiles.push(path);
        storedFiles.delete(path);

        return new Response(null, { status: 204 });
      }

      if (
        path === `/api/${kind === "chore" ? "chores/executions" : "batteries/charge-cycles"}/1/undo`
      ) {
        saved[0]!.undone = true;

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/${kind}tracking`] }),
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
    saved,
    savedFields,
    storedFiles,
    deletedFiles,
    client,
    router,
    writes,
    parent,
    unmount: app.unmount,
    fieldWrites: () => fieldWrites,
    detailReads: () => detailReads,
    reads,
  };
}

function pickerId(kind: "chore" | "battery") {
  return document.querySelector<HTMLInputElement>(`input[name="${kind}_id"]`)!.value;
}

function cardResponse(kind: "chore" | "battery", id: number, count: number) {
  const record = {
    id,
    name: id === 2 ? "Manual" : kind === "chore" ? "Water plants" : "Camera battery",
    active: 1,
    description: null,
    used_in: "Camera",
    period_type: id === 2 ? "manually" : "daily",
    track_date_only: 0,
  };

  return Response.json(
    kind === "chore"
      ? {
          chore: record,
          last_tracked: null,
          tracked_count: count,
          last_done_by: null,
          average_execution_frequency_hours: null,
        }
      : { battery: record, last_charged: null, charge_cycles_count: count },
  );
}

function cardValue(card: HTMLElement, caption: string) {
  return within(card).getByText(caption, { selector: "dt" }).parentElement!.querySelector("dd")!;
}

function expectInitialCard(card: HTMLElement, caption: string) {
  expect(within(card).getByRole("heading", { name: caption })).toBeTruthy();
  expect(within(card).getByRole("heading", { name: "" }).textContent).toBe("");

  for (const value of card.querySelectorAll("dd")) expect(value.textContent?.trim()).toBe("");

  const actions = within(card).getAllByRole<HTMLAnchorElement>("link");
  expect(actions).toHaveLength(2);

  for (const action of actions) {
    expect(action.getAttribute("href")).toBe("#");
    expect(action.classList.contains("disabled")).toBe(true);
    expect(action.tabIndex).toBe(0);
  }
}

function freezePickerClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

function documentScan(barcode: string, target?: string | null) {
  act(() => {
    document.dispatchEvent(
      new CustomEvent("Grocy.BarcodeScanned", { detail: { barcode, target } }),
    );
  });
}

function cameraDecoder() {
  supportDialogs();
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

  const track = {
    stop: vi.fn(),
    getSettings: () => ({ deviceId: "rear" }),
    getCapabilities: () => ({}),
  };

  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => stream, enumerateDevices: async () => [] },
  });
  onTestFinished(() => {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });

  type DecodeCallback = Parameters<BrowserMultiFormatReader["decodeFromVideoElement"]>[1];

  let decode: DecodeCallback | undefined;
  const controls = { stop: vi.fn() };
  vi.spyOn(BrowserMultiFormatReader.prototype, "decodeFromVideoElement").mockImplementation(
    async (_video, callback) => {
      decode = callback;

      return controls;
    },
  );

  return {
    async scan(code: string) {
      await userEvent.click(screen.getAllByRole("button", { name: /Scan with camera$/ })[0]!);
      await waitFor(() => expect(decode).toBeDefined());
      act(() =>
        decode?.(
          new Result(code, new Uint8Array(), 0, [], BarcodeFormat.CODE_128),
          undefined,
          controls,
        ),
      );
    },
    stop: track.stop,
  };
}

test.each(["chore", "battery"] as const)(
  "%s prefix blur stays uncommitted until explicit pointer selection and Save",
  async (kind) => {
    const app = mount(kind);
    const user = userEvent.setup();
    const label = kind === "chore" ? "Chore" : "Battery";
    const prefix = kind === "chore" ? "Water" : "Camera";
    const name = kind === "chore" ? "Water plants" : "Camera battery";
    const input = await screen.findByRole<HTMLInputElement>("combobox", { name: label });
    await user.type(input, prefix);
    await user.click(screen.getByLabelText("Tracked time"));
    expect(input.value).toBe(prefix);
    expect(pickerId(kind)).toBe("");
    expect(
      app.reads.filter((path) => /^\/api\/(?:objects\/)?(?:chores|batteries)\/[12]$/.test(path)),
    ).toEqual([]);
    await user.clear(input);
    await user.type(input, prefix);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.submit(input.form!);
    expect(app.saved).toEqual([]);
    await user.click(screen.getByRole("option", { name }));
    await screen.findByRole("heading", { name });
    expect(pickerId(kind)).toBe("1");
    fireEvent.change(screen.getByLabelText("Tracked time"), {
      target: { value: "2020-01-02 03:04:05" },
    });
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.saved.map((row) => row.recordId)).toEqual([1]));

    if (kind === "chore") {
      await waitFor(() => expect(input.value).toBe(""));
      expect(pickerId(kind)).toBe("1");
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true);
      await user.click(screen.getByRole("button", { name: "Chore: Clear" }));
      expect(pickerId(kind)).toBe("");
      expect(screen.queryByRole("listbox")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Chore: Show options" }));
      expect(
        within(screen.getByRole("listbox"))
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["Manual", "Water plants"]);
    }
  },
);

test.each(["chore", "battery"] as const)(
  "%s document scans filter targets and repeat same-ID native callbacks without plain-blur resets",
  async (kind) => {
    freezePickerClock();
    const primary = deferredResponse();
    const app = mount(kind, { primaryResponse: () => primary.promise });
    const user = userEvent.setup();
    const label = kind === "chore" ? "Chore" : "Battery";
    const name = kind === "chore" ? "Water plants" : "Camera battery";
    const entity = kind === "chore" ? "chores" : "batteries";
    const code = `grcy:${kind === "chore" ? "c" : "b"}:1`;
    const input = await screen.findByRole<HTMLInputElement>("combobox", { name: label });
    await user.type(input, `${name}{Enter}`);
    await screen.findByRole("heading", { name });
    const time = screen.getByLabelText<HTMLInputElement>("Tracked time");
    fireEvent.change(time, { target: { value: "2020-01-02 03:04:05" } });
    const initialCards = app.detailReads();
    const initialObjects = app.reads.filter((path) => path === `/api/objects/${entity}/1`).length;
    const focused: { raw: string; requests: number }[] = [];

    const observeFocus = () =>
      focused.push({
        raw: input.value,
        requests: app.reads.filter((path) => path === `/api/objects/${entity}/1`).length,
      });

    if (kind === "chore") input.addEventListener("focus", observeFocus);
    onTestFinished(() => input.removeEventListener("focus", observeFocus));
    await user.click(input);
    await user.click(time);
    expect(time.value).toBe("2020-01-02 03:04:05");
    expect(app.detailReads()).toBe(initialCards);
    documentScan(code.replace(":1", ":2"), "@productpicker");
    expect(input.value).toBe(name);

    for (const [index, target] of [`@${kind}picker`, "undefined", undefined, null].entries()) {
      fireEvent.change(time, { target: { value: "2020-01-02 03:04:05" } });
      const focusStart = focused.length;
      documentScan(code, target);
      await waitFor(() => expect(app.detailReads()).toBe(initialCards + index + 1));
      await waitFor(() => expect(input.value).toBe(name));
      expect(pickerId(kind)).toBe("1");
      expect(time.value).toBe(kind === "chore" ? "2030-05-06 07:08:09" : "2020-01-02 03:04:05");
      expect(app.reads.filter((path) => path === `/api/objects/${entity}/1`)).toHaveLength(
        initialObjects + (kind === "chore" ? index + 1 : 0),
      );

      if (kind === "chore")
        expect(focused.slice(focusStart)).toContainEqual({
          raw: code,
          requests: initialObjects + index,
        });
    }

    expect(app.reads).not.toContain(`/api/${entity}/2`);
    expect(app.reads).not.toContain(`/api/objects/${entity}/2`);
    expect(app.saved).toEqual([]);
    fireEvent.change(time, { target: { value: "2020-01-02 03:04:05" } });
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(
        app.writes.some((row) => row.path.endsWith(kind === "chore" ? "/execute" : "/charge")),
      ).toBe(true),
    );
    expect(input.matches(":disabled")).toBe(true);
    documentScan(code.replace(":1", ":2"), `@${kind}picker`);
    await screen.findByRole("heading", { name: "Manual" });
    expect(pickerId(kind)).toBe("2");
    expect(input.matches(":disabled")).toBe(true);
    expect(time.value).toBe(kind === "chore" ? "2030-05-06 07:08:09" : "2020-01-02 03:04:05");

    if (kind === "chore") expect(app.reads).toContain(`/api/objects/${entity}/2`);
    await act(async () => primary.release(Response.json({ id: 1 })));
    await waitFor(() => expect(app.saved.map((row) => row.recordId)).toEqual([1]));
  },
);

test.each(["chore", "battery"] as const)(
  "%s same-ID camera scan repeats the card and only Chore resets its tracked draft",
  async (kind) => {
    freezePickerClock();
    const camera = cameraDecoder();
    const app = mount(kind);
    const user = userEvent.setup();
    const name = kind === "chore" ? "Water plants" : "Camera battery";

    const input = await screen.findByRole<HTMLInputElement>("combobox", {
      name: kind === "chore" ? "Chore" : "Battery",
    });

    await user.type(input, `${name}{Enter}`);
    await screen.findByRole("heading", { name });
    const time = screen.getByLabelText<HTMLInputElement>("Tracked time");
    fireEvent.change(time, { target: { value: "2020-01-02 03:04:05" } });
    const before = app.detailReads();
    const objectPath = `/api/objects/${kind === "chore" ? "chores" : "batteries"}/1`;
    const objects = app.reads.filter((path) => path === objectPath).length;
    await camera.scan(`grcy:${kind === "chore" ? "c" : "b"}:1`);
    await waitFor(() => expect(app.detailReads()).toBe(before + 1));
    expect(pickerId(kind)).toBe("1");
    expect(time.value).toBe(kind === "chore" ? "2030-05-06 07:08:09" : "2020-01-02 03:04:05");
    expect(app.reads.filter((path) => path === objectPath)).toHaveLength(
      objects + (kind === "chore" ? 1 : 0),
    );
    expect(camera.stop).toHaveBeenCalled();
    expect(app.saved).toEqual([]);
  },
);

test.each(["chore", "battery"] as const)(
  "%s raw grcy blur clears wrong-kind, malformed, unknown and nonexact IDs",
  async (kind) => {
    const app = mount(kind);
    const user = userEvent.setup();
    const own = kind === "chore" ? "c" : "b";
    const other = kind === "chore" ? "b" : "c";

    const input = await screen.findByRole<HTMLInputElement>("combobox", {
      name: kind === "chore" ? "Chore" : "Battery",
    });

    for (const code of [
      "grcy",
      "grcy-no-parts",
      `grcy:${other}:1`,
      `grcy:${own}:999`,
      `grcy:${own}:01`,
      `grcy:${own}:1.0`,
    ]) {
      await user.type(input, code);
      await user.click(screen.getByLabelText("Tracked time"));
      expect(input.value).toBe("");
      expect(pickerId(kind)).toBe("");
    }

    expect(app.detailReads()).toBe(0);
    expect(app.saved).toEqual([]);
  },
);

test.each(["chore", "battery"] as const)(
  "%s queued document scan retires on actual route departure",
  async (kind) => {
    const app = mount(kind);

    const input = await screen.findByRole<HTMLInputElement>("combobox", {
      name: kind === "chore" ? "Chore" : "Battery",
    });

    const code = `grcy:${kind === "chore" ? "c" : "b"}:1`;
    documentScan(code, `@${kind}picker`);
    expect(input.value).toBe(code);
    await act(async () => {
      await app.router.navigate({ href: "/settings" });
    });
    expect(document.querySelector(`input[name="${kind}_id"]`)).toBeNull();
    await act(async () => {
      // Source startup scans wait 500 ms; this later barrier lets an unretired scan reach its API stage.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    });
    expect(app.detailReads()).toBe(0);
    expect(app.reads).not.toContain(`/api/objects/${kind === "chore" ? "chores" : "batteries"}/1`);
    expect(app.saved).toEqual([]);
  },
);

test("an open Chore menu commits on Tab keyup and a later closed-menu Enter books the selected record", async () => {
  const app = mount("chore");
  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Chore" });
  await user.type(input, "Water");
  expect(screen.getByRole("listbox")).toBeTruthy();
  await user.keyboard("{Tab>}");
  expect(pickerId("chore")).toBe("");
  expect(app.saved).toEqual([]);
  await user.keyboard("{/Tab}");
  await screen.findByRole("heading", { name: "Water plants" });
  expect(pickerId("chore")).toBe("1");
  fireEvent.change(screen.getByLabelText("Tracked time"), {
    target: { value: "2020-01-02 03:04:05" },
  });
  await user.click(input);
  await user.keyboard("{Enter>}");
  await waitFor(() => expect(app.saved.map((row) => row.recordId)).toEqual([1]));
  await user.keyboard("{/Enter}");
  expect(app.saved).toHaveLength(1);
});

test("Chore menu scrolling detaches raw-code blur resolution after Escape restores ordinary blur", async () => {
  const app = mount("chore");
  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Chore" });
  await user.type(input, "Water");
  const menu = screen.getByRole("listbox", { name: "Chores" });
  await user.pointer({ target: menu, keys: "[MouseLeft]" });
  await user.click(input);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  await user.clear(input);
  await user.type(input, "grcy:c:1");
  await user.click(screen.getByLabelText("Tracked time"));
  expect(input.value).toBe("grcy:c:1");
  expect(pickerId("chore")).toBe("");
  await user.click(input);
  await user.click(screen.getByLabelText("Tracked time"));
  expect(input.value).toBe("grcy:c:1");
  expect(pickerId("chore")).toBe("");
  expect(app.detailReads()).toBe(0);
  expect(app.reads).not.toContain("/api/objects/chores/1");
  expect(app.saved).toEqual([]);
});

test("programmatic Chore keyup can show a menu during a real held booking without changing its captured target", async () => {
  const primary = deferredResponse();
  const app = mount("chore", { primaryResponse: () => primary.promise });
  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Chore" });
  await user.type(input, "Water plants{Enter}");
  await screen.findByRole("heading", { name: "Water plants" });
  fireEvent.change(screen.getByLabelText("Tracked time"), {
    target: { value: "2020-01-02 03:04:05" },
  });
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/execute"))).toBe(true));
  expect(input.matches(":disabled")).toBe(true);
  // These are programmatic source events, not natural typing into a disabled control.
  fireEvent.change(input, { target: { value: "Man" } });
  fireEvent.keyUp(input, { key: "n", keyCode: 78 });
  expect(screen.getByRole("listbox", { name: "Chores" })).toBeTruthy();
  expect(input.closest("form")?.querySelector(".combobox-menu-visible")).toBeTruthy();
  fireEvent.keyUp(input, { key: "Enter", keyCode: 13 });
  await screen.findByRole("heading", { name: "Manual" });
  expect(pickerId("chore")).toBe("2");
  expect(input.matches(":disabled")).toBe(true);
  expect(app.saved).toEqual([]);
  await act(async () => primary.release(Response.json({ id: 1 })));
  await waitFor(() => expect(app.saved.map((row) => row.recordId)).toEqual([1]));
  expect(app.writes.filter((row) => row.path.endsWith("/execute"))).toHaveLength(1);
});

test.each(["chore", "battery"] as const)(
  "native %s tracking records an entered time and custom fields, then supports Undo",
  async (kind) => {
    const app = mount(kind);
    const user = userEvent.setup();
    await screen.findByRole("heading", {
      name: kind === "chore" ? "Chore tracking" : "Battery tracking",
      level: 1,
    });

    const input = await screen.findByRole<HTMLInputElement>("combobox", {
      name: kind === "chore" ? "Chore" : "Battery",
    });

    await user.type(input, `grcy:${kind === "chore" ? "c" : "b"}:1`);
    await user.click(screen.getByLabelText("Tracked time"));
    await screen.findByRole("heading", {
      name: kind === "chore" ? "Water plants" : "Camera battery",
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Tracked time")));
    fireEvent.change(screen.getByLabelText("Tracked time"), {
      target: { value: "2020-01-02T03:04:05" },
    });

    if (kind === "chore") {
      await user.clear(screen.getByRole("combobox", { name: "Done by" }));
      await user.type(screen.getByRole("combobox", { name: "Done by" }), "Helper{Enter}");
    }

    await user.type(screen.getByLabelText("Tracking note"), "After work");

    const action = screen.getByRole<HTMLButtonElement>("button", {
      name: kind === "chore" ? "Skip" : "OK",
    });

    await waitFor(() => expect(action.disabled).toBe(false));
    await user.click(action);
    await screen.findByText(
      new RegExp(
        kind === "chore"
          ? "Tracked execution of chore Water plants"
          : "Tracked charge cycle of battery Camera battery",
      ),
    );
    expect(app.saved).toHaveLength(1);
    expect(app.saved[0]?.tracked_time).toBe("2020-01-02 03:04:05");

    if (kind === "chore") expect(app.saved[0]).toMatchObject({ done_by: "2", skipped: true });
    expect(app.fieldWrites()).toBe(1);
    expect(input.value).toBe("");

    const overview = within(
      screen.getByRole("region", {
        name: kind === "chore" ? "Chore overview" : "Battery overview",
      }),
    );

    await overview.findByText("1");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(app.saved[0]?.undone).toBe(true));
    await screen.findByText(
      kind === "chore" ? "Chore execution successfully undone" : "Charge cycle successfully undone",
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull());
    expect(overview.getByText("1")).toBeTruthy();
  },
);

test("date-only chores retain their format after reset and manual Skip gets its native CSS class", async () => {
  const app = mount("chore", { dateOnly: true });
  const user = userEvent.setup();
  const input = await screen.findByRole("combobox", { name: "Chore" });
  await user.type(input, "Water plants{Enter}");
  const time = screen.getByLabelText<HTMLInputElement>("Tracked time");
  await waitFor(() => expect(time.classList.contains("date-only-datetimepicker")).toBe(true));
  expect(time.type).toBe("text");
  fireEvent.change(time, { target: { value: "2020-01-02" } });
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.saved).toHaveLength(1));
  expect(app.saved[0]?.tracked_time).toBe("2020-01-02");
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>("combobox", { name: "Chore" }).value).toBe(""),
  );
  expect(time.classList.contains("date-only-datetimepicker")).toBe(true);
  expect(time.type).toBe("text");
  await user.type(input, "Manual{Enter}");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Skip" }).classList.contains("disabled")).toBe(true),
  );
});

test("future battery dates cannot be recorded", async () => {
  const app = mount("battery");
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("combobox", { name: "Battery" }),
    "Camera battery{Enter}",
  );
  const time = screen.getByLabelText("Tracked time");
  fireEvent.input(time, { target: { value: "2999-01-02 03:04:05" } });
  fireEvent.keyUp(time, { key: "5" });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true);
  expect(app.saved).toHaveLength(0);
});

test("native chore tracking reads a selected chore with its module disabled", async () => {
  const app = mount("chore", { enabled: false });
  await userEvent.type(
    await screen.findByRole("combobox", { name: "Chore" }),
    "Water plants{Enter}",
  );
  await screen.findByRole("heading", { name: "Water plants" });
  expect(app.saved).toEqual([]);
});

test("a read-only user reaches native denied writes and retains its draft after console-only recovery", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("chore", { deniedPermissions: true });
  const user = userEvent.setup();
  await user.type(await screen.findByRole("combobox", { name: "Chore" }), "Water plants{Enter}");
  await screen.findByRole("heading", { name: "Water plants" });
  fireEvent.change(screen.getByLabelText("Tracked time"), {
    target: { value: "2020-01-02T03:04:05" },
  });
  const submit = screen.getByRole<HTMLButtonElement>("button", { name: "OK" });
  const skip = screen.getByRole<HTMLButtonElement>("button", { name: "Skip" });
  expect(submit.disabled).toBe(false);
  expect(skip.disabled).toBe(false);
  await user.click(submit);
  await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
  await user.click(skip);
  await waitFor(() => expect(errors).toHaveBeenCalledTimes(2));
  expect(
    app.writes.filter((row) => row.path.endsWith("/execute")).map((row) => row.body.skipped),
  ).toEqual([false, true]);
  expect(screen.queryByText("Permission missing")).toBeNull();
  expect(app.saved).toHaveLength(0);
});

test.each(["chore", "battery"] as const)(
  "%s tracking accepts a zero-second time and saves canonical seconds",
  async (kind) => {
    const app = mount(kind);
    const user = userEvent.setup();

    const input = await screen.findByRole<HTMLInputElement>("combobox", {
      name: kind === "chore" ? "Chore" : "Battery",
    });

    await user.type(input, `${kind === "chore" ? "Water plants" : "Camera battery"}{Enter}`);
    const time = screen.getByLabelText<HTMLInputElement>("Tracked time");
    fireEvent.change(time, { target: { value: "2020-01-02 03:04:00" } });
    expect(time.value).toBe("2020-01-02 03:04:00");
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.saved).toHaveLength(1));
    expect(app.saved[0]?.tracked_time).toBe("2020-01-02 03:04:00");
    await waitFor(() => expect(input.value).toBe(""));
  },
);

test("ranked Enter and explicit case-distinct pointer selection book their actual supplied records", async () => {
  const app = mount("battery", { caseDistinct: true });
  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Battery" });

  for (const [index, name] of ["Camera battery", "camera battery"].entries()) {
    await user.type(input, "camera battery");
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Camera battery", "camera battery"]);

    if (index === 0) {
      await user.keyboard("{Enter>}");
      expect(pickerId("battery")).toBe("");
      expect(app.saved).toEqual([]);
      await user.keyboard("{/Enter}");
    } else await user.click(screen.getByRole("option", { name: "camera battery" }));
    await screen.findByRole("heading", { name });
    fireEvent.change(screen.getByLabelText("Tracked time"), {
      target: { value: "2020-01-02T03:04:05" },
    });
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(input.value).toBe(""));
  }

  expect(app.saved.map((booking) => booking.recordId)).toEqual([1, 2]);
});

test("retained tracking Files get fresh metadata for each count and their unloaded trash stays inert", async () => {
  const app = mount("chore", { fileField: true });
  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Chore" });
  const upload = new File(["Watering notes"], "Notes.txt", { type: "text/plain" });
  await user.upload(screen.getByLabelText("Attachment"), upload);

  for (let count = 1; count <= 2; count++) {
    await user.type(input, "Water plants{Enter}");
    fireEvent.change(screen.getByLabelText("Tracked time"), {
      target: { value: "2020-01-02T03:04:05" },
    });
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(input.value).toBe(""));
    expect(app.saved).toHaveLength(count);
  }

  const first = app.savedFields.get(1)?.attachment;
  const second = app.savedFields.get(2)?.attachment;
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);

  const attachmentPath = (value: string) =>
    `/api/files/userfiles/${encodeURIComponent(value.split("_")[0]!)}`;

  const firstPath = attachmentPath(first!);
  const secondPath = attachmentPath(second!);
  expect([...app.storedFiles.keys()]).toEqual([firstPath, secondPath]);
  expect(app.storedFiles.get(firstPath)).toBe(upload);
  expect(app.storedFiles.get(secondPath)).toBe(upload);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.type(input, "Water plants{Enter}");
  fireEvent.change(screen.getByLabelText("Tracked time"), {
    target: { value: "2020-01-02T03:04:05" },
  });
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(input.value).toBe(""));
  expect(app.saved).toHaveLength(3);
  const third = app.savedFields.get(3)?.attachment;
  expect(third).toBeTruthy();
  expect(third).not.toBe(first);
  expect(third).not.toBe(second);
  expect(app.savedFields.get(1)?.attachment).toBe(first);
  expect(app.savedFields.get(2)?.attachment).toBe(second);
  expect(app.deletedFiles).toEqual([]);
  expect([...app.storedFiles.keys()]).toEqual([firstPath, secondPath, attachmentPath(third!)]);
});

function deferredResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function customField(id: number, name: string, type = "text-single-line"): UserfieldDefinition {
  return {
    id,
    name,
    caption: name,
    type,
    input_required: 0,
    default_value: null,
    config: null,
  };
}

test.each(["chore", "battery"] as const)(
  "%s fields retain the native unloaded defaults and checkbox validity",
  async (kind) => {
    const app = mount(kind, {
      customFields: [
        { ...customField(10, "now date", "date"), default_value: "now" },
        { ...customField(11, "acknowledge", "checkbox"), input_required: 1 },
      ],
    });

    const checkbox = await screen.findByLabelText<HTMLInputElement>("acknowledge");
    expect(screen.getByLabelText<HTMLInputElement>("now date").value).toBe("");
    expect(checkbox.required).toBe(true);
    expect(checkbox.indeterminate).toBe(false);
    const user = userEvent.setup();
    await user.click(checkbox);
    await user.click(checkbox);
    expect(checkbox.required).toBe(true);
    expect(checkbox.validity.valueMissing).toBe(true);
    expect(app.saved).toEqual([]);
  },
);

test.each(["chore", "battery"] as const)(
  "%s uses live GET/POST/receipt stages and completes on the last parallel field",
  async (kind) => {
    const details = deferredResponse(),
      primary = deferredResponse(),
      first = deferredResponse(),
      last = deferredResponse();

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = mount(kind, {
      customFields: [
        customField(10, "arrow"),
        customField(11, "notes", "text-multi-line"),
        customField(12, "clean"),
      ],
      detailsResponse: (index) => (index === 2 ? details.promise : undefined),
      primaryResponse: () => primary.promise,
      metadataResponse: (body) => ("arrow" in body ? first.promise : last.promise),
    });

    const user = userEvent.setup();

    const input = await screen.findByRole<HTMLInputElement>("combobox", {
      name: kind === "chore" ? "Chore" : "Battery",
    });

    await user.type(input, `${kind === "chore" ? "Water plants" : "Camera battery"}{Enter}`);
    await screen.findByRole("heading", {
      name: kind === "chore" ? "Water plants" : "Camera battery",
    });
    const time = screen.getByLabelText<HTMLInputElement>("Tracked time");
    await waitFor(() => expect(document.activeElement).toBe(time));
    fireEvent.change(time, { target: { value: "2020-01-02T03:04:05" } });
    const arrow = screen.getByLabelText<HTMLInputElement>("arrow");
    arrow.focus();
    await user.keyboard("{ArrowLeft}");
    const notes = screen.getByLabelText<HTMLTextAreaElement>("notes");
    await user.type(notes, "Before primary");
    await user.click(screen.getByRole("button", { name: kind === "chore" ? "Skip" : "OK" }));
    expect(app.saved).toEqual([]);
    expect(time.matches(":disabled")).toBe(true);
    // Controlled disabled assignments isolate native callback reads, not user typing.
    time.value = "2020-02-03 04:05:06";
    const doneBy = document.querySelector<HTMLInputElement>('input[name="user_id"]');

    if (kind === "chore" && doneBy) doneBy.value = "2";

    const record = {
      id: 1,
      name: "Fresh details name",
      active: 1,
      description: null,
      period_type: "daily",
      track_date_only: 0,
    };

    await act(async () =>
      details.release(
        Response.json(
          kind === "chore"
            ? {
                chore: record,
                last_tracked: null,
                tracked_count: 0,
                last_done_by: null,
                average_execution_frequency_hours: null,
              }
            : { battery: record, last_charged: null, charge_cycles_count: 0 },
        ),
      ),
    );
    await waitFor(() =>
      expect(
        app.writes.some((row) => row.path.endsWith(kind === "chore" ? "/execute" : "/charge")),
      ).toBe(true),
    );

    const body = app.writes.find((row) =>
      row.path.endsWith(kind === "chore" ? "/execute" : "/charge"),
    )!.body;

    expect(body.tracked_time).toBe("2020-02-03 04:05:06");

    if (kind === "chore") expect(body).toMatchObject({ done_by: "2", skipped: true });
    notes.value = "Live\r\nCustom LF";
    await act(async () => primary.release(Response.json({ id: 1 })));
    await waitFor(() => expect(app.fieldWrites()).toBe(2));
    expect(
      app.writes.filter((row) => row.path.includes("/userfields/")).map((row) => row.body),
    ).toEqual([{ arrow: "" }, { notes: "Live\nCustom LF" }]);
    expect(input.value).not.toBe("");
    time.value = "2020-03-04 05:06:07";
    await act(async () => last.release(new Response(null, { status: 204 })));
    await waitFor(() => expect(input.value).toBe(""));
    await screen.findByText(/Fresh details name on 2020-03-04 05:06:07/);
    expect(notes.value).toBe("Live\nCustom LF");
    expect(app.parent).not.toHaveBeenCalled();
    await act(async () =>
      first.release(Response.json({ error_message: "Earlier rejected" }, { status: 503 })),
    );
    expect(screen.queryByText("Earlier rejected")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    expect(app.saved).toHaveLength(1);
  },
);

test.each(["metadata", "file"] as const)(
  "last tracking %s failure keeps the committed count busy without partial Retry",
  async (failure) => {
    const app = mount("battery", {
      fieldFailure: failure === "metadata",
      fileField: failure === "file",
      fileFailure: failure === "file",
    });

    const user = userEvent.setup();
    const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Battery" });
    await user.type(input, "Camera battery{Enter}");
    await screen.findByRole("heading", { name: "Camera battery" });

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Tracked time")));

    if (failure === "file")
      await user.upload(
        screen.getByLabelText("Attachment"),
        new File(["Retained bytes"], "Count.txt", { type: "text/plain" }),
      );
    else await user.type(screen.getByLabelText("Tracking note"), "Retained note");
    fireEvent.change(screen.getByLabelText("Tracked time"), {
      target: { value: "2020-01-02T03:04:05" },
    });
    expect(
      screen.getByRole<HTMLFormElement>("form", { name: "Battery tracking" }).checkValidity(),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.saved).toHaveLength(1));
    await waitFor(() => expect(app.fieldWrites()).toBe(1));

    if (failure === "file") await screen.findByRole("button", { name: /Error while saving/ });
    expect(input.matches(":disabled")).toBe(true);
    expect(screen.queryByText("Field save failed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/Tracked charge cycle/)).toBeNull();
  },
);

test.each(["GET", "POST"] as const)(
  "primary tracking %s failure logs, unlocks, and a fresh Save executes the draft once",
  async (stage) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = mount("battery", {
      detailsResponse: (index) =>
        stage === "GET" && index === 2
          ? Response.json({ error_message: "Primary refused" }, { status: 503 })
          : undefined,
      primaryResponse: (index) =>
        stage === "POST" && index === 1
          ? Response.json({ error_message: "Primary refused" }, { status: 503 })
          : Response.json({ id: 1 }),
    });

    const user = userEvent.setup();
    const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Battery" });
    await user.type(input, "Camera battery{Enter}");
    await screen.findByRole("heading", { name: "Camera battery" });
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(errors).toHaveBeenCalledOnce());
    expect(input.matches(":disabled")).toBe(false);
    expect(input.value).toBe("Camera battery");
    expect(screen.queryByText("Primary refused")).toBeNull();
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(input.value).toBe(""));
    expect(app.saved).toHaveLength(1);
    expect(app.writes.filter((row) => row.path.endsWith("/charge"))).toHaveLength(
      stage === "POST" ? 2 : 1,
    );
    expect(app.detailReads()).toBeGreaterThanOrEqual(3);
  },
);

test("a retired tracking details callback cannot start a count", async () => {
  const details = deferredResponse();

  const app = mount("battery", {
    detailsResponse: (index) => (index === 2 ? details.promise : undefined),
  });

  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("combobox", { name: "Battery" }),
    "Camera battery{Enter}",
  );
  await screen.findByRole("heading", { name: "Camera battery" });
  await user.click(screen.getByRole("button", { name: "OK" }));
  expect(app.detailReads()).toBe(2);
  app.unmount();
  await act(async () =>
    details.release(
      Response.json({
        battery: { id: 1, name: "Camera battery", active: 1, description: null },
        last_charged: null,
        charge_cycles_count: 0,
      }),
    ),
  );
  expect(app.saved).toEqual([]);
  expect(app.writes).toEqual([]);
  expect(app.parent).not.toHaveBeenCalled();
});

test("an earlier Chore selection response can install date-only format on the current picker", async () => {
  const earlier = deferredResponse();
  mount("chore", {
    selectionResponse: (id) =>
      id === 1 ? earlier.promise : Response.json({ track_date_only: 0, period_type: "manually" }),
  });
  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Chore" });
  await user.type(input, "Water plants{Enter}");
  await screen.findByRole("heading", { name: "Water plants" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Tracked time")));
  await user.clear(input);
  await user.type(input, "Manual{Enter}");
  await screen.findByRole("heading", { name: "Manual" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Skip" }).classList.contains("disabled")).toBe(true),
  );
  await act(async () =>
    earlier.release(Response.json({ track_date_only: 1, period_type: "daily" })),
  );
  await waitFor(() =>
    expect(
      screen
        .getByLabelText<HTMLInputElement>("Tracked time")
        .classList.contains("date-only-datetimepicker"),
    ).toBe(true),
  );
  expect(input.value).toBe("Manual");
  expect(screen.getByRole("button", { name: "Skip" }).classList.contains("disabled")).toBe(false);
});

test.each(["chore", "battery"] as const)(
  "%s Card replies overwrite the shared display in completion order while selection stays current",
  async (kind) => {
    const earlier = deferredResponse();
    const later = deferredResponse();
    const entity = kind === "chore" ? "chores" : "batteries";

    const app = mount(kind, {
      detailsResponse: (_index, request) =>
        request.rawId === "1" ? earlier.promise : later.promise,
    });

    const user = userEvent.setup();

    const input = await screen.findByRole<HTMLInputElement>("combobox", {
      name: kind === "chore" ? "Chore" : "Battery",
    });

    const firstName = kind === "chore" ? "Water plants" : "Camera battery";
    await user.type(input, `${firstName}{Enter}`);
    await waitFor(() => expect(app.reads).toContain(`/api/${entity}/1`));
    await user.clear(input);
    await user.type(input, "Manual{Enter}");
    await waitFor(() => expect(app.reads).toContain(`/api/${entity}/2`));
    // The fixture transport deliberately delivers both replies, even after abort.
    await act(async () => later.release(cardResponse(kind, 2, 22)));

    const card = screen.getByRole("region", {
      name: kind === "chore" ? "Chore overview" : "Battery overview",
    });

    await within(card).findByRole("heading", { name: "Manual" });
    expect(within(card).getByText("22")).toBeTruthy();
    expect(
      within(card)
        .getByRole("link", { name: /journal$/ })
        .getAttribute("href"),
    ).toContain(`${kind}=2`);
    await act(async () => earlier.release(cardResponse(kind, 1, 11)));
    await within(card).findByRole("heading", { name: firstName });
    expect(within(card).getByText("11")).toBeTruthy();
    expect(
      within(card)
        .getByRole("link", { name: /journal$/ })
        .getAttribute("href"),
    ).toContain(`${kind}=1`);
    expect(input.value).toBe("Manual");
    expect(pickerId(kind)).toBe("2");
  },
);

test("warm repeated Battery Card reads remain independent and retire with the document", async () => {
  const first = deferredResponse();
  const second = deferredResponse();
  const retired = deferredResponse();
  const signals: Array<AbortSignal | null | undefined> = [];
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mount("battery", {
    detailsResponse: (index, request) => {
      signals.push(request.signal);

      return [undefined, first.promise, second.promise, retired.promise][index - 1];
    },
  });

  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("combobox", { name: "Battery" }),
    "Camera battery{Enter}",
  );
  const card = screen.getByRole("region", { name: "Battery overview" });
  await within(card).findByRole("heading", { name: "Camera battery" });
  documentScan("grcy:b:1", "@batterypicker");
  await waitFor(() => expect(app.detailReads()).toBe(2));
  documentScan("grcy:b:1", "@batterypicker");
  await waitFor(() => expect(app.detailReads()).toBe(3));
  await act(async () => second.release(cardResponse("battery", 1, 30)));
  await within(card).findByText("30");
  await act(async () => first.release(cardResponse("battery", 1, 20)));
  await within(card).findByText("20");
  documentScan("grcy:b:1", "@batterypicker");
  await waitFor(() => expect(app.detailReads()).toBe(4));
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings", level: 1 });
  expect(signals[3]?.aborted).toBe(true);
  await act(async () => retired.release(cardResponse("battery", 1, 40)));
  expect(screen.queryByRole("region", { name: "Battery overview" })).toBeNull();
  expect(errors).not.toHaveBeenCalled();
  expect(app.parent).not.toHaveBeenCalled();
});

test("a failed Battery Card refresh logs and retains its prior content without a Retry panel", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  mount("battery", {
    detailsResponse: (index) =>
      index === 1
        ? cardResponse("battery", 1, 17)
        : Response.json({ error_message: "Card refresh refused" }, { status: 503 }),
  });
  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Battery" });
  await user.type(input, "Camera battery{Enter}");
  const card = screen.getByRole("region", { name: "Battery overview" });
  await within(card).findByText("17");
  const journal = within(card).getByRole("link", { name: "Battery journal" }).getAttribute("href");
  documentScan("grcy:b:1", "@batterypicker");
  await waitFor(() => expect(errors).toHaveBeenCalledOnce());
  expect(within(card).getByRole("heading", { name: "Camera battery" })).toBeTruthy();
  expect(within(card).getByText("17")).toBeTruthy();
  expect(within(card).getByRole("link", { name: "Battery journal" }).getAttribute("href")).toBe(
    journal,
  );
  expect(screen.queryByText("Card refresh refused")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(input.value).toBe("Camera battery");
  expect(input.matches(":disabled")).toBe(false);
});

test.each([
  { name: "root 405 JSON method error", status: 405 },
  { name: "500 HTML method error transport", status: 500 },
  { name: "explicit malformed 200 LIST success transport", status: 200 },
])("the last tracking field refreshes a literal empty Card ID: $name", async ({ status }) => {
  // Vitest aliases window to Node's global; retain JSDOM's real browser error reporter.
  vi.stubGlobal("window", jsdom.window);
  const metadata = deferredResponse();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const callbackErrors: ErrorEvent[] = [];

  const captureError = (event: ErrorEvent) => {
    callbackErrors.push(event);
    event.preventDefault();
  };

  window.addEventListener("error", captureError);
  onTestFinished(() => window.removeEventListener("error", captureError));

  const app = mount("battery", {
    metadataResponse: () => metadata.promise,
    detailsResponse: (_index, { rawId }) => {
      if (rawId || status === 405) return undefined;

      if (status === 500)
        return new Response("<!DOCTYPE html><html><body>Method not allowed</body></html>", {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });

      // Deliberately malformed successful Card details, not the current empty endpoint.
      return Response.json([{ id: 1, battery: { id: 1, name: "Camera battery" } }]);
    },
  });

  const user = userEvent.setup();
  const input = await screen.findByRole<HTMLInputElement>("combobox", { name: "Battery" });
  await user.type(input, "Camera battery{Enter}");
  const card = screen.getByRole("region", { name: "Battery overview" });
  await within(card).findByRole("heading", { name: "Camera battery" });
  await user.type(screen.getByLabelText("Tracking note"), "Receipt boundary");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.fieldWrites()).toBe(1));
  expect(app.saved.map((row) => row.recordId)).toEqual([1]);
  expect(input.matches(":disabled")).toBe(true);
  // Programmatic ordinary keyup clears the live source ID during the held callback.
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.keyUp(input, { key: "Backspace", keyCode: 8 });
  await act(async () => metadata.release(new Response(null, { status: 204 })));
  await waitFor(() => expect(app.reads).toContain("/api/batteries/"));

  if (status === 200) {
    await waitFor(() => expect(callbackErrors).toHaveLength(1));
    expect(callbackErrors[0].error).toBeInstanceOf(Error);
    expect(errors).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(errors).toHaveBeenCalledOnce());
    expect(errors.mock.calls[0]?.[0]).toMatchObject({ status });
    expect(callbackErrors).toEqual([]);
  }

  expect(within(card).getByRole("heading", { name: "Camera battery" })).toBeTruthy();
  expect(within(card).getByText("0")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(input.value).toBe("");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true);
  expect(app.writes.filter((row) => row.path.endsWith("/charge"))).toHaveLength(1);
  expect(
    app.writes.find((row) => row.path === "/api/userfields/battery_charge_cycles/1")?.body,
  ).toEqual({ note: "Receipt boundary" });
  expect(screen.getByText(/Tracked charge cycle of battery Camera battery/)).toBeTruthy();
});

test("Chore Card renders safe source HTML and callback-time Tamil dates from blank through cleared values", async () => {
  freezePickerClock();
  const first = deferredResponse();
  const second = deferredResponse();
  const third = deferredResponse();
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});

  // Pinned localization/ta/strings.po at 21aa5eab: the Card uses lowercase "never".
  const localization = {
    ...tamil,
    catalog: {
      ...tamil.catalog,
      messages: { "": { ...tamil.catalog.messages[""], never: ["ஒருபோதும் இல்லை"] } },
    },
  };

  const app = mount("chore", {
    localization,
    assignments: true,
    deniedPermissions: true,
    detailsResponse: (index) => [first.promise, second.promise, third.promise][index - 1],
  });

  const user = userEvent.setup();
  const input = await screen.findByRole("combobox", { name: "Chore" });
  const card = screen.getByRole("region", { name: "Chore overview" });
  expectInitialCard(card, "Chore overview");
  await user.type(input, "Water plants{Enter}");
  await waitFor(() => expect(app.detailReads()).toBe(1));
  expectInitialCard(card, "Chore overview");
  const raw = "௨௦௩௦-௦௫-௦௬ ௦௭:௦௮:௦௯";

  const record = {
    id: 1,
    name: "Name <em>literal</em>",
    active: 1,
    description:
      "<strong>Room</strong>\r\nLine2\n\rLine3\rLine4\nLine5<br>\nTail<script>void 0</script>",
    track_date_only: 1,
  };

  await act(async () =>
    first.release(
      Response.json({
        chore: record,
        last_tracked: raw,
        tracked_count: 0,
        last_done_by: { id: 2, username: "helper", display_name: "Helper" },
        average_execution_frequency_hours: 24,
      }),
    ),
  );
  const name = await within(card).findByRole("heading", { name: "Name <em>literal</em>" });
  expect(name.querySelector("em")).toBeNull();
  const description = within(card).getByText("Room", { selector: "strong" }).parentElement!;
  expect(description.querySelectorAll("br")).toHaveLength(6);
  expect(description.querySelector("script")).toBeNull();
  expect(description.textContent).toBe("Room\nLine2\n\nLine3\nLine4\nLine5\nTail");
  expect(cardValue(card, "Tracked count").textContent).toBe("0");
  expect(cardValue(card, "Average execution frequency").textContent).toBe("ஒரு நாள்");
  expect(cardValue(card, "Last done by").textContent).toBe("Helper");
  const time = card.querySelector("time")!;
  expect(time.getAttribute("datetime")).toBe(raw);
  expect(time.classList.contains("timeago-date-only")).toBe(true);
  expect(time.textContent).toBe("இன்று");
  expect(within(cardValue(card, "Last tracked")).getByText("௨௦௩௦-௦௫-௦௬")).toBeTruthy();
  const edit = within(card).getByRole<HTMLAnchorElement>("link", { name: "Edit chore" });
  expect(edit.getAttribute("href")).toBe("/chore/1");
  expect(edit.classList.contains("disabled")).toBe(false);
  expect(within(card).getByRole("link", { name: "Chore journal" }).getAttribute("href")).toBe(
    "/choresjournal?embedded&chore=1",
  );
  // A new render after the clock changes must retain the last callback's relative text.
  vi.setSystemTime(new Date(2030, 4, 7, 7, 8, 9));
  await user.type(screen.getByLabelText("Tracking note"), "Unrelated draft");
  expect(time.textContent).toBe("இன்று");
  documentScan("grcy:c:2", "@chorepicker");
  await waitFor(() => expect(app.detailReads()).toBe(2));
  const nextRaw = "௨௦௩௦-௦௫-௦௭ ௦௭:௦௮:௦௯";
  await act(async () =>
    second.release(
      Response.json({
        chore: { ...record, id: 2, name: "Full time", description: null, track_date_only: 0 },
        last_tracked: nextRaw,
        tracked_count: 2,
        last_done_by: null,
        average_execution_frequency_hours: null,
      }),
    ),
  );
  await within(card).findByRole("heading", { name: "Full time" });
  expect(description.textContent).toBe("");
  expect(time.classList.contains("timeago-date-only")).toBe(false);
  expect(time.getAttribute("datetime")).toBe(nextRaw);
  expect(within(cardValue(card, "Last tracked")).getByText(nextRaw)).toBeTruthy();
  expect(cardValue(card, "Last done by").textContent).toBe("Unknown");
  expect(cardValue(card, "Average execution frequency").textContent).toBe("Unknown");
  documentScan("grcy:c:2", "@chorepicker");
  await waitFor(() => expect(app.detailReads()).toBe(3));
  await act(async () =>
    third.release(
      Response.json({
        chore: {
          ...record,
          id: 2,
          name: "No previous tracking",
          description: null,
          track_date_only: 0,
        },
        last_tracked: null,
        tracked_count: 0,
        last_done_by: null,
        average_execution_frequency_hours: 0,
      }),
    ),
  );
  await within(card).findByRole("heading", { name: "No previous tracking" });
  expect(cardValue(card, "Last tracked").textContent?.trim()).toBe("ஒருபோதும் இல்லை");
  expect(time.getAttribute("datetime")).toBe("");
  expect(time.textContent).toBe("");
  expect(cardValue(card, "Average execution frequency").textContent).not.toBe("Unknown");
  expect(warnings).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
});

test("Battery Card keeps Used in as text and contextual sentinel dates after blank disabled actions", async () => {
  const first = deferredResponse();
  const second = deferredResponse();

  const app = mount("battery", {
    deniedPermissions: true,
    detailsResponse: (index) => (index === 1 ? first.promise : second.promise),
  });

  const user = userEvent.setup();
  const input = await screen.findByRole("combobox", { name: "Battery" });
  const card = screen.getByRole("region", { name: "Battery overview" });
  expectInitialCard(card, "Battery overview");
  await user.type(input, "Camera battery{Enter}");
  await waitFor(() => expect(app.detailReads()).toBe(1));
  expectInitialCard(card, "Battery overview");

  const record = {
    id: 1,
    name: "Camera battery",
    active: 1,
    description: null,
    used_in: "<strong>Raw use</strong>\nNext",
  };

  await act(async () =>
    first.release(
      Response.json({
        battery: record,
        last_charged: "2999-12-31 23:59:59",
        charge_cycles_count: 1234,
      }),
    ),
  );
  await within(card).findByRole("heading", { name: "Camera battery" });
  const usedIn = cardValue(card, "Used in");
  expect(usedIn.textContent).toBe("<strong>Raw use</strong>\nNext");
  expect(usedIn.querySelector("strong")).toBeNull();
  expect(cardValue(card, "Charge cycles count").textContent).toBe("1234");
  expect(cardValue(card, "Last charged").textContent?.trim()).toBe("Never");
  const time = card.querySelector("time")!;
  expect(time.getAttribute("datetime")).toBe("2999-12-31 23:59:59");
  expect(time.textContent).toBe("");
  expect(within(card).getByRole("link", { name: "Edit battery" }).getAttribute("href")).toBe(
    "/battery/1",
  );
  expect(
    within(card).getByRole("link", { name: "Edit battery" }).classList.contains("disabled"),
  ).toBe(false);
  documentScan("grcy:b:2", "@batterypicker");
  await waitFor(() => expect(app.detailReads()).toBe(2));
  await act(async () =>
    second.release(
      Response.json({
        battery: { ...record, id: 2, name: "Manual", used_in: null },
        last_charged: "2888-12-31 00:00:00",
        charge_cycles_count: 5678,
      }),
    ),
  );
  await within(card).findByRole("heading", { name: "Manual" });
  expect(cardValue(card, "Charge cycles count").textContent).toBe("5678");
  expect(usedIn.textContent).toBe("");
  expect(cardValue(card, "Last charged").textContent?.trim()).toBe("Unknown");
  expect(time.getAttribute("datetime")).toBe("2888-12-31 00:00:00");
  expect(time.textContent).toBe("");
  expect(within(card).getByRole("link", { name: "Edit battery" }).getAttribute("href")).toBe(
    "/battery/2",
  );
  expect(within(card).getByRole("link", { name: "Battery journal" }).getAttribute("href")).toBe(
    "/batteriesjournal?embedded&battery=2",
  );
  expect(app.writes).toEqual([]);
});

test("a retired sent tracking write marks the actual warm card reader stale without obsolete receipts", async () => {
  const primary = deferredResponse();
  const app = mount("battery", { primaryResponse: () => primary.promise });
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("combobox", { name: "Battery" }),
    "Camera battery{Enter}",
  );
  await screen.findByRole("heading", { name: "Camera battery" });
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));

  const observed = app.client
    .getQueryCache()
    .findAll({ queryKey: ["tracking-card", "battery"] })
    .filter((query) => query.getObserversCount() > 0 && query.state.data);

  expect(observed).toHaveLength(1);
  const key = observed[0].queryKey;
  const warm = observed[0].state.data;
  expect(warm).toMatchObject({ record: { id: 1, name: "Camera battery" }, count: 0 });
  app.unmount();
  app.client.setQueryData(key, warm);
  expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(app.writes[0].signal?.aborted).toBe(true);
  // Transport ignores abort and acknowledges an uncertain write after retirement.
  await act(async () => primary.release(Response.json({ id: 1 })));
  await waitFor(() => expect(app.client.getQueryState(key)?.isInvalidated).toBe(true));
  expect(app.parent).not.toHaveBeenCalled();
  expect(screen.queryByText(/Tracked charge cycle/)).toBeNull();
});
