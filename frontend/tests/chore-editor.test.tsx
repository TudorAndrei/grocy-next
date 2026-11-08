import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JsonObject } from "@/lib/json";
import { supportDialogs } from "./fixtures/dialogs";

function choreGate() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mount({
  create = false,
  history = false,
  fieldFailure = false,
  assignmentFailure = false,
  assignments = true,
  stock = true,
  allowed = true,
  objectFailure = false,
  hold = "",
  productAmount = 0,
  nativeFields = false,
  numericFields = false,
  imported = false,
  active = 1,
  holdStages = new Array<string>(),
  failStages = new Array<string>(),
  basepath = "",
  objectFailures = 0,
} = {}) {
  supportDialogs();

  const chore = {
    id: 7,
    name: imported ? "Imported\rChore\nName" : "Clean selected room",
    description: imported ? "Main line1\nMain line2" : "Selected description",
    active,
    period_type: "weekly",
    period_days: 1,
    period_interval: 2,
    period_config: "monday,friday",
    assignment_type: "no-assignment",
    assignment_config: "",
    track_date_only: 0,
    rollover: 0,
    consume_product_on_execution: productAmount ? 1 : 0,
    product_id: productAmount ? 9 : null,
    product_amount: productAmount || null,
    userfields: numericFields
      ? ["Old note"]
      : nativeFields
        ? {
            zeta: "",
            clean: "Retained clean",
            alpha: "",
            attachment: `${btoa("old-chore.pdf")}_${btoa("Old chore.pdf")}`,
          }
        : { note: "Old note" },
  };

  const writes: Array<{
    path: string;
    body: JsonObject;
    method?: string;
    signal?: AbortSignal | null;
  }> = [];

  const files: {
    method: string;
    path: string;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
  }[] = [];

  const labels: { gate: ReturnType<typeof choreGate>; signal?: AbortSignal | null }[] = [];
  const printer: RequestInit[] = [];
  const gates = new Map<string, ReturnType<typeof choreGate>>();
  const failing = new Set(failStages);
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const gate = (stage: string) => {
    if (!gates.has(stage)) gates.set(stage, choreGate());

    return gates.get(stage)!;
  };

  const wait = async (stage: string) => {
    if (holdStages.includes(stage)) await gate(stage).promise;
  };

  let primaryAttempts = 0;
  const reads: string[] = [];
  let fieldAttempts = 0;
  let assignmentAttempts = 0;
  const savedFields = new Map<number, JsonObject>();
  let releaseSave: () => void = () => {};

  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });

  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:chore");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (path === "/api/userfields/chores/7" && !init?.method)
        return Response.json(chore.userfields);

      if (!init?.method || init.method === "GET") reads.push(path + url.search);

      if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "owner" }]);

      if (path === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: allowed });

      if (path === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_CHORES: true,
          FEATURE_FLAG_CHORES_ASSIGNMENTS: assignments,
          FEATURE_FLAG_STOCK: stock,
          FEATURE_FLAG_LABEL_PRINTER: true,
          LABEL_PRINTER_RUN_SERVER: false,
          LABEL_PRINTER_WEBHOOK: "https://printer.test/chore",
          LABEL_PRINTER_HOOK_JSON: true,
          LABEL_PRINTER_PARAMS: { station: "Kitchen" },
        });

      if (path === "/api/user/settings")
        return Response.json({ stock_decimal_places_amounts: "2" });

      if (path.startsWith("/api/user/settings/")) return new Response(null, { status: 204 });

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (path === `/api/v2/chores/${create ? "new" : "7"}/editor`)
        return Response.json({
          chore: create ? null : chore,
          has_history: history,
          initial_start_date: "2020-01-02 03:04:00",
          users: [
            { id: 1, username: "owner", display_name: "Owner" },
            { id: 2, username: "helper", display_name: "Helper" },
          ],
          products: [
            { id: 9, name: "Cleaning spray", stock_unit_name: "Bottle" },
            { id: 10, name: "Brush", stock_unit_name: "Piece" },
          ],
        });

      if (path === "/api/objects/product_barcodes_view")
        return Response.json([
          { product_id: 9, barcode: "SPRAY100" },
          { product_id: 9, barcode: "SPRAY101" },
          { product_id: 10, barcode: "BRUSH001" },
        ]);

      if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
        return Response.json(
          nativeFields
            ? [
                {
                  id: 1,
                  entity: "chores",
                  name: "zeta",
                  caption: "First chore note",
                  type: "text-multi-line",
                  input_required: 0,
                  default_value: null,
                  config: null,
                },
                {
                  id: 2,
                  entity: "chores",
                  name: "clean",
                  caption: "Clean chore note",
                  type: "text-single-line",
                  input_required: 0,
                  default_value: null,
                  config: null,
                },
                {
                  id: 3,
                  entity: "chores",
                  name: "alpha",
                  caption: "Last chore note",
                  type: "text-single-line",
                  input_required: 0,
                  default_value: null,
                  config: null,
                },
                {
                  id: 4,
                  entity: "chores",
                  name: "attachment",
                  caption: "Chore attachment",
                  type: "file",
                  input_required: 0,
                  default_value: null,
                  config: null,
                },
              ]
            : [
                {
                  id: 1,
                  entity: "chores",
                  name: numericFields ? "0" : "note",
                  caption: "Chore note",
                  type: "text-single-line",
                  input_required: 0,
                  default_value: null,
                  config: null,
                },
              ],
        );

      if (path === "/api/objects/chores" && init?.method !== "POST") return Response.json([chore]);

      if (path === "/chore/7/grocycode") return new Response(new Blob(["image"]));

      if (path === "/api/chores/7/printlabel") {
        const item = { gate: choreGate(), signal: init?.signal };
        labels.push(item);
        await wait("label");

        if (holdStages.includes("labels")) await item.gate.promise;

        return failing.has("label")
          ? Response.json({ error_message: "Private Chore label failure" }, { status: 503 })
          : Response.json({ chore_id: 7, request: labels.indexOf(item) + 1 });
      }

      if (String(input) === "https://printer.test/chore") {
        printer.push(init ?? {});

        return new Response(null, { status: failing.has("webhook") ? 503 : 204 });
      }

      if (
        path.startsWith("/api/files/userfiles/") &&
        ["PUT", "DELETE"].includes(init?.method ?? "")
      ) {
        files.push({ path, method: init!.method!, body: init?.body, signal: init?.signal });
        await wait("upload");

        return new Response(null, { status: 204 });
      }

      if (init?.method === "POST" || init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push({ path, body, method: init.method, signal: init.signal });

        if (path === "/api/objects/chores" || path === "/api/objects/chores/7") {
          primaryAttempts++;

          if (hold === "object") await saveGate;
          await wait("primary");

          if (objectFailure || primaryAttempts <= objectFailures)
            return Response.json(
              { error_message: "Name already exists" },
              { status: objectFailures ? 403 : 409 },
            );

          return path === "/api/objects/chores"
            ? Response.json({ created_object_id: String(41 + primaryAttempts) })
            : new Response(null, { status: 204 });
        }

        if (path.startsWith("/api/userfields/chores/")) {
          fieldAttempts++;

          if (hold === "field") await saveGate;
          const field = Object.keys(body)[0]!;
          await wait(field);

          if (failing.has(field))
            return Response.json({ error_message: `Chore ${field} unavailable` }, { status: 503 });

          if (fieldFailure && fieldAttempts === 1)
            return Response.json({ error_message: "Custom field unavailable" }, { status: 503 });
          const id = Number(path.split("/").at(-1));
          savedFields.set(id, { ...savedFields.get(id), ...body });

          return new Response(null, { status: 204 });
        }

        if (path === "/api/chores/executions/calculate-next-assignments") {
          assignmentAttempts++;
          await wait("assignment");

          if (assignmentFailure && assignmentAttempts === 1)
            return Response.json(
              { error_message: "Assignment calculation unavailable" },
              { status: 503 },
            );

          return new Response(null, { status: 204 });
        }
      }

      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createAppRouter({
    basepath: basepath || undefined,
    context: { queryClient: client },
    history: createMemoryHistory({
      initialEntries: [`${basepath}/chore/${create ? "new" : "7"}?embedded=1#keep`],
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
  });

  return {
    router,
    client,
    writes,
    savedFields,
    releaseSave,
    reads,
    files,
    labels,
    printer,
    logger,
    messages,
    async release(stage: string) {
      await act(async () => gate(stage).release());
    },
  };
}

test("selected chore numeric fields preserve history-locked start and leave final custom-field failure silently busy", async () => {
  const app = mount({ history: true, fieldFailure: true, numericFields: true });
  const user = userEvent.setup();
  const name = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Chore note" }).value).toBe(
      "Old note",
    ),
  );
  expect(name.value).toBe("Clean selected room");
  expect(screen.getByLabelText<HTMLInputElement>("Start date").disabled).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Monday" }).checked).toBe(true);
  await user.clear(name);
  await user.type(name, "Clean kitchen");
  await user.selectOptions(screen.getByRole("combobox", { name: "Period type" }), "monthly");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Day of month" }), {
    target: { value: "31" },
  });
  await user.selectOptions(screen.getByRole("combobox", { name: "Assignment type" }), "random");
  await user.selectOptions(screen.getByRole("listbox", { name: "Assign to" }), ["1", "2"]);
  await user.click(screen.getByRole("checkbox", { name: "Consume product on chore execution" }));
  await user.type(screen.getByRole("combobox", { name: "Product" }), "Cleaning spray{Enter}");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Amount" }), {
    target: { value: "2.5" },
  });
  await user.click(screen.getByRole("checkbox", { name: "Active" }));
  await user.click(screen.getByRole("checkbox", { name: "Track date only" }));
  await user.click(screen.getByRole("checkbox", { name: "Due date rollover" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Chore note" }), {
    target: { value: "New note" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  await act(async () => {});
  expect(screen.queryByText("Custom field unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/objects/chores/7",
    "/api/userfields/chores/7",
  ]);
  expect(app.writes[1]?.body).toEqual({ "0": "New note" });
  expect(app.writes[0]?.body).toMatchObject({
    name: "Clean kitchen",
    active: "0",
    period_type: "monthly",
    period_days: "31",
    period_interval: "2",
    period_config: "",
    start_date: "2020-01-02 03:04:00",
    assignment_type: "random",
    assignment_config: "1,2",
    track_date_only: "1",
    rollover: "1",
    consume_product_on_execution: "1",
    product_id: "9",
    product_amount: "2.5",
  });
  expect(name.closest("fieldset")?.disabled).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(app.router.state.location.pathname).toBe("/chore/7");
});

test("new weekly chore retains native defaults and assignment failure clears cursor while leaving controls disabled", async () => {
  const app = mount({ create: true, assignmentFailure: true });
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Name" });
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Period type" }).value).toBe(
    "hourly",
  );
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Assignment type" }).value).toBe(
    "in-alphabetical-order",
  );
  await user.type(name, "Water plants");
  await user.selectOptions(screen.getByRole("combobox", { name: "Period type" }), "weekly");
  await user.click(screen.getByRole("checkbox", { name: "Friday" }));
  await user.click(screen.getByRole("checkbox", { name: "Monday" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Period interval" }), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2020-02-03T04:05" } });
  await user.selectOptions(screen.getByRole("listbox", { name: "Assign to" }), "2");
  fireEvent.change(screen.getByRole("textbox", { name: "Chore note" }), {
    target: { value: "Near window" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(3));
  await waitFor(() => expect(document.body.classList.contains("cursor-busy")).toBe(false));
  expect(screen.queryByText("Assignment calculation unavailable")).toBeNull();
  expect(
    app.logger.mock.calls.some(
      ([error]) =>
        error instanceof Error && error.message.includes("Assignment calculation unavailable"),
    ),
  ).toBe(true);
  expect(app.writes[0]?.body).toMatchObject({
    period_type: "weekly",
    period_days: "1",
    period_interval: "3",
    period_config: "monday,friday",
    start_date: "2020-02-03 04:05:00",
    assignment_config: "2",
    active: "1",
    consume_product_on_execution: "0",
  });
  expect(app.writes[0]?.body).not.toHaveProperty("product_id");
  expect(app.savedFields.get(42)).toEqual({ note: "Near window" });
  expect(screen.getByRole("button", { name: "Save" }).matches(":disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(app.router.state.location.pathname).toBe("/chore/new");
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/objects/chores",
    "/api/userfields/chores/42",
    "/api/chores/executions/calculate-next-assignments",
  ]);
});

test("disabled assignment and stock features send native hidden assignment defaults and omit stock changes", async () => {
  const app = mount({ assignments: false, stock: false });
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Name" });
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  expect(screen.queryByRole("combobox", { name: "Assignment type" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Consume product on chore execution" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Period type" }), "manually");
  expect(screen.queryByRole("spinbutton", { name: "Period interval" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/chores"));
  expect(app.writes[0]?.body).toMatchObject({
    period_type: "manually",
    period_days: "1",
    period_interval: "1",
    period_config: "",
    assignment_type: "no-assignment",
    assignment_config: "",
  });
  expect(app.writes[0]?.body).not.toHaveProperty("consume_product_on_execution");
});

test("primary chore save failures show the native generic error without starting secondary writes", async () => {
  const app = mount({ objectFailure: true });
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Name" });
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Error while saving, probably this item already exists");
  expect(app.writes.map((write) => write.path)).toEqual(["/api/objects/chores/7"]);
});

test.each(["object", "field"])(
  "leaving during a held %s save stops later chore save stages",
  async (hold) => {
    const app = mount({ hold });
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
    fireEvent.change(screen.getByRole("textbox", { name: "Chore note" }), {
      target: { value: "Draft note" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(hold === "object" ? 1 : 2));
    await act(async () => {
      await app.router.navigate({ href: "/chores" });
    });
    await act(async () => {
      app.releaseSave();
      await Promise.resolve();
    });
    expect(app.router.state.location.pathname).toBe("/chores");
    expect(app.writes.map((write) => write.path)).toEqual(
      hold === "object"
        ? ["/api/objects/chores/7"]
        : ["/api/objects/chores/7", "/api/userfields/chores/7"],
    );
    expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
  },
);

test("persisted product amounts use native configured rounding before editing or saving", async () => {
  const app = mount({ productAmount: 1.234 });
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Name" });
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Amount" }).value).toBe("1.23");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/chores"));
  expect(app.writes[0]?.body.product_amount).toBe("1.23");
});

test("hidden schedule number controls keep native monthly bounds until another period resets the value", async () => {
  const app = mount();
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Name" });
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  await user.selectOptions(screen.getByRole("combobox", { name: "Period type" }), "monthly");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Day of month" }), {
    target: { value: "32" },
  });
  await user.selectOptions(screen.getByRole("combobox", { name: "Period type" }), "hourly");
  expect(screen.queryByRole("spinbutton", { name: "Day of month" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toEqual([]);
  await user.selectOptions(screen.getByRole("combobox", { name: "Period type" }), "daily");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/chores"));
  expect(app.writes[0]?.body).toMatchObject({ period_type: "daily", period_days: "1" });
});

test.each([
  ["Cleaning spray", "9", "Bottle"],
  ["grcy:p:10:stock-entry", "10", "Piece"],
  ["SPRAY101", "9", "Bottle"],
])(
  "restricted chore product picker resolves %s and focuses the amount without altering barcode defaults",
  async (code, productId, unit) => {
    const app = mount();
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
    const picker = screen.getByRole<HTMLInputElement>("combobox", { name: "Product" });
    expect(picker.required).toBe(false);
    expect(picker.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Scan with camera" }).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Consume product on chore execution" }));
    await waitFor(() => expect(picker.disabled).toBe(false));

    if (code === "Cleaning spray") {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(picker, code);
      fireEvent(picker, new Event("input", { bubbles: true }));
    } else await user.type(picker, `${code}{Enter}`);
    await screen.findByText(unit);
    const amount = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect(amount.value).toBe("");
    fireEvent.change(amount, { target: { value: "1.25" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/chores"));
    expect(app.writes[0]?.body).toMatchObject({
      product_id: productId,
      product_amount: "1.25",
      consume_product_on_execution: "1",
    });
    expect(
      app.writes.some(
        (write) =>
          write.path.startsWith("/api/objects/products") ||
          write.path.startsWith("/api/objects/product_barcodes"),
      ),
    ).toBe(false);
  },
);

test("restricted chore picker keeps unknown optional text without assignment, creation, or external lookup workflows", async () => {
  const app = mount();
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Name" });
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  await user.click(screen.getByRole("checkbox", { name: "Consume product on chore execution" }));
  const picker = screen.getByRole<HTMLInputElement>("combobox", { name: "Product" });
  await waitFor(() => expect(picker.disabled).toBe(false));
  await user.type(picker, "Cleaning spray{Enter}");
  await screen.findByText("Bottle");
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("spinbutton", { name: "Amount" })),
  );
  await user.clear(picker);
  await user.type(picker, "UNKNOWN999{Enter}");
  await user.tab();
  expect(picker.value).toBe("UNKNOWN999");
  expect(screen.getByText("Bottle")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Create or assign product" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Add as|External barcode lookup/ })).toBeNull();
  expect(
    app.reads.some((path) => path.includes("external-lookup") || path.includes("?query")),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/chores"));
  expect(app.writes[0]?.body).toMatchObject({
    product_id: "",
    product_amount: "",
    consume_product_on_execution: "1",
  });
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/objects/chores/7",
    "/api/chores/executions/calculate-next-assignments",
  ]);
});

test.each([false, true])(
  "native Chore parallel fields use DOM wire values and last callback starts held assignments before fixed list completion (create %s)",
  async (create) => {
    const app = mount({
      create,
      nativeFields: true,
      imported: true,
      active: 2,
      holdStages: ["primary", "zeta", "alpha", "assignment"],
    });

    const name = await screen.findByLabelText<HTMLInputElement>("Name");

    if (create) await userEvent.type(name, "Created chore");
    else expect(name.value).toBe("ImportedChoreName");
    expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(create);
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Main line1\nMain line2" },
    });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Period type" }), "weekly");

    if (create) {
      await userEvent.click(screen.getByRole("checkbox", { name: "Friday" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Monday" }));
    }

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Assignment type" }),
      "random",
    );
    await userEvent.selectOptions(screen.getByRole("listbox", { name: "Assign to" }), ["2", "1"]);
    await userEvent.type(screen.getByLabelText("Last chore note"), "Edited first");
    fireEvent.change(screen.getByLabelText("First chore note"), {
      target: { value: "Custom line1\nCustom line2" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(1));
    expect.soft(app.writes[0]!.body).toMatchObject({
      name: create ? "Created chore" : "ImportedChoreName",
      description: "Main line1\r\nMain line2",
      active: create ? "1" : "0",
      period_type: "weekly",
      period_days: "1",
      period_config: "monday,friday",
      assignment_type: "random",
      assignment_config: "1,2",
      consume_product_on_execution: "0",
      track_date_only: "0",
      rollover: "0",
      start_date: "2020-01-02 03:04:00",
    });
    expect(app.writes[0]!.body).not.toHaveProperty("product_id");
    expect(name.matches(":disabled")).toBe(true);
    await app.release("primary");
    await waitFor(() => expect(app.writes).toHaveLength(3));
    const id = create ? 42 : 7;
    expect(app.writes.slice(1).map((write) => ({ path: write.path, body: write.body }))).toEqual([
      { path: `/api/userfields/chores/${id}`, body: { zeta: "Custom line1\nCustom line2" } },
      { path: `/api/userfields/chores/${id}`, body: { alpha: "Edited first" } },
    ]);
    await app.release("alpha");
    await waitFor(() => expect(app.writes).toHaveLength(4));
    expect(app.writes[3]).toMatchObject({
      path: "/api/chores/executions/calculate-next-assignments",
      body: { chore_id: create ? "42" : 7 },
    });
    expect(app.router.state.location.pathname).toBe(create ? "/chore/new" : "/chore/7");
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    expect(app.messages).not.toHaveBeenCalledWith(
      expect.objectContaining({ Message: "Reload" }),
      expect.anything(),
    );
    await app.release("assignment");
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/chores"));
    expect(app.router.state.location.searchStr).toBe("");
    expect(app.router.state.location.hash).toBe("");
    await app.release("zeta");
    expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
  },
);

test("no-grant Chore primary denial unlocks all source controls and repeats a fresh create with retained disabled product draft", async () => {
  const app = mount({ create: true, allowed: false, objectFailures: 1 });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.matches(":disabled")).toBe(false);
  await userEvent.type(name, "Retained create draft");
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Assignment type" }),
    "no-assignment",
  );
  const picker = screen.getByRole<HTMLInputElement>("combobox", { name: "Product" });
  const amount = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
  expect(picker.disabled).toBe(true);
  expect(amount.disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await userEvent.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  expect(
    within(await screen.findByRole("dialog", { name: "Error details" })).getByText(
      /Name already exists/,
    ),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(name.value).toBe("Retained create draft");
  expect(name.matches(":disabled")).toBe(false);
  expect(picker.disabled).toBe(false);
  expect(amount.disabled).toBe(false);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Consume product on chore execution" })
      .checked,
  ).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/chores"));
  expect(app.writes.map((write) => ({ path: write.path, method: write.method }))).toEqual([
    { path: "/api/objects/chores", method: "POST" },
    { path: "/api/objects/chores", method: "POST" },
    { path: "/api/chores/executions/calculate-next-assignments", method: "POST" },
  ]);
  expect(app.writes[0]!.body).not.toHaveProperty("product_id");
  expect(app.writes[1]!.body).toMatchObject({
    name: "Retained create draft",
    consume_product_on_execution: "0",
    product_id: "",
    product_amount: "",
  });
  expect(app.writes[2]!.body).toEqual({ chore_id: "43" });
});

test("native Chore file metadata gates actual bytes and departure retires upload/assignment while a sent write stales replacement data", async () => {
  const app = mount({ nativeFields: true, holdStages: ["attachment", "upload"] });
  await screen.findByLabelText("Name");
  const file = new File(["Native Chore file bytes"], "chore.pdf", { type: "application/pdf" });
  await userEvent.upload(screen.getByLabelText("Chore attachment"), file);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  const packed = String(app.writes[1]!.body.attachment);
  expect(atob(packed.split("_")[1]!)).toBe("chore.pdf");
  expect(app.files).toEqual([]);
  await app.release("attachment");
  await waitFor(() => expect(app.files).toHaveLength(1));
  expect(app.files[0]!.method).toBe("PUT");
  expect(app.files[0]!.body).toBe(file);
  expect(atob(decodeURIComponent(app.files[0]!.path.split("/").at(-1)!))).toBe(
    atob(packed.split("_")[0]!),
  );
  expect(app.writes.some((write) => write.path.includes("calculate-next-assignments"))).toBe(false);
  await act(async () => app.router.navigate({ href: "/chores" }));
  app.client.setQueryData(["objects", "chores"], [{ id: 7, name: "Fresh replacement read" }]);
  expect(app.files[0]!.signal?.aborted).toBe(true);
  await app.release("upload");
  expect(app.client.getQueryState(["objects", "chores"])?.isInvalidated).toBe(true);
  expect(app.writes).toHaveLength(2);
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
});

test("native Chore code controls retain independent print payloads outside save busy and ordinary prefixed Download", async () => {
  const app = mount({ basepath: "/house.hold/index.php", holdStages: ["labels", "primary"] });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  const preview = await screen.findByRole("img");
  expect.soft(preview.hasAttribute("width")).toBe(false);
  expect.soft(preview.hasAttribute("height")).toBe(false);
  await userEvent.clear(name);
  await userEvent.type(name, "Unfinished Chore draft");
  const print = screen.getByText("Print on label printer");
  await userEvent.click(print);
  await userEvent.click(print);
  await waitFor(() => expect(app.labels).toHaveLength(2));
  expect(name.matches(":disabled")).toBe(false);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  expect(app.router.state.location.hash).toBe("keep");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
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
      body: { chore_id: 7, request: 2, station: "Kitchen" },
    },
    {
      method: "POST",
      type: "application/json",
      body: { chore_id: 7, request: 1, station: "Kitchen" },
    },
  ]);
  const download = screen.getByRole("link", { name: "Download" });
  expect(download.getAttribute("href")).toBe(
    "/house.hold/index.php/chore/7/grocycode?download=true",
  );
  expect(download.hasAttribute("download")).toBe(false);
  expect(app.reads.some((path) => path.includes("download=true"))).toBe(false);
  expect(screen.queryByText("Label request sent")).toBeNull();
  await act(async () => app.router.navigate({ href: "/chores" }));
  expect(app.labels[2]!.signal?.aborted).toBe(true);
  await act(async () => app.labels[2]!.gate.release());
  await app.release("primary");
  expect(app.printer).toHaveLength(2);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:chore");
  expect(screen.queryByText("Error while executing WebHook")).toBeNull();
});

test.each(["label", "webhook"])(
  "native Chore %s error follows its own source destination without lock or success receipt",
  async (stage) => {
    const app = mount({ failStages: [stage] });
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    await userEvent.click(screen.getByText("Print on label printer"));
    await waitFor(() => expect(app.labels).toHaveLength(1));

    if (stage === "webhook") {
      await userEvent.click(
        await screen.findByRole("button", { name: /Error while executing WebHook/ }),
      );
      expect(
        within(await screen.findByRole("dialog", { name: "Error details" })).getByText("undefined"),
      ).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(app.printer).toHaveLength(1);
    } else {
      await act(async () => {});
      expect(app.printer).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
    }

    expect(screen.queryByText(/Private Chore label failure|Label request sent/)).toBeNull();
    await userEvent.type(name, " retained");
    expect(name.value).toBe("Clean selected room retained");
    expect(app.writes).toEqual([]);
  },
);
