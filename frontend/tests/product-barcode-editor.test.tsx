import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import type { JsonObject } from "@/lib/json";
import type { UserfieldDefinition } from "@/lib/userfields";

function mount({
  path = "/productbarcodes/21?product=7&embedded",
  prices = true,
  canWrite = true,
  holdPrimary = false,
  holdField = false,
  failPrimary = false,
  savedUnit = 2,
  savedAmount = 2,
  precision = 4,
  heldSettings = false,
  templateUnit = false,
  purchaseActive = 1,
  fieldFile = false,
  storedFile = "",
  failField = false,
  failUpload = false,
  definitions,
  savedBarcode = "OLD",
  savedNote = "Existing note",
  heldValues = false,
  failValues = false,
  loadedValues,
  noConversions = false,
}: {
  path?: string;
  prices?: boolean;
  canWrite?: boolean;
  holdPrimary?: boolean;
  holdField?: boolean;
  failPrimary?: boolean | number;
  savedUnit?: number;
  savedAmount?: number;
  precision?: number;
  heldSettings?: boolean;
  templateUnit?: boolean;
  purchaseActive?: number;
  fieldFile?: boolean;
  storedFile?: string;
  failField?: boolean;
  failUpload?: boolean;
  definitions?: UserfieldDefinition[];
  savedBarcode?: string;
  savedNote?: string;
  heldValues?: boolean;
  failValues?: boolean;
  loadedValues?: Record<string, string | null> | Array<string | null>;
  noConversions?: boolean;
} = {}) {
  const writes: Array<{ path: string; body: JsonObject }> = [];
  const uploads: string[] = [];
  const files: Array<{ path: string; method: string; body: RequestInit["body"] }> = [];
  let primaryAttempts = 0;
  let valueReads = 0;
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  let releasePrimary = () => {};
  let releaseField = () => {};

  const primary = new Promise<void>((resolve) => {
    releasePrimary = resolve;
  });

  const field = new Promise<void>((resolve) => {
    releaseField = resolve;
  });

  let releaseValues = () => {};

  const values = new Promise<void>((resolve) => {
    releaseValues = resolve;
  });

  let releaseSettings = () => {};

  const settings = new Promise<void>((resolve) => {
    releaseSettings = resolve;
  });

  const app = mountNativeEditor(
    path,
    (url, options) => {
      if (url === "/api/system/info") return Response.json({ grocy_version: { Version: "test" } });

      if (url === "/api/user/settings")
        return (async () => {
          if (heldSettings) await settings;

          return Response.json({ stock_decimal_places_amounts: precision });
        })();

      if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: canWrite });

      if (
        url === "/api/objects/userfields" ||
        url === "/api/v2/custom-data/fields" ||
        url === "/api/objects/userfields?query[]=entity=product_barcodes"
      )
        return Response.json(
          definitions ?? [
            { ...notesField("product_barcodes"), id: 2, name: "batch", caption: "Batch" },
            {
              ...notesField("product_barcodes"),
              type: fieldFile ? "file" : "text-single-line",
              caption: fieldFile ? "Owner file" : "Owner note",
            },
          ],
        );

      if (url === "/api/objects/products/7")
        return Response.json({ id: 7, name: "Coffee", qu_id_purchase: 1 });

      if (url === "/api/objects/quantity_units")
        return Response.json([
          {
            id: 1,
            name: templateUnit ? "%s bottle" : "piece",
            name_plural: templateUnit ? "%s bottles" : "pieces",
            active: purchaseActive,
            plural_forms: templateUnit && purchaseActive === 0 ? "active-only forms" : null,
          },
          { id: 2, name: "pack", name_plural: "packs", active: 0 },
          { id: 3, name: "unrelated", active: 1 },
        ]);

      if (url === "/api/objects/quantity_unit_conversions_resolved")
        return Response.json([
          { product_id: 7, from_qu_id: 1, to_qu_id: 1, factor: 99 },
          { product_id: 7, from_qu_id: 1, to_qu_id: 2, factor: 0.5 },
          { product_id: 7, from_qu_id: 2, to_qu_id: 1, factor: 2 },
          { product_id: 7, from_qu_id: 3, to_qu_id: 3, factor: 1 },
          { product_id: 99, from_qu_id: 1, to_qu_id: 3, factor: 1 },
          { product_id: null, from_qu_id: 1, to_qu_id: 3, factor: 5 },
        ]);

      if (url === "/api/v2/quantity-unit-conversions/resolved?product=7")
        return Response.json({
          product: { id: 7, name: "Coffee" },
          units: [{ id: 1, name: "piece" }],
          rows: noConversions
            ? []
            : [
                { id: 1, from_qu_id: 1, to_qu_id: 1, factor: "99" },
                { id: 2, from_qu_id: 1, to_qu_id: 2, factor: "0.25" },
                { id: 3, from_qu_id: 2, to_qu_id: 1, factor: "2" },
                { id: 4, from_qu_id: 3, to_qu_id: 3, factor: "1" },
              ],
        });

      if (url === "/api/objects/shopping_locations")
        return Response.json([
          { id: 2, name: "Market", active: 1 },
          { id: 9, name: "Old store", active: 0 },
        ]);

      if (url === "/api/objects/product_barcodes/21" && !options?.method)
        return Response.json({
          id: 21,
          product_id: 7,
          barcode: savedBarcode,
          amount: savedAmount,
          qu_id: savedUnit,
          shopping_location_id: 9,
          note: savedNote,
        });

      if (url === "/api/userfields/product_barcodes/21" && !options?.method)
        return (async () => {
          valueReads++;

          if (heldValues) await values;

          return failValues
            ? Response.json({ error_message: "Initial field values unavailable" }, { status: 503 })
            : Response.json(loadedValues ?? { note: fieldFile ? storedFile : "Custom note" });
        })();

      if (url.startsWith("/api/files/userfiles/") && options?.method === "DELETE") {
        files.push({ path: url, method: "DELETE", body: options.body });

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/files/userfiles/") && options?.method === "PUT") {
        uploads.push(url);
        files.push({ path: url, method: "PUT", body: options.body });

        return failUpload
          ? Response.json({ error_message: "File upload failed" }, { status: 500 })
          : new Response(null, { status: 204 });
      }

      if (options?.method === "POST" || options?.method === "PUT") {
        writes.push({ path: url, body: JSON.parse(String(options.body)) });

        if (url.startsWith("/api/objects/product_barcodes"))
          return (async () => {
            primaryAttempts += 1;

            if (holdPrimary) await primary;

            if (!canWrite)
              return Response.json(
                { error_message: "Permission missing: MASTER_DATA_EDIT" },
                { status: 403 },
              );

            if (failPrimary === true || primaryAttempts <= Number(failPrimary))
              return Response.json({ error_message: "Barcode already used" }, { status: 400 });

            return options.method === "POST"
              ? Response.json({ created_object_id: "31" })
              : new Response(null, { status: 204 });
          })();

        if (url.startsWith("/api/userfields/product_barcodes/"))
          return (async () => {
            if (holdField) await field;

            if (failField)
              return Response.json({ error_message: "Field reference failed" }, { status: 500 });

            return new Response(null, { status: 204 });
          })();

        return new Response(null, { status: 204 });
      }
    },
    { FEATURE_FLAG_STOCK: true, FEATURE_FLAG_STOCK_PRICE_TRACKING: prices },
  );

  const messages = () =>
    parent.mock.calls.filter(
      ([message]) =>
        message?.Message === "ProductBarcodesChanged" || message?.Message === "CloseLastModal",
    );

  return {
    ...app,
    writes,
    uploads,
    files,
    messages,
    releasePrimary,
    releaseField,
    releaseSettings,
    releaseValues,
    valueReads: () => valueReads,
  };
}

test("Barcode selected Load accepts numeric PHP arrays", async () => {
  const app = mount({
    definitions: [
      { ...notesField("product_barcodes"), name: "0", caption: "Numeric first" },
      { ...notesField("product_barcodes"), id: 2, name: "1", caption: "Numeric second" },
    ],
    loadedValues: ["First loaded", null],
  });

  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Numeric first").value).toBe("First loaded"),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Numeric second").value).toBe("");
  expect(app.valueReads()).toBe(1);
});

test("Barcode initial Load runs once while later actual query refreshes preserve the draft", async () => {
  const loaded = { note: "Initial stored note" };
  const app = mount({ loadedValues: loaded });
  const note = await screen.findByLabelText<HTMLInputElement>("Owner note");
  await waitFor(() => expect(note.value).toBe("Initial stored note"));
  await userEvent.clear(note);
  await userEvent.type(note, "Current unsaved note");
  loaded.note = "Later server value";
  await act(async () => app.client.refetchQueries());
  expect(screen.getByLabelText("Owner note")).toBe(note);
  expect(note.value).toBe("Current unsaved note");
  expect(app.valueReads()).toBe(1);
  expect(app.writes).toEqual([]);
});

function fileText(body: RequestInit["body"]) {
  if (!(body instanceof File)) throw new Error("The upload body must contain a file");

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(body);
  });
}

test("a failed barcode update keeps the new file draft while an older metadata stage reads live bytes", async () => {
  const app = mount({ fieldFile: true, holdField: true, failPrimary: 2 });
  const user = userEvent.setup();
  const input = await screen.findByLabelText<HTMLInputElement>("Owner file");
  const first = new File(["Original selection bytes"], "First.txt", { type: "text/plain" });
  const next = new File(["Replacement selection bytes"], "Next.txt", { type: "text/plain" });
  await user.upload(input, first);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(input.closest("fieldset")?.disabled).toBe(false));

  const firstReference = String(
    app.writes.find((write) => write.path.includes("/userfields/"))?.body.note,
  );

  expect(atob(firstReference.split("_")[1]!)).toBe("first.txt");
  expect(app.files).toEqual([]);
  await user.upload(input, next);
  await act(async () => app.releaseField());
  await waitFor(() => expect(app.uploads).toHaveLength(1));
  expect(await fileText(app.files[0]?.body)).toBe("Replacement selection bytes");
  expect(app.files[0]?.path).toBe(
    `/api/files/userfiles/${encodeURIComponent(firstReference.split("_")[0]!)}`,
  );
  expect(input.files?.[0]).toBe(next);
  expect(screen.getByText("Next.txt")).toBeTruthy();
  expect(app.messages()).toEqual([]);

  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.uploads).toHaveLength(2));
  await waitFor(() => expect(input.closest("fieldset")?.disabled).toBe(false));
  expect(app.messages()).toEqual([]);
  expect(input.files?.[0]).toBe(next);
  expect(screen.getByText("Next.txt")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  await waitFor(() => expect(app.uploads).toHaveLength(3));
  const references = app.writes.filter((write) => write.path.includes("/userfields/"));
  expect(references).toHaveLength(3);
  const nextReference = String(references[1]?.body.note);
  expect(atob(nextReference.split("_")[1]!)).toBe("next.txt");
  expect(nextReference.split("_")[0]).not.toBe(firstReference.split("_")[0]);
  expect(app.files[1]?.path).toBe(
    `/api/files/userfiles/${encodeURIComponent(nextReference.split("_")[0]!)}`,
  );
  expect(await fileText(app.files[1]?.body)).toBe("Replacement selection bytes");
  const retriedReference = String(references[2]?.body.note);
  expect(atob(retriedReference.split("_")[1]!)).toBe("next.txt");
  expect(retriedReference.split("_")[0]).not.toBe(nextReference.split("_")[0]);
  expect(app.files[2]?.path).toBe(
    `/api/files/userfiles/${encodeURIComponent(retriedReference.split("_")[0]!)}`,
  );
  expect(await fileText(app.files[2]?.body)).toBe("Replacement selection bytes");
  expect(input.files?.[0]).toBe(next);
  expect(screen.getByText("Next.txt")).toBeTruthy();
});

test("native barcode file Delete preserves a selected replacement and removes the initial stored file", async () => {
  const original = `${btoa("original.txt")}_${btoa("Original.txt")}`;
  const app = mount({ fieldFile: true, storedFile: original });
  const user = userEvent.setup();
  const input = await screen.findByLabelText<HTMLInputElement>("Owner file");
  const next = new File(["Replacement document"], "Next.txt", { type: "text/plain" });
  await user.upload(input, next);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(input.files?.[0]).toBe(next);
  expect(screen.getByText("No file selected")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.files).toHaveLength(2));
  expect(app.files[0]).toEqual({
    path: `/api/files/userfiles/${encodeURIComponent(btoa("original.txt"))}`,
    method: "DELETE",
    body: undefined,
  });
  expect(await fileText(app.files[1]?.body)).toBe("Replacement document");

  const reference = String(
    app.writes.find((write) => write.path.includes("/userfields/"))?.body.note,
  );

  expect(atob(reference.split("_")[1]!)).toBe("next.txt");
  expect(app.files[1]?.path).toBe(
    `/api/files/userfiles/${encodeURIComponent(reference.split("_")[0]!)}`,
  );
});

test("native barcode route selects its barcode and product with saved-cache unit choices", async () => {
  const app = mount();
  await screen.findByRole("heading", { name: "Edit Barcode" });
  expect(await screen.findByDisplayValue("OLD")).toBeTruthy();
  expect(screen.getByText("Coffee")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Amount").value).toBe("2");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("2");
  expect(screen.queryByRole("option", { name: "unrelated" })).toBeNull();
  expect(screen.getByRole("option", { name: "pack" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Old store" })).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>("Store").value).toBe("");
  expect(screen.getByText("This equals 8 pieces")).toBeTruthy();
  expect(await screen.findByDisplayValue("Custom note")).toBe(screen.getByLabelText("Owner note"));
  expect(
    app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/objects/product_barcodes/7"),
  ).toBe(false);
});

test.each(["", "&embedded"])(
  "create saves explicit native optional values and posts ordered parent messages (%s)",
  async (embedded) => {
    const app = mount({
      path: `/productbarcodes/new?product=7${embedded}&returnto=%2Ftasks`,
      prices: false,
    });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Barcode"), "NEW{Enter}");
    await waitFor(() => expect(app.messages()).toHaveLength(2));
    expect(screen.getByLabelText("Barcode").closest("fieldset")?.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(app.writes).toHaveLength(1);
    expect(app.writes).toEqual([
      {
        path: "/api/objects/product_barcodes",
        body: {
          product_id: "7",
          barcode: "NEW",
          amount: "",
          qu_id: null,
          shopping_location_id: "1",
          note: "",
        },
      },
    ]);
    expect(app.messages()).toEqual([
      [{ Message: "ProductBarcodesChanged", Payload: null }, window.location.origin],
      [{ Message: "CloseLastModal", Payload: null }, window.location.origin],
    ]);
    expect(app.router.state.location.pathname).toBe("/productbarcodes/new");
    expect(screen.queryByLabelText("Store")).toBeNull();
  },
);

test.each(["plain", "file-reference", "file-upload"])(
  "custom field %s failure keeps native error handling",
  async (kind) => {
    const app = mount({
      fieldFile: kind !== "plain",
      failField: kind !== "file-upload",
      failUpload: kind === "file-upload",
      holdField: true,
    });

    const user = userEvent.setup();
    await screen.findByDisplayValue("OLD");

    if (kind === "plain") await user.type(screen.getByLabelText("Owner note"), " changed");
    else
      await user.upload(
        screen.getByLabelText("Owner file"),
        new File(["document"], "origin.txt", { type: "text/plain" }),
      );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.messages()).toHaveLength(2));
    await act(async () => app.releaseField());

    if (kind === "file-upload") {
      await screen.findByRole("button", {
        name: /Error while saving, probably this item already exists/,
      });
      expect(app.uploads).toHaveLength(1);
    } else {
      expect(
        screen.queryByRole("button", {
          name: /Error while saving, probably this item already exists/,
        }),
      ).toBeNull();
      expect(app.uploads).toHaveLength(0);
    }
  },
);

test.each([1, 0])(
  "conversion hints substitute native quantity templates with purchase unit active=%s",
  async (purchaseActive) => {
    mount({ templateUnit: true, purchaseActive, savedAmount: 0.5 });
    await screen.findByDisplayValue("OLD");
    expect(screen.getByText("This equals 2 2 bottles")).toBeTruthy();
  },
);

test("create starts custom fields only after creation and closes without waiting for their response", async () => {
  const app = mount({
    path: "/productbarcodes/new?product=7&embedded",
    holdPrimary: true,
    holdField: true,
  });

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Barcode"), "NEW");
  await user.type(screen.getByLabelText("Owner note"), "Origin");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.messages()).toHaveLength(0);
  await act(async () => app.releasePrimary());
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  expect(app.writes[1]).toEqual({
    path: "/api/userfields/product_barcodes/31",
    body: { note: "Origin" },
  });
  await act(async () => app.releaseField());
});

test("edit starts independent custom fields before its selected barcode update", async () => {
  const app = mount({ holdPrimary: true, holdField: true });
  const user = userEvent.setup();
  const barcode = await screen.findByDisplayValue("OLD");
  await waitFor(() => expect(barcode.closest("fieldset")?.disabled).toBe(false));
  await user.clear(barcode);
  await user.type(barcode, "EDITED");
  await user.clear(screen.getByLabelText("Owner note"));
  await user.type(screen.getByLabelText("Owner note"), "Changed");
  await user.type(screen.getByLabelText("Batch"), "Roast 4");
  await user.selectOptions(screen.getByLabelText("Store"), "2");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(3));
  expect(app.writes).toEqual([
    { path: "/api/userfields/product_barcodes/21", body: { batch: "Roast 4" } },
    { path: "/api/userfields/product_barcodes/21", body: { note: "Changed" } },
    {
      path: "/api/objects/product_barcodes/21",
      body: {
        product_id: "7",
        barcode: "EDITED",
        amount: "2",
        qu_id: "2",
        shopping_location_id: "2",
        note: "Existing note",
      },
    },
  ]);
  await act(async () => app.releasePrimary());
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  await act(async () => app.releaseField());
});

test("invalid barcode and amount cannot submit", async () => {
  const app = mount({ path: "/productbarcodes/new?product=7" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  await user.type(screen.getByLabelText("Barcode"), "NEW");
  await user.type(screen.getByLabelText("Amount"), "0");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
});

test("an unavailable saved quantity unit remains unmatched and saves native null", async () => {
  const app = mount({ savedUnit: 99 });
  const user = userEvent.setup();
  await screen.findByDisplayValue("OLD");
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).closest("fieldset")?.disabled,
    ).toBe(false),
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  expect(app.writes[0]?.body.qu_id).toBeNull();
});

test("authenticated readers can edit and submit then receive native permission error", async () => {
  const app = mount({ canWrite: false });
  const user = userEvent.setup();
  const input = await screen.findByDisplayValue<HTMLInputElement>("OLD");
  expect(input.closest("fieldset")?.disabled).toBe(false);
  await user.clear(input);
  await user.type(input, "READER");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  await within(screen.getByRole("dialog", { name: "Error details" })).findByText(
    /Permission missing: MASTER_DATA_EDIT/,
  );
  expect(app.writes).toHaveLength(1);
  expect(app.messages()).toHaveLength(0);
});

test("held settings initialize the visible rounded amount before its unchanged save", async () => {
  const app = mount({ heldSettings: true, precision: 2, savedAmount: 1.234 });
  await waitFor(() =>
    expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/user/settings")).toBe(
      true,
    ),
  );
  expect(screen.queryByLabelText("Barcode")).toBeNull();
  expect(app.writes).toEqual([]);
  await act(async () => app.releaseSettings());
  await screen.findByDisplayValue("1.23");
  await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  expect(app.writes[0]?.body.amount).toBe("1.23");
});

test("primary create failure exposes technical details without creating custom fields or closing", async () => {
  const app = mount({ path: "/productbarcodes/new?product=7", failPrimary: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Barcode"), "DUPLICATE");
  await user.type(screen.getByLabelText("Owner note"), "Unsaved");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Error details" });
  expect(within(dialog).getByText(/Barcode already used/)).toBeTruthy();
  expect(app.writes).toHaveLength(1);
  expect(app.messages()).toHaveLength(0);
});

test("departure during creation prevents late dependent writes and modal messages", async () => {
  const app = mount({ path: "/productbarcodes/new?product=7&embedded", holdPrimary: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Barcode"), "LATE");
  await user.type(screen.getByLabelText("Owner note"), "Unsaved");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings" });
  await act(async () => app.releasePrimary());
  expect(app.writes).toHaveLength(1);
  expect(app.messages()).toHaveLength(0);
});

test("missing product context does not silently reinterpret a barcode ID as a product", async () => {
  const app = mount({ path: "/productbarcodes/21" });
  await screen.findByText("Object not found");
  expect(screen.queryByLabelText("Barcode")).toBeNull();
  expect(
    app.fetchMock.mock.calls.some(([url]) => String(url).includes("/api/objects/products/")),
  ).toBe(false);
});

test("selected Barcode saves displayed main text and unchanged Arrow-dirty metadata while untouched fields stay clean", async () => {
  const app = mount({ savedBarcode: "Imported\r\nCode", savedNote: "Imported\r\nNote" });
  const user = userEvent.setup();
  const barcode = await screen.findByLabelText<HTMLInputElement>("Barcode");
  await screen.findByDisplayValue("Custom note");
  expect(barcode.value).toBe("ImportedCode");
  expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("ImportedNote");
  screen.getByLabelText("Owner note").focus();
  await user.keyboard("{ArrowLeft}");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  expect(app.writes).toEqual([
    { path: "/api/userfields/product_barcodes/21", body: { note: "Custom note" } },
    {
      path: "/api/objects/product_barcodes/21",
      body: {
        product_id: "7",
        barcode: "ImportedCode",
        amount: "2",
        qu_id: "2",
        shopping_location_id: "",
        note: "ImportedNote",
      },
    },
  ]);
});

test("Barcode create reads current custom textarea DOM only after primary success without waiting for metadata", async () => {
  const app = mount({
    path: "/productbarcodes/new?product=7&embedded",
    holdPrimary: true,
    holdField: true,
    definitions: [
      { ...notesField("product_barcodes"), type: "text-multi-line" },
      { ...notesField("product_barcodes"), id: 2, name: "clean", caption: "Untouched" },
    ],
  });

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Barcode"), "CREATED");

  const notes = screen.getByLabelText<HTMLTextAreaElement>("Owner note");
  await user.type(notes, "Before primary");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(notes.matches(":disabled")).toBe(true);
  expect(app.messages()).toHaveLength(0);

  // Controlled assignment while disabled isolates the native callback's DOM
  // read; this is not natural user editing of a busy form.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;

  setValue.call(notes, "After primary\r\nCustom line");
  await act(async () => app.releasePrimary());
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  expect(app.writes[1]).toEqual({
    path: "/api/userfields/product_barcodes/31",
    body: { note: "After primary\nCustom line" },
  });
  expect(app.writes).toHaveLength(2);
  await act(async () => app.releaseField());
});

test("late Barcode custom Load hydrates actual values without replacing dirty markers or the selected File", async () => {
  const original = `${btoa("old.txt")}_${btoa("Old.txt")}`;

  const app = mount({
    fieldFile: true,
    heldValues: true,
    definitions: [
      { ...notesField("product_barcodes"), id: 2, name: "batch", caption: "Batch" },
      { ...notesField("product_barcodes"), type: "file", caption: "Owner file" },
      {
        ...notesField("product_barcodes"),
        id: 3,
        name: "acknowledged",
        caption: "Acknowledged",
        type: "checkbox",
        input_required: 1,
      },
    ],
    loadedValues: { batch: "Loaded batch", note: original, acknowledged: "0" },
  });

  const user = userEvent.setup();
  const barcode = await screen.findByLabelText<HTMLInputElement>("Barcode");
  expect(barcode.value).toBe("OLD");
  expect(barcode.matches(":disabled")).toBe(false);
  const batch = screen.getByLabelText<HTMLInputElement>("Batch");
  await user.type(batch, "Before Load");

  const acknowledged = screen.getByLabelText<HTMLInputElement>("Acknowledged");
  expect(acknowledged.required).toBe(true);
  expect(acknowledged.indeterminate).toBe(false);
  expect(acknowledged.checked).toBe(false);
  await user.click(acknowledged);
  const input = screen.getByLabelText<HTMLInputElement>("Owner file");

  const selected = new File(["Selection retained through Load"], "Selected.txt", {
    type: "text/plain",
  });

  await user.upload(input, selected);
  await act(async () => app.releaseValues());
  await waitFor(() => expect(batch.value).toBe("Loaded batch"));
  expect(acknowledged.required).toBe(false);
  expect(acknowledged.checked).toBe(true);
  expect(input.files?.[0]).toBe(selected);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(input.files?.[0]).toBe(selected);
  expect(screen.getByText("No file selected")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  await waitFor(() => expect(app.files).toHaveLength(2));
  const metadata = app.writes.filter((write) => write.path.includes("/userfields/"));
  expect(metadata[0]).toEqual({
    path: "/api/userfields/product_barcodes/21",
    body: { batch: "Loaded batch" },
  });
  expect(atob(String(metadata[1]?.body.note).split("_")[1]!)).toBe("selected.txt");
  expect(metadata[2]).toEqual({
    path: "/api/userfields/product_barcodes/21",
    body: { acknowledged: "1" },
  });
  expect(app.files[0]).toEqual({
    path: `/api/files/userfiles/${encodeURIComponent(btoa("old.txt"))}`,
    method: "DELETE",
    body: undefined,
  });
  expect(await fileText(app.files[1]?.body)).toBe("Selection retained through Load");
  expect(input.files?.[0]).toBe(selected);
});

test("failed Barcode custom Load only logs and leaves the native main form usable", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount({ heldValues: true, failValues: true });
  const user = userEvent.setup();
  const barcode = await screen.findByLabelText<HTMLInputElement>("Barcode");
  expect(barcode.value).toBe("OLD");
  await user.clear(barcode);
  await user.type(barcode, "AFTER LOAD ERROR");
  await act(async () => app.releaseValues());
  await waitFor(() => expect(errors).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByText("Initial field values unavailable")).toBeNull();
  expect(barcode.matches(":disabled")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  expect(app.writes).toHaveLength(1);
  expect(app.writes[0]?.body.barcode).toBe("AFTER LOAD ERROR");
});

test("Barcode primary failure enables its initially disabled no-conversion quantity unit for a fresh save", async () => {
  const app = mount({ noConversions: true, failPrimary: 1 });
  const user = userEvent.setup();
  await screen.findByDisplayValue("OLD");
  const unit = screen.getByLabelText<HTMLSelectElement>("Quantity unit");
  expect(unit.disabled).toBe(true);
  expect(unit.options).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  expect(unit.disabled).toBe(false);
  expect(unit.value).toBe("");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.messages()).toHaveLength(2));
  expect(app.writes).toHaveLength(2);
  expect(app.writes[0]?.body.qu_id).toBeNull();
  expect(app.writes[1]?.body.qu_id).toBeNull();
});
