import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import type { JsonObject } from "@/lib/json";

function unitGate() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountUnit(
  path: string,
  {
    failFields = false,
    denied = false,
    holdObject = false,
    plural = false,
    holdSettings = false,
    basepath = "/",
    noCustomFields = false,
    nativeFields = false,
    imported = false,
    active = 1,
    denyOnce = false,
    holdStages = new Array<string>(),
    failStages = new Array<string>(),
  } = {},
) {
  const units = [
    {
      id: 1,
      name: imported ? "Imported\rUnit\nName" : "Box",
      name_plural: imported ? "Imported\rPlural\nName" : "Boxes",
      plural_forms: "",
      active,
      description: imported ? "Main line1\nMain line2" : "For packaging",
    },
    {
      id: 2,
      name: "Bottle",
      name_plural: "Bottles",
      plural_forms: "",
      active: 1,
      description: "For liquids",
    },
    {
      id: 3,
      name: "Disabled unit",
      name_plural: "Disabled units",
      plural_forms: "",
      active: 0,
      description: "Old",
    },
  ];

  const conversions = [
    { id: 4, from_qu_id: 1, to_qu_id: 2, factor: 2.3456, product_id: null },
    { id: 5, from_qu_id: 1, to_qu_id: 3, factor: 9, product_id: 3 },
    { id: 6, from_qu_id: 1, to_qu_id: 3, factor: 10, product_id: null },
  ];

  if (plural) units[0]!.plural_forms = "Boxes-few\nBoxes-many";
  const gates = new Map<string, ReturnType<typeof unitGate>>();
  const signals: { url: string; signal?: AbortSignal | null }[] = [];
  const files: { url: string; body?: BodyInit | null; signal?: AbortSignal | null }[] = [];
  let primaryAttempts = 0;

  const gate = (stage: string) => {
    if (!gates.has(stage)) gates.set(stage, unitGate());

    return gates.get(stage)!;
  };

  const writes: Array<{ url: string; method: string; body: JsonObject }> = [];
  let fail = failFields;
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const definitions = noCustomFields
    ? []
    : nativeFields
      ? ["quantity_units", "quantity_unit_conversions"].flatMap((entity, index) => [
          {
            ...notesField(entity),
            id: index * 4 + 1,
            name: "zeta",
            caption: "First unit note",
            type: "text-multi-line",
          },
          {
            ...notesField(entity),
            id: index * 4 + 2,
            name: "clean",
            caption: "Clean unit note",
          },
          {
            ...notesField(entity),
            id: index * 4 + 3,
            name: "alpha",
            caption: "Last unit note",
          },
          {
            ...notesField(entity),
            id: index * 4 + 4,
            name: "attachment",
            caption: "Unit attachment",
            type: "file",
          },
        ])
      : [notesField("quantity_units"), { ...notesField("quantity_unit_conversions"), id: 2 }];

  const app = mountNativeEditor(
    path,
    async (url, options) => {
      if (url === "/api/user/settings") {
        const response = () => Response.json({ stock_decimal_places_amounts: 2 });

        return holdSettings ? held.then(response) : response();
      }

      if (plural && url.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "ro",
          direction: "ltr",
          languages: ["ro"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms":
              "nplurals=3; plural=(n == 1 ? 0 : (n == 0 || (n % 100 > 0 && n % 100 < 20)) ? 1 : 2);",
            messages: { "": {} },
          },
        });

      if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: !denied });

      if (
        options?.method === "DELETE" &&
        url.startsWith("/api/objects/quantity_unit_conversions/")
      ) {
        writes.push({ url, method: "DELETE", body: {} });
        const index = conversions.findIndex((row) => row.id === Number(url.split("/").at(-1)));

        if (index >= 0) conversions.splice(index, 1);

        return new Response(null, { status: 204 });
      }

      if (
        url === "/api/objects/userfields" ||
        url === "/api/v2/custom-data/fields" ||
        url.startsWith("/api/objects/userfields?query[]=entity=quantity_")
      )
        return Response.json(
          definitions.filter(
            (field) =>
              !url.includes("?") ||
              field.entity ===
                new URL(url, "http://test.invalid").searchParams.get("query[]")?.slice(7),
          ),
        );

      if (url.startsWith("/api/userfields/") && options?.method !== "PUT")
        return Response.json(
          nativeFields
            ? {
                zeta: "",
                clean: "Untouched metadata",
                alpha: "",
                attachment: `${btoa("old-unit.pdf")}_${btoa("Old unit.pdf")}`,
              }
            : { note: "Existing note" },
        );

      if (url.startsWith("/api/files/userfiles/") && options?.method === "PUT") {
        files.push({ url, body: options.body, signal: options.signal });

        if (holdStages.includes("upload")) await gate("upload").promise;

        return new Response(null, { status: 204 });
      }

      if (
        options?.method &&
        ["POST", "PUT"].includes(options.method) &&
        !url.includes("/api/user/settings/")
      ) {
        const body = JSON.parse(String(options.body));
        writes.push({ url, method: options.method, body });
        signals.push({ url, signal: options.signal });
        const secondary = url.startsWith("/api/userfields/");
        const stage = secondary ? Object.keys(body)[0]! : "primary";

        if (!secondary) primaryAttempts++;

        if (holdStages.includes(stage)) await gate(stage).promise;

        if (failStages.includes(stage))
          return Response.json({ error_message: `Unit ${stage} unavailable` }, { status: 503 });

        if (denied || (denyOnce && !secondary && primaryAttempts === 1))
          return Response.json({ error_message: "Permission denied" }, { status: 403 });

        if (url.startsWith("/api/userfields/")) {
          if (fail) {
            fail = false;

            return Response.json({ error_message: "Custom fields unavailable" }, { status: 500 });
          }

          return new Response(null, { status: 204 });
        }

        const finish = () => {
          if (url === "/api/objects/quantity_units") {
            units.push({
              id: 9,
              name: String(body.name),
              name_plural: String(body.name_plural),
              plural_forms: String(body.plural_forms ?? ""),
              active: Number(body.active),
              description: String(body.description),
            });

            return Response.json({ created_object_id: 9 });
          }

          if (url.startsWith("/api/objects/quantity_units/"))
            Object.assign(
              units.find((unit) => unit.id === Number(url.split("/").at(-1)))!,
              body,
              { active: Number(body.active) },
            );

          return options.method === "POST"
            ? Response.json({ created_object_id: 8 })
            : new Response(null, { status: 204 });
        };

        return holdObject ? held.then(finish) : finish();
      }

      if (url === "/api/objects/quantity_units") return Response.json(units);

      if (url.startsWith("/api/objects/quantity_units/")) {
        const row = units.find((unit) => unit.id === Number(url.split("/").at(-1)));

        return row
          ? Response.json({ ...row, userfields: noCustomFields ? null : { note: "Existing note" } })
          : Response.json({ error_message: "Object not found" }, { status: 404 });
      }

      if (url === "/api/objects/quantity_unit_conversions") return Response.json(conversions);

      if (url.startsWith("/api/objects/quantity_unit_conversions/")) {
        const row = conversions.find((item) => item.id === Number(url.split("/").at(-1)));

        return row
          ? Response.json(row)
          : Response.json({ error_message: "Object not found" }, { status: 404 });
      }

      if (url === "/api/objects/products/3")
        return Response.json({ id: 3, name: "Juice", qu_id_stock: 2 });

      return undefined;
    },
    {},
    { basepath },
  );

  return {
    ...app,
    writes,
    units,
    release,
    held,
    signals,
    files,
    async releaseStage(stage: string) {
      await act(async () => gate(stage).release());
    },
  };
}

test("selected unit editing preserves singular/plural fields and default conversions then returns after field save", async () => {
  const app = mountUnit("/quantityunit/1");
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Edit quantity unit" });

  const name = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Name in singular form",
  });

  expect(name.value).toBe("Box");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name in plural form" }).value).toBe(
    "Boxes",
  );
  const conversions = screen.getByRole("table", { name: "Default conversions" });
  expect(within(conversions).getByText("2.35")).toBeTruthy();
  expect(
    within(conversions)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent),
  ).toEqual(["10", "2.35"]);
  expect(within(conversions).queryByText("9")).toBeNull();
  expect(
    within(conversions).getAllByRole("link", { name: "Edit this item" })[1]?.getAttribute("href"),
  ).toContain("/quantityunitconversion/4?embedded=&qu-unit=1");
  await user.clear(name);
  await user.type(name, "Crate");
  await user.keyboard("{Enter}");
  expect(app.writes).toHaveLength(0);
  await user.click(screen.getByRole("checkbox", { name: "Active" }));
  await user.clear(screen.getByLabelText("Owner note"));
  await user.type(screen.getByLabelText("Owner note"), "Fragile");
  await user.click(screen.getByRole("button", { name: "Save & return to quantity units" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/quantityunits"));
  expect(app.writes.map((write) => write.url)).toEqual([
    "/api/objects/quantity_units/1",
    "/api/userfields/quantity_units/1",
  ]);
  expect(app.writes[0]?.body).toEqual({
    name: "Crate",
    name_plural: "Boxes",
    description: "For packaging",
    active: "0",
  });
});

test("creating a unit with final custom-field failure stays silently busy without partial retry", async () => {
  const app = mountUnit("/quantityunit/new", { failFields: true });
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Name in singular form" }),
    "Sachet",
  );
  await userEvent.type(screen.getByLabelText("Owner note"), "Custom note");
  await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  await act(async () => {});
  expect(screen.queryAllByText(/Custom fields unavailable|The record is saved/)).toEqual([]);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByRole("button", { name: "Save & continue" }).matches(":disabled")).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(app.router.state.location.pathname).toBe("/quantityunit/new");
  expect(app.writes.map((write) => write.url)).toEqual([
    "/api/objects/quantity_units",
    "/api/userfields/quantity_units/9",
  ]);
});

test("unit conversion pins its source, validates distinct units and returns after object then custom fields", async () => {
  const app = mountUnit("/quantityunitconversion/new?qu-unit=1");
  const user = userEvent.setup();

  const from = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Quantity unit from",
  });

  expect(from.value).toBe("1");
  expect(from.disabled).toBe(true);
  const to = screen.getByRole("combobox", { name: "Quantity unit to" });
  expect(within(to).queryByRole("option", { name: "Disabled unit" })).toBeNull();
  await user.selectOptions(to, "1");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  await user.selectOptions(to, "2");
  await user.clear(screen.getByRole("spinbutton", { name: "Factor" }));
  await user.type(screen.getByRole("spinbutton", { name: "Factor" }), "0");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  await user.clear(screen.getByRole("spinbutton", { name: "Factor" }));
  await user.type(screen.getByRole("spinbutton", { name: "Factor" }), "2.5");
  expect(screen.getByText("This means 1 Box is the same as 2.5 Bottles")).toBeTruthy();
  expect(screen.getByText("This means 1 Bottle is the same as 0.4 Boxes")).toBeTruthy();
  await user.type(screen.getByLabelText("Owner note"), "Conversion note");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/quantityunit/1"));
  expect(app.writes.map((write) => write.url)).toEqual([
    "/api/objects/quantity_unit_conversions",
    "/api/userfields/quantity_unit_conversions/8",
  ]);
  expect(app.writes[0]?.body).toEqual({ from_qu_id: "1", to_qu_id: "2", factor: "2.5" });
});

test("product conversion defaults to stock unit and sends native parent messages after saving", async () => {
  const post = vi.spyOn(window.parent, "postMessage");
  onTestFinished(() => post.mockRestore());
  const app = mountUnit("/quantityunitconversion/new?embedded&product=3");
  const user = userEvent.setup();

  const from = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Quantity unit from",
  });

  expect(from.value).toBe("2");
  expect(from.disabled).toBe(false);
  expect(screen.getByText("Juice")).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Quantity unit to" }), "1");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      { Message: "CloseLastModal", Payload: null },
      window.location.origin,
    ),
  );
  expect(
    post.mock.calls.flatMap((call) =>
      ["ProductQUConversionChanged", "CloseLastModal"].includes(call[0]?.Message) ? [call[0]] : [],
    ),
  ).toEqual([
    { Message: "ProductQUConversionChanged", Payload: null },
    { Message: "CloseLastModal", Payload: null },
  ]);
  expect(app.writes[0]?.body.product_id).toBe("3");
  expect(app.router.state.location.pathname).toBe("/quantityunitconversion/new");
});

test("selected conversion rounds saved factors to amount precision and keeps its endpoint on edit", async () => {
  const app = mountUnit("/quantityunitconversion/4?qu-unit=1&embedded");
  const user = userEvent.setup();
  const post = vi.spyOn(window.parent, "postMessage");
  onTestFinished(() => post.mockRestore());
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Factor" })).value).toBe(
    "2.35",
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith({ Message: "Reload", Payload: null }, window.location.origin),
  );
  expect(app.writes[0]).toEqual({
    url: "/api/objects/quantity_unit_conversions/4",
    method: "PUT",
    body: { from_qu_id: "1", to_qu_id: "2", factor: "2.35" },
  });
});

test("denied native writes retain visible controls and expose primary generic details", async () => {
  const app = mountUnit("/quantityunit/1", { denied: true });
  await screen.findByRole("textbox", { name: "Name in singular form" });
  await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
  await userEvent.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  expect(
    within(await screen.findByRole("dialog", { name: "Error details" })).getByText(
      /Permission denied/,
    ),
  ).toBeTruthy();
  expect(app.writes[0]?.url).toBe("/api/objects/quantity_units/1");
  expect(app.router.state.location.pathname).toBe("/quantityunit/1");
});

test("departure while the unit write is held prevents later custom-field writes and navigation", async () => {
  const app = mountUnit("/quantityunit/new", { holdObject: true });
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Name in singular form" }), "Can");
  await user.type(screen.getByLabelText("Owner note"), "Unsent fields");
  await user.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await act(async () => {
    app.release();
    await app.held;
  });
  expect(app.writes).toHaveLength(1);
  expect(app.router.state.location.pathname).toBe("/settings");
});

test("native plural testing opens the stored unit without saving its pending draft", async () => {
  const app = mountUnit("/quantityunit/1", { plural: true });
  const user = userEvent.setup();

  const name = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Name in singular form",
  });

  await user.type(name, " Unsaved");
  await user.type(screen.getByLabelText("Owner note"), " Pending note");
  await user.click(screen.getByRole("button", { name: "Test plural forms" }));
  const frame = await screen.findByTitle<HTMLIFrameElement>("Test plural forms");
  expect(frame.src).toContain("/quantityunitpluraltesting?embedded=&qu=1");
  expect(app.writes).toHaveLength(0);
  expect(app.units[0]?.name).toBe("Box");
  await user.click(
    within(screen.getByRole("dialog", { name: "Test plural forms" })).getByRole("button", {
      name: "Close",
    }),
  );
  expect(name.disabled).toBe(false);
  expect(name.closest("fieldset")?.disabled).toBe(false);
  expect(name.value).toBe("Box Unsaved");
  expect(app.writes).toHaveLength(0);
  expect(app.router.state.location.pathname).toBe("/quantityunit/1");
});

test("native create plural Test raises the source missing-ID error without saving, then Return inherits stay", async () => {
  const errors: Error[] = [];

  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    errors.push(event.error);
  };

  window.addEventListener("error", onError);
  onTestFinished(() => window.removeEventListener("error", onError));
  const app = mountUnit("/quantityunit/new", { plural: true });
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Name in singular form" }),
    "Carton",
  );
  await userEvent.click(screen.getByRole("button", { name: "Test plural forms" }));
  await waitFor(() => expect(errors).toHaveLength(1));
  expect(errors[0]?.message).toMatch(/undefined.*toString/);
  expect(app.writes).toHaveLength(0);
  expect(screen.queryByTitle("Test plural forms")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save & return to quantity units" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => {});
  expect(app.router.state.location.pathname).toBe("/quantityunit/new");
  expect(
    screen.getByRole("button", { name: "Save & return to quantity units" }).matches(":disabled"),
  ).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
});

test("quantity-unit plural tester deep link applies locale plural forms and retains the last result when cleared", async () => {
  const app = mountUnit("/quantityunitpluraltesting?embedded&qu=1", { plural: true });
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Result: Box" });
  const amount = screen.getByRole("spinbutton", { name: "Amount" });
  await user.clear(amount);
  await user.type(amount, "2");
  expect(screen.getByRole("heading", { name: "Result: Boxes-few" })).toBeTruthy();
  await user.clear(amount);
  await user.type(amount, "20");
  expect(screen.getByRole("heading", { name: "Result: Boxes-many" })).toBeTruthy();
  await user.clear(amount);
  expect(screen.getByRole("heading", { name: "Result: Boxes-many" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Disabled unit" })).toBeNull();
  await act(async () =>
    app.router.navigate({ to: "/quantityunitpluraltesting", search: { qu: "2", embedded: "" } }),
  );
  await screen.findByRole("heading", { name: "Result: Bottle" });
});

test("removing a default conversion reloads the unit and discards its unsaved form changes", async () => {
  const app = mountUnit("/quantityunit/1");
  const user = userEvent.setup();

  const name = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Name in singular form",
  });

  await user.type(name, " Unsaved");
  const table = screen.getByRole("table", { name: "Default conversions" });
  await user.click(within(table).getAllByRole("button", { name: "Delete this item" })[0]!);
  const dialog = screen.getByRole("dialog", { name: "Delete this item" });
  expect(within(dialog).getByText("Are you sure you want to remove this conversion?")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(screen.queryByText("10")).toBeNull());
  expect(
    (await screen.findByRole<HTMLInputElement>("textbox", { name: "Name in singular form" })).value,
  ).toBe("Box");
  expect(app.writes).toEqual([
    { url: "/api/objects/quantity_unit_conversions/6", method: "DELETE", body: {} },
  ]);
});

test.each(["/quantityunit/999", "/quantityunitconversion/999?qu-unit=1"])(
  "missing selected record does not fall back to a create form %s",
  async (path) => {
    const app = mountUnit(path);
    await screen.findByText("Object not found");
    expect(screen.queryByRole("form")).toBeNull();
    expect(app.writes).toHaveLength(0);
  },
);

test("conversion normalization waits for the saved amount precision settings", async () => {
  const app = mountUnit("/quantityunitconversion/4?qu-unit=1", { holdSettings: true });
  await waitFor(() =>
    expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/user/settings")).toBe(
      true,
    ),
  );
  await act(async () => {});
  expect(screen.queryByRole("spinbutton", { name: "Factor" })).toBeNull();
  expect(app.writes).toEqual([]);
  await act(async () => {
    app.release();
    await app.held;
  });
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Factor" })).value).toBe(
    "2.35",
  );
});

test("unit tester and embedded conversion links retain the configured frontend basepath", async () => {
  mountUnit("/house/quantityunit/1", { plural: true, basepath: "/house" });
  const user = userEvent.setup();
  await screen.findByRole("textbox", { name: "Name in singular form" });
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toContain(
    "/house/quantityunitconversion/new?",
  );
  await user.click(screen.getByRole("button", { name: "Test plural forms" }));
  const frame = await screen.findByTitle<HTMLIFrameElement>("Test plural forms");
  expect(new URL(frame.src).pathname).toBe("/house/quantityunitpluraltesting");
});

test("a selected native unit with no custom-field definitions accepts userfields null", async () => {
  mountUnit("/quantityunit/1", { noCustomFields: true });
  expect(
    (await screen.findByRole<HTMLInputElement>("textbox", { name: "Name in singular form" })).value,
  ).toBe("Box");
  expect(screen.queryByLabelText("Owner note")).toBeNull();
});

const unitSubjects = [
  { entity: "quantity_units", path: "/quantityunit/new?embedded", create: true },
  { entity: "quantity_units", path: "/quantityunit/1?embedded", create: false },
  {
    entity: "quantity_unit_conversions",
    path: "/quantityunitconversion/new?qu-unit=1&embedded",
    create: true,
  },
  {
    entity: "quantity_unit_conversions",
    path: "/quantityunitconversion/4?qu-unit=1&embedded",
    create: false,
  },
] as const;

test.each(unitSubjects)(
  "native $entity create=$create captures its actual controls then completes on the last independent field",
  async (subject) => {
    const app = mountUnit(subject.path, {
      nativeFields: true,
      imported: true,
      active: subject.entity === "quantity_units" ? 2 : 1,
      plural: true,
      holdStages: ["primary", "zeta", "alpha"],
    });

    const unit = subject.entity === "quantity_units";

    if (unit) {
      const name = await screen.findByLabelText<HTMLInputElement>("Name in singular form");

      if (subject.create) await userEvent.type(name, "Native unit");
      else expect(name.value).toBe("ImportedUnitName");
      expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(subject.create);

      if (subject.create)
        await userEvent.type(screen.getByLabelText("Name in plural form"), "Native units");
      else
        expect(screen.getByLabelText<HTMLInputElement>("Name in plural form").value).toBe(
          "ImportedPluralName",
        );
      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: "Main line1\nMain line2" },
      });
      fireEvent.change(screen.getByRole("textbox", { name: /^Plural forms/ }), {
        target: { value: "Plural few\nPlural many" },
      });
    } else {
      const from = await screen.findByRole<HTMLSelectElement>("combobox", {
        name: "Quantity unit from",
      });

      expect(from.value).toBe("1");
      expect(from.disabled).toBe(true);
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Quantity unit to" }),
        "2",
      );
      fireEvent.change(screen.getByRole("spinbutton", { name: "Factor" }), {
        target: { value: "02.50" },
      });
    }

    await userEvent.type(screen.getByLabelText("Last unit note"), "Edited first");
    fireEvent.change(screen.getByLabelText("First unit note"), {
      target: { value: "Custom line1\nCustom line2" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: unit ? "Save & return to quantity units" : "Save" }),
    );
    await waitFor(() => expect(app.writes).toHaveLength(1));
    const recordId = subject.create ? (unit ? 9 : 8) : unit ? 1 : 4;
    expect.soft(app.writes[0]).toEqual({
      url: `/api/objects/${subject.entity}${subject.create ? "" : `/${recordId}`}`,
      method: subject.create ? "POST" : "PUT",
      body: unit
        ? {
            name: subject.create ? "Native unit" : "ImportedUnitName",
            name_plural: subject.create ? "Native units" : "ImportedPluralName",
            active: subject.create ? "1" : "0",
            description: "Main line1\r\nMain line2",
            plural_forms: "Plural few\r\nPlural many",
          }
        : { from_qu_id: "1", to_qu_id: "2", factor: "02.50" },
    });
    await app.releaseStage("primary");
    await waitFor(() => expect(app.writes).toHaveLength(3));
    expect(app.writes.slice(1)).toEqual([
      {
        url: `/api/userfields/${subject.entity}/${recordId}`,
        method: "PUT",
        body: { zeta: "Custom line1\nCustom line2" },
      },
      {
        url: `/api/userfields/${subject.entity}/${recordId}`,
        method: "PUT",
        body: { alpha: "Edited first" },
      },
    ]);
    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    await app.releaseStage("alpha");
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(app.router.state.location.pathname).toBe(subject.path.split("?")[0]);
    expect(document.body.classList.contains("cursor-busy")).toBe(true);
    await app.releaseStage("zeta");
    expect(post.mock.calls.filter(([bag]) => bag?.Message === "Reload")).toHaveLength(1);
  },
);

test.each(["quantity_units", "quantity_unit_conversions"])(
  "native %s denied create unlocks a fresh exact primary instead of partial retry",
  async (entity) => {
    const unit = entity === "quantity_units";

    const app = mountUnit(
      unit ? "/quantityunit/new?embedded" : "/quantityunitconversion/new?qu-unit=1&embedded",
      { denyOnce: true },
    );

    const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

    if (unit)
      await userEvent.type(await screen.findByLabelText("Name in singular form"), "Retained draft");
    else {
      await screen.findByRole("combobox", { name: "Quantity unit from" });
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Quantity unit to" }),
        "2",
      );
    }

    const button = screen.getByRole("button", {
      name: unit ? "Save & return to quantity units" : "Save",
    });

    await userEvent.click(button);
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Error while saving, probably this item already exists/,
      }),
    );
    expect(
      within(await screen.findByRole("dialog", { name: "Error details" })).getByText(
        /Permission denied/,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(button.matches(":disabled")).toBe(false);

    if (!unit)
      expect(
        screen.getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit from" }).disabled,
      ).toBe(false);
    await userEvent.click(button);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(app.writes).toHaveLength(2);
    expect(app.writes[0]!.url).toBe(`/api/objects/${entity}`);
    expect(app.writes[1]).toEqual(app.writes[0]);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  },
);

test("conversion Enter saves live raw factor and product override after same-unit validity is cleared", async () => {
  const app = mountUnit("/quantityunitconversion/new?product=3");
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const from = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Quantity unit from",
  });

  const to = screen.getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit to" });
  expect(from.value).toBe("2");
  await userEvent.selectOptions(to, "2");
  expect(to.validity.customError).toBe(true);
  const factor = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Factor" });
  await userEvent.click(factor);
  await userEvent.keyboard("{Enter}");
  expect(app.writes).toEqual([]);
  await userEvent.selectOptions(to, "1");
  expect(to.validity.customError).toBe(false);
  fireEvent.change(factor, { target: { value: "02.50" } });
  await userEvent.click(factor);
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]!.body).toEqual({
    from_qu_id: "2",
    to_qu_id: "1",
    factor: "02.50",
    product_id: "3",
  });
  await waitFor(() =>
    expect(
      post.mock.calls
        .filter(([bag]) => ["ProductQUConversionChanged", "CloseLastModal"].includes(bag?.Message))
        .map(([bag]) => bag),
    ).toEqual([
      { Message: "ProductQUConversionChanged", Payload: null },
      { Message: "CloseLastModal", Payload: null },
    ]),
  );
});

test("Unit Continue rereads literal embedded and actually reloads the selected document while retiring earlier fields", async () => {
  const app = mountUnit("/quantityunit/1?embedded", {
    nativeFields: true,
    holdStages: ["zeta", "alpha"],
  });

  await screen.findByLabelText("Name in singular form");

  const oldReads = app.fetchMock.mock.calls.filter(
    ([url, init]) => String(url) === "/api/objects/quantity_units/1" && !init?.method,
  ).length;

  await userEvent.type(screen.getByLabelText("First unit note"), "Earlier pending");
  await userEvent.type(screen.getByLabelText("Last unit note"), "Final completes");
  await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() => expect(app.writes).toHaveLength(3));
  await act(async () => app.router.history.replace("/quantityunit/1?%65mbedded=1&unknown"));
  await app.releaseStage("alpha");
  await waitFor(() =>
    expect(
      app.fetchMock.mock.calls.filter(
        ([url, init]) => String(url) === "/api/objects/quantity_units/1" && !init?.method,
      ).length,
    ).toBeGreaterThan(oldReads),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save & continue" }).matches(":disabled")).toBe(
      false,
    ),
  );
  expect(app.router.history.location.search).toBe("?%65mbedded=1&unknown");
  expect(
    app.signals.find((request) => request.url.startsWith("/api/userfields/"))?.signal?.aborted,
  ).toBe(true);
  await app.releaseStage("zeta");
});

test.each([
  { query: "?qu-unit=01&qu-unit=2", target: "/quantityunit/01" },
  { query: "?qu-unit", target: "/quantityunit/true" },
  { query: "?qu-unit=", target: "/quantityunit/" },
  { query: "?qu-unit=01&%65mbedded=1", target: "/quantityunit/01" },
  { query: "?%71u-unit=1&%65mbedded", target: "messages" },
])("conversion completion uses live first literal parameters $query", async ({ query, target }) => {
  const app = mountUnit("/quantityunitconversion/4?qu-unit=1&embedded", {
    holdStages: ["primary"],
  });

  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const factor = await screen.findByRole("spinbutton", { name: "Factor" });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => app.router.history.replace(`/quantityunitconversion/4${query}`));
  expect(screen.getByRole("spinbutton", { name: "Factor" })).toBe(factor);
  expect(app.signals[0]!.signal?.aborted).toBe(false);
  await app.releaseStage("primary");

  if (target === "messages") {
    await waitFor(() =>
      expect(
        post.mock.calls
          .filter(([bag]) =>
            ["ProductQUConversionChanged", "CloseLastModal"].includes(bag?.Message),
          )
          .map(([bag]) => bag),
      ).toEqual([
        { Message: "ProductQUConversionChanged", Payload: null },
        { Message: "CloseLastModal", Payload: null },
      ]),
    );
    expect(post).not.toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    );
  } else await waitFor(() => expect(app.router.history.location.pathname).toBe(target));
});

test("conversion file metadata gates its bytes and departure retires upload but stales a sent write", async () => {
  const app = mountUnit("/quantityunitconversion/4?qu-unit=1&embedded", {
    nativeFields: true,
    holdStages: ["attachment", "upload"],
  });

  await screen.findByRole("spinbutton", { name: "Factor" });

  const file = new File(["Native conversion attachment"], "conversion.pdf", {
    type: "application/pdf",
  });

  await userEvent.upload(screen.getByLabelText("Unit attachment"), file);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  const packed = String(app.writes[1]!.body.attachment);
  expect(atob(packed.split("_")[1]!)).toBe("conversion.pdf");
  expect(app.files).toEqual([]);
  await app.releaseStage("attachment");
  await waitFor(() => expect(app.files).toHaveLength(1));
  expect(app.files[0]!.body).toBe(file);
  expect(atob(decodeURIComponent(app.files[0]!.url.split("/").at(-1)!))).toBe(
    atob(packed.split("_")[0]!),
  );
  await act(async () => app.router.navigate({ href: "/quantityunit/2" }));
  await screen.findByRole("heading", { name: "Edit quantity unit" });

  const keys = [
    ["objects", "quantity_unit_conversions"],
    ["objects", "quantity_unit_conversions_resolved"],
  ];

  for (const key of keys) {
    app.client.setQueryData(key, []);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
  }

  expect(app.files[0]!.signal?.aborted).toBe(true);
  await app.releaseStage("upload");

  for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(app.router.state.location.pathname).toBe("/quantityunit/2");
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
});

test("encoded-only qu-unit selects its PHP context but does not apply the literal JavaScript From lock", async () => {
  const app = mountUnit("/quantityunitconversion/new?%71u-unit=1");
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const from = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Quantity unit from",
  });

  expect(from.value).toBe("1");
  expect(from.disabled).toBe(false);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Quantity unit to" }), "2");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      post.mock.calls
        .filter(([bag]) => ["ProductQUConversionChanged", "CloseLastModal"].includes(bag?.Message))
        .map(([bag]) => bag),
    ).toEqual([
      { Message: "ProductQUConversionChanged", Payload: null },
      { Message: "CloseLastModal", Payload: null },
    ]),
  );
  expect(app.writes[0]!.body).toEqual({ from_qu_id: "1", to_qu_id: "2", factor: "1" });
});
