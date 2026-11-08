import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";

test("native create battery uses active and zero interval defaults and saves the object before its custom fields", async () => {
  const writes: string[] = [];

  const { router, fetchMock } = mountNativeEditor("/battery/new", (url, options) => {
    if (
      url === "/api/objects/userfields" ||
      url === "/api/objects/userfields?query[]=entity=batteries" ||
      url === "/api/v2/custom-data/fields"
    )
      return Response.json([notesField("batteries")]);

    if (options?.method === "POST" && url === "/api/objects/batteries") {
      writes.push("object");

      return Response.json({ created_object_id: "8" });
    }

    if (options?.method === "PUT" && url === "/api/userfields/batteries/8") {
      writes.push("custom");

      return Response.json({});
    }

    return undefined;
  });

  await screen.findByRole("heading", { name: "Create battery" });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Remote battery");
  expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>("Charge cycle interval (days)").value).toBe("0");
  await user.type(screen.getByLabelText("Description"), "Rechargeable");
  await user.type(screen.getByLabelText("Used in"), "Remote");
  await user.type(screen.getByLabelText("Owner note"), "Top drawer");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/batteries"));
  expect(writes).toEqual(["object", "custom"]);

  const write = fetchMock.mock.calls.find(
    ([url, options]) => String(url) === "/api/objects/batteries" && options?.method === "POST",
  );

  expect(JSON.parse(String(write?.[1]?.body))).toEqual({
    name: "Remote battery",
    active: "1",
    description: "Rechargeable",
    used_in: "Remote",
    charge_interval_days: "0",
  });
});

test("primary object errors expose native generic details and never save dependent custom fields", async () => {
  const { fetchMock } = mountNativeEditor("/battery/new", (url, options) => {
    if (
      url === "/api/objects/userfields" ||
      url === "/api/objects/userfields?query[]=entity=batteries" ||
      url === "/api/v2/custom-data/fields"
    )
      return Response.json([notesField("batteries")]);

    if (url === "/api/objects/batteries" && options?.method === "POST")
      return Response.json(
        { error_message: "UNIQUE constraint failed: batteries.name" },
        { status: 400 },
      );

    return undefined;
  });

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Duplicate");
  await user.type(screen.getByLabelText("Owner note"), "Never saved");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Error details" });
  expect(within(dialog).getByText(/UNIQUE constraint failed/)).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(
      ([url, options]) => String(url).startsWith("/api/userfields/") && options?.method === "PUT",
    ),
  ).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Duplicate");
});

test("battery form rejects missing names and negative charge intervals", async () => {
  const { fetchMock } = mountNativeEditor("/battery/new", (url, options) =>
    url === "/api/objects/batteries" && options?.method === "POST"
      ? Response.json({ created_object_id: "8" })
      : undefined,
  );

  const user = userEvent.setup();
  await screen.findByLabelText("Name");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  await user.type(screen.getByLabelText("Name"), "Battery");
  await user.clear(screen.getByLabelText("Charge cycle interval (days)"));
  await user.type(screen.getByLabelText("Charge cycle interval (days)"), "-1");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});

function batteryGate() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountBattery(
  path = "/battery/5?embedded=0",
  options: {
    hold?: string[];
    fail?: string[];
    noGrant?: boolean;
    active?: number;
    basepath?: string;
  } = {},
) {
  const held = new Set(options.hold ?? []);
  const failing = new Set(options.fail ?? []);
  const gates = new Map<string, ReturnType<typeof batteryGate>>();

  const calls: {
    stage: string;
    path: string;
    method: string;
    body?: Record<string, string>;
    file?: BodyInit | null;
    signal?: AbortSignal | null;
  }[] = [];

  const labels: { gate: ReturnType<typeof batteryGate>; signal?: AbortSignal | null }[] = [];
  const printer: RequestInit[] = [];
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:battery-code";
      static revokeObjectURL = revoke;
    },
  );

  const fields = [
    { ...notesField("batteries"), name: "zeta", caption: "First note" },
    { ...notesField("batteries"), id: 2, name: "clean", caption: "Untouched note" },
    { ...notesField("batteries"), id: 3, name: "alpha", caption: "Last note" },
    { ...notesField("batteries"), id: 4, name: "attachment", caption: "Attachment", type: "file" },
  ];

  const oldFile = "old-battery.pdf";

  const gate = (stage: string) => {
    if (!gates.has(stage)) gates.set(stage, batteryGate());

    return gates.get(stage)!;
  };

  const respond = async (stage: string, result: () => Response) => {
    if (held.has(stage)) await gate(stage).promise;

    return failing.has(stage)
      ? Response.json(
          { error_message: `Battery ${stage} denied` },
          { status: stage === "primary" ? 403 : 503 },
        )
      : result();
  };

  const app = mountNativeEditor(
    path,
    (url, init) => {
      if (url === "/api/v2/user/permissions")
        return Response.json(options.noGrant ? {} : { MASTER_DATA_EDIT: true });

      if (
        url === "/api/v2/custom-data/fields" ||
        url === "/api/objects/userfields" ||
        url === "/api/objects/userfields?query[]=entity=batteries"
      )
        return Response.json(fields);

      if (url === "/api/objects/batteries/5" && init?.method !== "PUT")
        return Response.json({
          id: 5,
          name: "Selected battery",
          active: options.active ?? 0,
          description: "Stored description",
          used_in: "Clock",
          charge_interval_days: 3,
        });

      if (url === "/api/userfields/batteries/5" && init?.method !== "PUT")
        return Response.json({
          zeta: "",
          clean: "Retained clean",
          alpha: "",
          attachment: `${btoa(oldFile)}_${btoa("Old battery.pdf")}`,
        });

      if (url.startsWith("/battery/5/grocycode"))
        return new Response("image", { headers: { "Content-Type": "image/png" } });

      if (url === "/api/batteries/5/printlabel") {
        const item = { gate: batteryGate(), signal: init?.signal };
        labels.push(item);
        const number = labels.length;

        return (async () => {
          if (held.has("label")) await item.gate.promise;

          return failing.has("label")
            ? Response.json({ error_message: "Private label failure" }, { status: 503 })
            : Response.json({ battery_id: 5, request: number });
        })();
      }

      if (url === "https://printer.test/battery") {
        printer.push(init ?? {});

        return new Response(null, { status: 204 });
      }

      if (
        (url === "/api/objects/batteries" && init?.method === "POST") ||
        (url === "/api/objects/batteries/5" && init?.method === "PUT")
      ) {
        const id =
          init.method === "POST" ? 41 + calls.filter((call) => call.stage === "primary").length : 5;

        calls.push({
          stage: "primary",
          path: url,
          method: init.method,
          body: JSON.parse(String(init.body)),
          signal: init.signal,
        });

        return respond("primary", () =>
          init.method === "POST"
            ? Response.json({ created_object_id: String(id) })
            : new Response(null, { status: 204 }),
        );
      }

      if (/^\/api\/userfields\/batteries\/\d+$/.test(url) && init?.method === "PUT") {
        const body: Record<string, string> = JSON.parse(String(init.body));
        const stage = Object.keys(body)[0]!;
        calls.push({ stage, path: url, method: "PUT", body, signal: init.signal });

        return respond(stage, () => new Response(null, { status: 204 }));
      }

      if (url.startsWith("/api/files/userfiles/") && init?.method) {
        const stage = init.method === "DELETE" ? "delete" : "upload";
        calls.push({ stage, path: url, method: init.method, file: init.body, signal: init.signal });

        return respond(stage, () => new Response(null, { status: 204 }));
      }

      return undefined;
    },
    {
      FEATURE_FLAG_LABEL_PRINTER: true,
      LABEL_PRINTER_RUN_SERVER: false,
      LABEL_PRINTER_WEBHOOK: "https://printer.test/battery",
      LABEL_PRINTER_HOOK_JSON: true,
      LABEL_PRINTER_PARAMS: { station: "Kitchen" },
    },
    { basepath: options.basepath },
  );

  return {
    ...app,
    calls,
    labels,
    printer,
    parent,
    revoke,
    oldFile,
    logger,
    allow(stage: string) {
      failing.delete(stage);
    },
    async release(stage: string) {
      await act(async () => gate(stage).release());
    },
    reloads: () => parent.mock.calls.filter(([bag]) => bag?.Message === "Reload"),
  };
}

test("selected Battery prints independently in reverse response order while preserving its draft and ordinary prefixed Download", async () => {
  const app = mountBattery("/house.hold/index.php/battery/5#keep", {
    hold: ["label", "primary"],
    basepath: "/house.hold/index.php",
  });

  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await screen.findByRole("img", { name: "Battery Grocycode" });

  const preview = app.fetchMock.mock.calls.find(
    ([url]) => String(url) === "/battery/5/grocycode?size=60",
  )!;

  expect(new Headers(preview[1]?.headers).get("GROCY-API-KEY")).toBe("dev-key");
  await userEvent.clear(name);
  await userEvent.type(name, "Unfinished draft");
  const print = screen.getByText("Print on label printer");
  await userEvent.click(print);
  await userEvent.click(print);
  await waitFor(() => expect(app.labels).toHaveLength(2));
  expect(name.disabled).toBe(false);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(app.router.state.location.hash).toBe("keep");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(1));
  expect(name.matches(":disabled")).toBe(true);
  await userEvent.click(print);
  await waitFor(() => expect(app.labels).toHaveLength(3));
  await act(async () => app.labels[1]!.gate.release());
  await waitFor(() => expect(app.printer).toHaveLength(1));
  await act(async () => app.labels[0]!.gate.release());
  await waitFor(() => expect(app.printer).toHaveLength(2));
  expect(
    app.printer.map((request) => ({
      method: request.method,
      type: new Headers(request.headers).get("Content-Type"),
      body: JSON.parse(String(request.body)),
    })),
  ).toEqual([
    {
      method: "POST",
      type: "application/json",
      body: { battery_id: 5, request: 2, station: "Kitchen" },
    },
    {
      method: "POST",
      type: "application/json",
      body: { battery_id: 5, request: 1, station: "Kitchen" },
    },
  ]);
  const download = screen.getByRole("link", { name: "Download" });
  expect(download.getAttribute("href")).toBe(
    "/house.hold/index.php/battery/5/grocycode?download=true",
  );
  expect(download.hasAttribute("download")).toBe(false);
  expect(name.value).toBe("Unfinished draft");
  expect(screen.queryByText("Label request sent")).toBeNull();
  expect(app.fetchMock.mock.calls.some(([url]) => String(url).includes("download=true"))).toBe(
    false,
  );
  await act(async () => app.router.navigate({ href: "/battery/new" }));
  await screen.findByRole("heading", { name: "Create battery" });
  await waitFor(() => expect(app.revoke).toHaveBeenCalledWith("blob:battery-code"));
  expect(app.labels[2]!.signal?.aborted).toBe(true);
  await act(async () => app.labels[2]!.gate.release());
  await app.release("primary");
  expect(app.printer).toHaveLength(2);
  expect(screen.queryByText("Error while executing WebHook")).toBeNull();
});

test("Battery label GET failure is silent and never locks an editable draft", async () => {
  const app = mountBattery(undefined, { fail: ["label"] });
  await screen.findByLabelText("Name");
  await userEvent.click(screen.getByText("Print on label printer"));
  await waitFor(() => expect(app.labels).toHaveLength(1));
  await act(async () => {});
  expect(app.printer).toEqual([]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Private label failure|Label request sent/)).toBeNull();
  await userEvent.type(screen.getByLabelText("Name"), " retained");
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Selected battery retained");
  expect(app.calls).toEqual([]);
});

test.each(["new", "5"])(
  "native Battery %s serializes checkbox/raw interval and completes on its final parallel dirty field",
  async (id) => {
    const app = mountBattery(`/battery/${id}?embedded=0`, {
      active: 2,
      hold: ["primary", "zeta", "alpha"],
    });

    const name = await screen.findByLabelText("Name");
    expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(id === "new");
    await userEvent.clear(name);
    await userEvent.type(name, "Ordered battery");
    await userEvent.type(screen.getByLabelText("Last note"), "Edited first");
    await userEvent.type(screen.getByLabelText("First note"), "Edited second");
    fireEvent.change(screen.getByLabelText("Charge cycle interval (days)"), {
      target: { value: "07" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.calls).toHaveLength(1));
    expect(app.calls[0]!.body).toEqual({
      name: "Ordered battery",
      active: id === "new" ? "1" : "0",
      description: id === "new" ? "" : "Stored description",
      used_in: id === "new" ? "" : "Clock",
      charge_interval_days: "07",
    });
    expect(name.matches(":disabled")).toBe(true);
    await app.release("primary");
    await waitFor(() => expect(app.calls).toHaveLength(3));
    expect(app.calls.slice(1).map((call) => ({ path: call.path, body: call.body }))).toEqual([
      {
        path: `/api/userfields/batteries/${id === "new" ? 41 : 5}`,
        body: { zeta: "Edited second" },
      },
      {
        path: `/api/userfields/batteries/${id === "new" ? 41 : 5}`,
        body: { alpha: "Edited first" },
      },
    ]);
    expect(app.reloads()).toEqual([]);
    await app.release("alpha");
    await waitFor(() =>
      expect(app.parent).toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(name.matches(":disabled")).toBe(true);
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    await app.release("zeta");
    expect(app.reloads()).toHaveLength(1);
  },
);

test("native Battery final metadata failure is silently busy with no saved-record Retry", async () => {
  const app = mountBattery(undefined, { hold: ["zeta", "alpha"], fail: ["alpha"] });
  await screen.findByLabelText("Name");
  await userEvent.type(screen.getByLabelText("First note"), "Earlier");
  await userEvent.type(screen.getByLabelText("Last note"), "Final");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(3));
  await app.release("alpha");
  await app.release("zeta");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Battery alpha denied|The record is saved/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(app.reloads()).toEqual([]);
});

test.each(["new", "5"])(
  "no-grant Battery %s remains editable and a denied primary unlocks an exact fresh write",
  async (id) => {
    const app = mountBattery(`/battery/${id}?embedded`, { noGrant: true, fail: ["primary"] });
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    expect(name.matches(":disabled")).toBe(false);
    await userEvent.clear(name);
    await userEvent.type(name, "Denied draft");
    await userEvent.type(screen.getByLabelText("First note"), "Retained note");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Error while saving, probably this item already exists/,
      }),
    );
    expect(
      within(await screen.findByRole("dialog", { name: "Error details" })).getByText(
        /Battery primary denied/,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(name.value).toBe("Denied draft");
    expect(name.matches(":disabled")).toBe(false);
    expect(document.body.classList.contains("cursor-busy")).toBe(false);
    expect(app.calls).toHaveLength(1);
    app.allow("primary");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.reloads()).toHaveLength(1));
    const primaries = app.calls.filter((call) => call.stage === "primary");
    expect(primaries).toHaveLength(2);
    expect(primaries.map((call) => call.method)).toEqual([
      id === "new" ? "POST" : "PUT",
      id === "new" ? "POST" : "PUT",
    ]);
    expect(primaries[1]!.body).toEqual(primaries[0]!.body);
    expect(app.calls.at(-1)!.path).toBe(`/api/userfields/batteries/${id === "new" ? 42 : 5}`);
    expect(app.calls.at(-1)!.body).toEqual({ zeta: "Retained note" });
  },
);

function batteryFileText(body: BodyInit | null | undefined) {
  if (!(body instanceof Blob)) throw new Error("Expected actual Battery attachment bytes");

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(body);
  });
}

test.each([false, true])(
  "Battery file metadata/Delete/upload gate retains bytes and busy completion (upload failure %s)",
  async (failUpload) => {
    const app = mountBattery(undefined, {
      hold: ["zeta", "attachment", "delete", "upload"],
      fail: failUpload ? ["upload"] : [],
    });

    await screen.findByLabelText("Name");
    await userEvent.type(screen.getByLabelText("First note"), "Earlier held field");
    const input = screen.getByLabelText<HTMLInputElement>("Attachment");

    const file = new File(["Native Battery file bytes"], "battery-proof.pdf", {
      type: "application/pdf",
    });

    await userEvent.upload(input, file);
    await userEvent.click(within(input.closest(".field")!).getByRole("button", { name: "Delete" }));
    expect(input.files?.[0]).toBe(file);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.calls.map((call) => call.stage)).toEqual(["primary", "zeta", "attachment"]),
    );
    const packed = app.calls[2]!.body!.attachment!;
    expect(atob(packed.split("_")[1]!)).toBe("battery-proof.pdf");
    await app.release("attachment");
    await waitFor(() => expect(app.calls.at(-1)!.stage).toBe("delete"));
    expect(app.calls.at(-1)!.path).toBe(
      `/api/files/userfiles/${encodeURIComponent(btoa(app.oldFile))}`,
    );
    expect(app.calls.some((call) => call.stage === "upload")).toBe(false);
    await app.release("delete");
    await waitFor(() => expect(app.calls.at(-1)!.stage).toBe("upload"));
    expect(atob(decodeURIComponent(app.calls.at(-1)!.path.split("/").at(-1)!))).toBe(
      atob(packed.split("_")[0]!),
    );
    expect(await batteryFileText(app.calls.at(-1)!.file)).toBe("Native Battery file bytes");
    expect(app.reloads()).toEqual([]);
    await app.release("upload");

    if (failUpload) {
      expect(
        await screen.findByText("Error while saving, probably this item already exists"),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(app.reloads()).toEqual([]);
    } else {
      await waitFor(() =>
        expect(app.parent).toHaveBeenCalledWith(
          { Message: "Reload", Payload: null },
          window.location.origin,
        ),
      );
    }

    expect(input.matches(":disabled")).toBe(true);
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    await app.release("zeta");
  },
);

test("Battery document departure aborts held metadata, suppresses file stage/Reload and stales a settled write", async () => {
  const app = mountBattery(undefined, { hold: ["attachment"] });
  await screen.findByLabelText("Name");
  const input = screen.getByLabelText<HTMLInputElement>("Attachment");
  await userEvent.upload(input, new File(["Retired attachment"], "retired.pdf"));
  app.client.setQueryData(["objects", "batteries"], [{ id: 5, name: "Warm battery" }]);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.calls).toHaveLength(2));
  await act(async () => app.router.navigate({ href: "/battery/new" }));
  await screen.findByRole("heading", { name: "Create battery" });
  expect(app.calls[1]!.signal?.aborted).toBe(true);
  app.client.setQueryData(["objects", "batteries"], [{ id: 5, name: "Fresh replacement read" }]);
  expect(app.client.getQueryState(["objects", "batteries"])?.isInvalidated).toBe(false);
  await app.release("attachment");
  expect(app.calls.map((call) => call.stage)).toEqual(["primary", "attachment"]);
  expect(app.client.getQueryState(["objects", "batteries"])?.isInvalidated).toBe(true);
  expect(app.reloads()).toEqual([]);
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
});

test("selected Battery serializes imported single-line text from actual controls without textarea CRLF conversion", async () => {
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  let body: Record<string, string> | undefined;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:imported-battery-code";
      static revokeObjectURL = vi.fn();
    },
  );
  mountNativeEditor("/battery/5?embedded", (url, init) => {
    if (url === "/api/objects/batteries/5" && init?.method !== "PUT")
      return Response.json({
        id: 5,
        name: "Imported\rBattery\nName",
        active: 1,
        description: "Single\rline\nDescription",
        used_in: "Hall\rClock\nCase",
        charge_interval_days: "07",
      });

    if (url === "/api/objects/batteries/5" && init?.method === "PUT") {
      body = JSON.parse(String(init.body));

      return new Response(null, { status: 204 });
    }

    if (url.startsWith("/battery/5/grocycode"))
      return new Response("image", { headers: { "Content-Type": "image/png" } });

    return undefined;
  });
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe(
    "ImportedBatteryName",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Description").value).toBe(
    "SinglelineDescription",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Used in").value).toBe("HallClockCase");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(parent).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(body).toEqual({
    name: "ImportedBatteryName",
    active: "1",
    description: "SinglelineDescription",
    used_in: "HallClockCase",
    charge_interval_days: "07",
  });
});
