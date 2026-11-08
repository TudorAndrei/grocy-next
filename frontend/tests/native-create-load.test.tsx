import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import {
  nativeCreateHosts as hosts,
  mountNativeUserfieldsHost as mountCreate,
} from "./fixtures/native-userfield-hosts";

function freezeClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2020, 0, 2, 3, 4, 5));
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

test.each(hosts)(
  "native create $route requests definitions while date and acknowledgement remain uninitialized",
  async (host) => {
    const app = mountCreate(host);
    const day = await app.ready();
    const ack = screen.getByLabelText<HTMLInputElement>("Acknowledge");
    expect(day.value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Created time").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Local text").value).toBe("");
    expect(ack.required).toBe(true);
    expect(ack.checked).toBe(false);
    expect(ack.indeterminate).toBe(false);
    expect(day.matches(":disabled")).toBe(false);
    expect(day.closest("form")).not.toBeNull();
    await waitFor(() => expect(app.definitionReads).toHaveLength(1));
    expect(app.reads.some((read) => read.path.startsWith("/api/userfields/"))).toBe(false);
  },
);

test("create callback uses its current clock, retains dirty edits and installs acknowledgement after early checking", async () => {
  freezeClock();
  const app = mountCreate(hosts[9]);
  const day = await app.ready();
  const at = screen.getByLabelText<HTMLInputElement>("Created time");
  const ack = screen.getByLabelText<HTMLInputElement>("Acknowledge");
  const omitted = screen.getByLabelText<HTMLInputElement>("Omitted acknowledgement");
  const user = userEvent.setup();
  await user.type(day, "2011-02-03");
  await user.type(at, "2012-03-04T05:06:07");
  await user.type(screen.getByLabelText("Local text"), "Natural local text");
  await user.click(ack);
  expect(day.value).toBe("2011-02-03");
  expect(ack.required).toBe(true);
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  const response = app.fields.filter((field) => field.name !== "omitted");
  await act(async () =>
    app.init.release(
      Response.json([
        ...response,
        { ...app.fields[0], name: "new-server-name", caption: "New server control" },
      ]),
    ),
  );
  await waitFor(() => expect(day.value).toBe("2030-05-06"));
  expect(at.value).toBe("2030-05-06 07:08:09");
  expect(ack.checked).toBe(true);
  expect(ack.required).toBe(true);
  expect(ack.indeterminate).toBe(true);
  expect(omitted.required).toBe(true);
  expect(omitted.indeterminate).toBe(false);
  expect(screen.queryByLabelText("New server control")).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Local text").value).toBe("Natural local text");
  await user.click(ack);
  expect(ack.checked).toBe(false);
  expect(ack.required).toBe(false);
  expect(ack.indeterminate).toBe(false);
  await user.click(omitted);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.writes.some((write) => write.path === "/api/objects/userobjects")).toBe(true),
  );
  await waitFor(() =>
    expect(app.writes.filter((write) => write.path.startsWith("/api/userfields/"))).toHaveLength(5),
  );
  expect(
    app.writes
      .filter((write) => write.path.startsWith("/api/userfields/"))
      .map((write) => write.path),
  ).toEqual(Array(5).fill("/api/userfields/userentity-tools/41"));
  expect(
    app.writes
      .filter((write) => write.path.startsWith("/api/userfields/"))
      .map((write) => write.body),
  ).toEqual([
    { day: "2030-05-06" },
    { at: "2030-05-06 07:08:09" },
    { ack: "0" },
    { omitted: "1" },
    { text: "Natural local text" },
  ]);
});

test("create callback follows returned type and required policy without replacing rendered controls", async () => {
  freezeClock();
  const app = mountCreate(hosts[9], { raw: true });
  await app.ready();
  const raw = screen.getByLabelText<HTMLInputElement>("Raw control");
  const ack = screen.getByLabelText<HTMLInputElement>("Acknowledge");
  const optional = screen.getByLabelText<HTMLInputElement>("Optional acknowledgement");
  const user = userEvent.setup();
  await user.type(raw, "Early raw text");
  await user.click(ack);
  await user.click(optional);
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  await act(async () =>
    app.init.release(
      Response.json([
        { ...app.fields[5], type: "date", default_value: "now" },
        { ...app.fields[2], input_required: 0 },
        { ...app.fields[6], input_required: 1 },
      ]),
    ),
  );
  await waitFor(() => expect(raw.value).toBe("2030-05-06"));
  expect(raw.type).toBe("text");
  expect(screen.getByLabelText("Raw control")).toBe(raw);
  expect(ack.indeterminate).toBe(false);
  expect(optional.checked).toBe(true);
  expect(optional.indeterminate).toBe(true);
  expect(optional.required).toBe(false);
  await user.click(ack);
  expect(ack.required).toBe(true);
  expect(ack.validity.valueMissing).toBe(true);
});

test("create definition503 preserves a usable draft without installing acknowledgement", async () => {
  const app = mountCreate(hosts[9]);
  const day = await app.ready();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Local text"), "Retained after read failure");
  await act(async () =>
    app.init.release(Response.json({ error_message: "Initialization denied" }, { status: 503 })),
  );
  await waitFor(() => expect(app.logger).toHaveBeenCalledOnce());
  expect(day.value).toBe("");
  const ack = screen.getByLabelText<HTMLInputElement>("Acknowledge");
  await user.click(ack);
  await user.click(ack);
  expect(ack.required).toBe(true);
  expect(ack.indeterminate).toBe(false);
  expect(screen.queryByText("Initialization denied")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Local text").value).toBe(
    "Retained after read failure",
  );
  await user.click(ack);
  await user.click(screen.getByLabelText("Omitted acknowledgement"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.writes).toContainEqual({
      path: "/api/userfields/userentity-tools/41",
      body: { text: "Retained after read failure" },
    }),
  );
});

test("create checkbox acknowledgement by a programmatic change preserves its indeterminate state", async () => {
  const app = mountCreate(hosts[9]);
  await app.ready();
  const ack = screen.getByLabelText<HTMLInputElement>("Acknowledge");
  await act(async () => app.init.release(Response.json([app.fields[2]])));
  await waitFor(() => expect(ack.indeterminate).toBe(true));
  fireEvent.change(ack);
  expect(ack.required).toBe(false);
  expect(ack.checked).toBe(false);
  expect(ack.indeterminate).toBe(true);
});

test.each([hosts[9], hosts[16]])(
  "create $namespace date policy on an unmatched preset selection retains dirty metadata null",
  async (host) => {
    freezeClock();
    const app = mountCreate(host, { singlePreset: true });
    await app.ready();
    const choice = screen.getByLabelText<HTMLSelectElement>("Preset choice");
    const user = userEvent.setup();

    if (host.namespace === "product_barcodes")
      await user.type(screen.getByLabelText("Barcode"), "CREATE-NULL");
    await user.selectOptions(choice, "Alpha");
    vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
    await act(async () =>
      app.init.release(
        Response.json([{ ...app.fields.at(-1), type: "date", default_value: "now" }]),
      ),
    );
    await waitFor(() => expect(choice.selectedIndex).toBe(-1));
    await user.click(screen.getByLabelText("Acknowledge"));
    await user.click(screen.getByLabelText("Omitted acknowledgement"));
    expect(choice.selectedIndex).toBe(-1);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.writes).toContainEqual({
        path: `/api/userfields/${host.namespace}/41`,
        body: { choice: null },
      }),
    );
  },
);

test("create null definition stops after applying the earlier callback row", async () => {
  freezeClock();
  const app = mountCreate(hosts[9]);
  const day = await app.ready();
  const text = screen.getByLabelText<HTMLInputElement>("Local text");
  await userEvent.type(text, "Later local draft");
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  await act(async () =>
    app.init.release(
      Response.json([
        app.fields[0],
        null,
        { ...app.fields[4], type: "date", default_value: "now" },
      ]),
    ),
  );
  await waitFor(() => expect(day.value).toBe("2030-05-06"));
  expect(text.value).toBe("Later local draft");
  expect(screen.getByLabelText("Local text")).toBe(text);
  expect(app.logger).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("create initialization survives StrictMode replay", async () => {
  freezeClock();
  const app = mountCreate(hosts[9], { strict: true });
  const day = await app.ready();
  expect(day.value).toBe("");
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  await act(async () => app.init.release(Response.json(app.fields)));
  await waitFor(() => expect(day.value).toBe("2030-05-06"));
  expect(app.logger).not.toHaveBeenCalled();
});

test("a departed initial create callback cannot change another document", async () => {
  const app = mountCreate(hosts[9]);
  const day = await app.ready();
  await waitFor(() => expect(app.definitionReads).toHaveLength(1));
  await userEvent.type(day, "2011-02-03");
  await act(async () => app.router.navigate({ href: "/settings" }));
  await screen.findByRole("heading", { name: "Settings", level: 1 });
  await act(async () => app.init.release(Response.json(app.fields)));
  expect(screen.queryByLabelText("Created day")).toBeNull();
  expect(app.definitionReads[0].signal?.aborted).toBe(true);
  expect(app.logger).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
});

test("a native create host without definitions has no initialization request or custom container", async () => {
  const app = mountCreate(hosts[1], { noFields: true });
  await screen.findByLabelText("Name");
  expect(screen.queryByRole("group", { name: "Userfields" })).toBeNull();
  expect(app.definitionReads).toEqual([]);
});

test("held initial Product definitions remain create initialization after the primary assigns its sticky ID", async () => {
  freezeClock();
  const app = mountCreate(hosts[10], { holdFields: true });
  const day = await app.ready();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Sticky created product");
  await user.click(screen.getByLabelText("Acknowledge"));
  await user.click(screen.getByLabelText("Omitted acknowledgement"));
  await user.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() =>
    expect(app.writes.some((write) => write.path === "/api/objects/products")).toBe(true),
  );
  await waitFor(() =>
    expect(app.writes.filter((write) => write.path === "/api/userfields/products/41")).toHaveLength(
      2,
    ),
  );
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  await act(async () => app.init.release(Response.json(app.fields)));
  await waitFor(() => expect(day.value).toBe("2030-05-06"));
  expect(screen.getByLabelText<HTMLInputElement>("Acknowledge").indeterminate).toBe(true);
  expect(app.definitionReads).toHaveLength(1);
  expect(app.reads.some((read) => read.path.startsWith("/api/userfields/products/"))).toBe(false);
  await act(async () => app.metadata.release(new Response(null, { status: 204 })));
});

test.each(
  [hosts[17], hosts[18]].flatMap((host) =>
    [false, true].map((initialFirst) => ({ host, route: host.route, initialFirst })),
  ),
)(
  "$route initial Load and post-booking Clear remain independent callbacks (initialFirst=$initialFirst)",
  async ({ host, initialFirst }) => {
    freezeClock();
    const app = mountCreate(host);
    const day = await app.ready();
    const user = userEvent.setup();
    await user.type(day, "2011-02-03");
    await user.click(screen.getByLabelText("Acknowledge"));
    await user.click(screen.getByLabelText("Omitted acknowledgement"));
    await user.type(screen.getByRole("combobox", { name: "Product" }), "Coffee{Enter}");

    const amount = await screen.findByRole<HTMLInputElement>("spinbutton", {
      name: host.route === "/inventory" ? /^New stock amount/ : /^Amount/,
    });

    await user.clear(amount);
    await user.type(amount, "6");
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.definitionReads).toHaveLength(2));
    expect(app.writes).toContainEqual({
      path: "/api/userfields/stock/transaction-new",
      body: { day: "2011-02-03" },
    });
    vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));

    if (initialFirst) {
      await act(async () => app.init.release(Response.json(app.fields)));
      await waitFor(() => expect(day.value).toBe("2030-05-06"));
      await act(async () => app.clear.release(Response.json(app.fields)));
      await waitFor(() => expect(day.value).toBe(""));
    } else {
      await act(async () => app.clear.release(Response.json(app.fields)));
      await waitFor(() => expect(day.value).toBe(""));
      await act(async () => app.init.release(Response.json(app.fields)));
      await waitFor(() => expect(day.value).toBe("2030-05-06"));
    }

    expect(app.reads.some((read) => read.path.startsWith("/api/userfields/stock/"))).toBe(false);
  },
);
