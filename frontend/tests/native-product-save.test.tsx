import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import type { UserfieldDefinition } from "@/lib/userfields";
import { mountNativeEditor } from "./fixtures/native-editor";
import { supportDescriptionEditors } from "./fixtures/editor";
import { pictureBytes } from "./fixtures/picture";
import { nativeProductContext } from "./fixtures/native-product";

function deferred() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mount(
  path: string,
  options: {
    holdFirst?: boolean;
    holdLast?: boolean;
    holdPrimary?: boolean;
    holdPicture?: boolean;
    pictureFailure?: boolean;
    removeFailure?: boolean;
    file?: boolean;
    storedPicture?: boolean;
    related?: boolean;
    basepath?: string;
    initialProduct?: JsonObject;
    initialFields?: Record<string, string | null>;
    customFields?: (UserfieldDefinition & { entity: string })[];
    lockedParent?: boolean;
    primaryFailures?: number;
  } = {},
) {
  const first = deferred();
  const last = deferred();
  const primary = deferred();
  const picture = deferred();
  let primaryCount = 0;
  let pictureCount = 0;
  let relationDeleted = false;
  const writes: { path: string; body: JsonObject }[] = [];
  const fileWrites: { path: string; body: BodyInit | null | undefined }[] = [];
  const storedFields = new Map<number, Record<string, string | null>>();

  const products: JsonObject[] = [
    {
      id: 7,
      name: "Saved coffee",
      description: "",
      active: 1,
      location_id: 1,
      qu_id_stock: 1,
      qu_id_purchase: 1,
      qu_id_consume: 1,
      qu_id_price: 1,
      min_stock_amount: 0,
      userfields: {},
      picture_file_name: options.storedPicture ? "old-picture.png" : null,
      ...options.initialProduct,
    },
  ];

  if (options.initialFields) storedFields.set(7, { ...options.initialFields });

  if (options.lockedParent)
    products.push({ id: 9, name: "Parent", cumulate_min_stock_amount_of_sub_products: 1 });

  const fields =
    options.customFields ??
    ["First", "Last"].map((name, index) => ({
      id: index + 1,
      entity: "products",
      name: name.toLowerCase(),
      caption: name,
      type: "text-single-line",
      input_required: 0,
      default_value: null,
      config: null,
      sort_number: index,
    }));

  if (options.file)
    Object.assign(fields[1]!, { name: "certificate", caption: "Certificate", type: "file" });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:fixture-picture";
      static revokeObjectURL = () => {};
    },
  );
  const close = vi.spyOn(window, "close").mockImplementation(() => {});

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/objects/userfields?query[]=entity=products") return Response.json(fields);

      if (url.startsWith("/api/userfields/products/") && !init?.method)
        return Response.json(storedFields.get(Number(url.split("/").at(-1))) ?? {});

      if (url.startsWith("/api/v2/products/native-editor?")) {
        const raw = new URL(url, window.location.origin).searchParams.get("row");
        const product = raw === "new" ? null : products.find((row) => row.id === Number(raw));

        if (raw !== "new" && !product)
          return Response.json({ error_message: "Object not found" }, { status: 404 });

        return Response.json(
          nativeProductContext({
            product: product
              ? {
                  ...product,
                  id: Number(product.id),
                  userfields: storedFields.get(Number(product.id)) ?? null,
                }
              : null,
            references: {
              locations: [{ id: 1, name: "Shelf" }],
              quantity_units: [
                { id: 1, name: "Piece" },
                { id: 2, name: "Box" },
              ],
              shopping_locations: [],
              product_groups: [],
              products: products.map((row) => ({ ...row, id: Number(row.id) })),
            },
            fields,
            config: { FEATURE_FLAG_STOCK: false, FEATURE_FLAG_SHOPPINGLIST: false },
            options: {
              parent_disabled: !!options.lockedParent,
              references: {
                location_id: [1],
                default_consume_location_id: [1],
                shopping_location_id: [],
                product_group_id: [],
                parent_product_id: options.lockedParent ? [9] : [],
                qu_id_stock: [1],
                qu_id_purchase: [1],
                qu_id_consume: [1],
                qu_id_price: [1],
              },
              conversions: [],
            },
          }),
        );
      }

      if (url === "/api/v2/custom-data/fields") return Response.json(fields);

      if (url === "/api/objects/quantity_units")
        return Response.json([
          { id: 1, name: "Piece" },
          { id: 2, name: "Box" },
        ]);

      if (url === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

      if (url.startsWith("/api/v2/products/form-options"))
        return Response.json({
          parent_disabled: !!options.lockedParent,
          references: {
            location_id: [1],
            default_consume_location_id: [1],
            shopping_location_id: [],
            product_group_id: [],
            parent_product_id: options.lockedParent ? [9] : [],
            qu_id_stock: [1],
            qu_id_purchase: [1],
            qu_id_consume: [1],
            qu_id_price: [1],
          },
          conversions: [],
        });

      if (url === "/api/objects/products" && !init?.method) return Response.json(products);

      if (url === "/api/objects/products/9" && !init?.method)
        return Response.json(products.find((row) => row.id === 9));

      if (
        options.related &&
        url.startsWith("/api/objects/quantity_unit_conversions") &&
        !url.includes("_resolved")
      ) {
        if (init?.method === "DELETE") {
          relationDeleted = true;
          writes.push({ path: url, body: {} });

          return Response.json({});
        }

        return Response.json(
          relationDeleted ? [] : [{ id: 21, product_id: 7, from_qu_id: 1, to_qu_id: 2, factor: 6 }],
        );
      }

      if (
        (url === "/api/objects/products" || url === "/api/objects/products/7") &&
        ["POST", "PUT"].includes(init?.method ?? "")
      ) {
        const body = JSON.parse(String(init?.body));
        writes.push({ path: url, body });
        const id = 42 + primaryCount++;

        const response =
          options.holdPrimary && primaryCount === 1
            ? await primary.promise
            : primaryCount <= (options.primaryFailures ?? 0)
              ? Response.json({ error_message: "Primary refused" }, { status: 503 })
              : Response.json({ created_object_id: String(id) });

        if (response.ok) {
          if (init?.method === "POST") products.push({ ...body, id });
          else Object.assign(products[0]!, body);
        }

        return response;
      }

      if (url.startsWith("/api/userfields/products/") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push({ path: url, body });

        const response =
          "first" in body && options.holdFirst
            ? await first.promise
            : ("last" in body || "certificate" in body) && options.holdLast
              ? await last.promise
              : Response.json({});

        const record = products.find((row) => row.id === Number(url.split("/").at(-1)));

        if (response.ok && record) {
          const saved = storedFields.get(Number(record.id)) ?? {};
          Object.assign(saved, body);
          storedFields.set(Number(record.id), saved);
          record.userfields = saved;
        }

        return response;
      }

      if (url.startsWith("/api/files/") && init?.method === "PUT") {
        fileWrites.push({ path: url, body: init.body });

        if (url.includes("/productpictures/")) {
          pictureCount++;

          if (options.holdPicture) return picture.promise;

          if (options.pictureFailure && pictureCount === 1)
            return Response.json({ error_message: "Picture upload failed" }, { status: 503 });
        }

        return Response.json({});
      }

      if (url.startsWith("/api/files/") && init?.method === "DELETE") {
        writes.push({ path: url, body: {} });

        return options.removeFailure
          ? Response.json({ error_message: "Picture delete failed" }, { status: 503 })
          : Response.json({});
      }

      if (url.startsWith("/api/files/"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });
    },
    {},
    { basepath: options.basepath },
  );

  supportDescriptionEditors();

  return { ...app, writes, fileWrites, close, first, last, primary, picture };
}

async function editFields() {
  const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(button.disabled).toBe(false));
  await userEvent.type(screen.getByLabelText("First"), "Earlier draft");
  await userEvent.type(screen.getByLabelText("Last"), "Final draft");

  return button;
}

test("native product dispatches both dirty fields after PUT and closes on the last callback without waiting for the first", async () => {
  const app = mount("/product/7?closeAfterCreation&returnto=%2Fproducts", {
    holdFirst: true,
    holdLast: true,
  });

  await userEvent.click(await editFields());
  await waitFor(() =>
    expect(app.writes.map((row) => row.body)).toContainEqual({ last: "Final draft" }),
  );
  expect(app.writes[0]?.path).toBe("/api/objects/products/7");
  expect(app.close).not.toHaveBeenCalled();
  await act(async () => {
    app.last.release(Response.json({}));
  });
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  expect(app.router.state.location.pathname).toBe("/product/7");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save & continue" }).matches(":disabled"),
  ).toBe(true);
  await act(async () => {
    app.first.release(
      Response.json({ error_message: "Earlier metadata failure" }, { status: 503 }),
    );
  });
  expect(screen.queryByText("Earlier metadata failure")).toBeNull();
  expect(app.close).toHaveBeenCalledOnce();
});

test("native Product Arrow-dirty fields use live custom textarea LF at primary success and omit untouched controls", async () => {
  const app = mount("/product/7?closeAfterCreation", {
    holdPrimary: true,
    initialFields: { retained: "Stored", notes: "Initial notes", clean: "Untouched" },
    customFields: [
      {
        id: 1,
        entity: "products",
        name: "retained",
        caption: "Retained",
        type: "text-single-line",
        input_required: 0,
        default_value: null,
        config: null,
      },
      {
        id: 2,
        entity: "products",
        name: "notes",
        caption: "Custom notes",
        type: "text-multi-line",
        input_required: 0,
        default_value: null,
        config: null,
      },
      {
        id: 3,
        entity: "products",
        name: "clean",
        caption: "Clean field",
        type: "text-single-line",
        input_required: 0,
        default_value: null,
        config: null,
      },
    ],
  });

  const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(button.disabled).toBe(false));
  const user = userEvent.setup();
  const retained = screen.getByLabelText<HTMLInputElement>("Retained");
  await user.click(retained);
  await user.keyboard("{ArrowLeft}");
  expect(retained.value).toBe("Stored");
  const notes = screen.getByLabelText<HTMLTextAreaElement>("Custom notes");
  await user.clear(notes);
  await user.type(notes, "Before primary");
  await user.click(button);
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(notes.matches(":disabled")).toBe(true);
  // Controlled disabled-DOM assignment isolates the native post-primary .val() binding.
  // Natural editing of a busy form is not claimed by this timing check.
  notes.value = "Live\r\nCustom line";
  await act(async () => app.primary.release(new Response(null, { status: 204 })));
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/products/7", body: { retained: "Stored" } },
    { path: "/api/userfields/products/7", body: { notes: "Live\nCustom line" } },
  ]);
  expect(screen.getByLabelText<HTMLInputElement>("Clean field").value).toBe("Untouched");
});

test("native Product main fields submit imported Name DOM text and HTML textarea CRLF without normalizing custom metadata", async () => {
  const app = mount("/product/7?closeAfterCreation", {
    initialProduct: { name: "Imported\r\nProduct", description: "<p>First</p>\n<p>Second</p>" },
    customFields: [
      {
        id: 1,
        entity: "products",
        name: "notes",
        caption: "Custom notes",
        type: "text-multi-line",
        input_required: 0,
        default_value: null,
        config: null,
      },
    ],
  });

  const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("ImportedProduct");
  await userEvent.type(screen.getByLabelText("Custom notes"), "Custom{Enter}line");
  await userEvent.click(button);
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  // The shared ready-only rich-editor fixture supplies transport readiness, not widget editing.
  expect(app.writes[0]!.body).toMatchObject({
    name: "ImportedProduct",
    description: "<p>First</p>\r\n<p>Second</p>",
  });
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/products/7", body: { notes: "Custom\nline" } },
  ]);
});

test("a natural Product picture-delete failure permits current custom file metadata and later live bytes under that captured filename", async () => {
  const app = mount("/product/7?closeAfterCreation", {
    file: true,
    storedPicture: true,
    removeFailure: true,
    holdPrimary: true,
    holdLast: true,
  });

  const user = userEvent.setup();
  const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(button.disabled).toBe(false));
  const input = screen.getByLabelText<HTMLInputElement>("Certificate");
  const first = new File(["First bytes"], "First.PDF", { type: "application/pdf" });
  const second = new File(["Second bytes"], "Second.PDF", { type: "application/pdf" });
  const third = new File(["Third bytes"], "Third.PDF", { type: "application/pdf" });
  await user.upload(input, first);
  await user.click(screen.getByRole("button", { name: "Remove picture" }));
  await user.click(button);
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(input.matches(":disabled")).toBe(false));
  await user.upload(input, second);
  await act(async () => app.primary.release(new Response(null, { status: 204 })));
  await waitFor(() => expect(app.writes.some((write) => "certificate" in write.body)).toBe(true));

  const value = String(app.writes.find((write) => "certificate" in write.body)!.body.certificate);
  expect(atob(value.split("_")[1]!)).toBe("second.pdf");
  expect(input.matches(":disabled")).toBe(false);
  await user.upload(input, third);
  await act(async () => app.last.release(new Response(null, { status: 204 })));
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  expect(app.fileWrites).toEqual([
    { path: `/api/files/userfiles/${encodeURIComponent(value.split("_")[0]!)}`, body: third },
  ]);
  const uploaded = app.fileWrites[0]!.body;

  if (!(uploaded instanceof File)) throw new Error("Expected the selected custom file body");

  const text = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(uploaded);
  });

  expect(text).toBe("Third bytes");
  expect(app.writes.filter((write) => write.path === "/api/objects/products/7")).toHaveLength(1);
});

test("native Product EndBusy restores disabled Parent, Minimum stock and required Container weight until their real events disable them again", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mount("/product/7?closeAfterCreation", {
    holdPrimary: true,
    primaryFailures: 2,
    lockedParent: true,
    initialProduct: {
      parent_product_id: 9,
      min_stock_amount: 4,
      tare_weight: 3,
      enable_tare_weight_handling: 0,
    },
  });

  const user = userEvent.setup();
  const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(button.disabled).toBe(false));
  const parent = screen.getByLabelText<HTMLSelectElement>("Parent product");
  const minimum = screen.getByLabelText<HTMLInputElement>("Minimum stock");
  const tare = screen.getByLabelText<HTMLInputElement>("Container weight");
  const enabled = screen.getByLabelText<HTMLInputElement>("Use container weight");
  await waitFor(() => expect(minimum.disabled).toBe(true));
  expect(parent.disabled).toBe(true);
  expect(tare.disabled).toBe(true);
  expect(enabled.checked).toBe(false);
  await user.click(button);
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]!.body).not.toHaveProperty("tare_weight");
  expect(app.writes[0]!.body).not.toHaveProperty("min_stock_amount");
  expect(app.writes[0]!.body).not.toHaveProperty("parent_product_id");
  await act(async () =>
    app.primary.release(Response.json({ error_message: "Primary refused" }, { status: 503 })),
  );
  await waitFor(() => expect(tare.matches(":disabled")).toBe(false));
  expect(minimum.matches(":disabled")).toBe(false);
  expect(parent.matches(":disabled")).toBe(false);
  expect(tare.required).toBe(true);
  expect(enabled.checked).toBe(false);
  await user.clear(tare);
  await user.click(button);
  expect(app.writes).toHaveLength(1);
  expect(tare.validity.valueMissing).toBe(true);
  await user.type(tare, "5");
  await user.click(button);
  await waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
  expect(app.writes[1]!.body).toMatchObject({
    tare_weight: 5,
    min_stock_amount: 4,
    parent_product_id: 9,
    enable_tare_weight_handling: 0,
  });
  await user.click(enabled);
  await user.click(enabled);
  expect(enabled.checked).toBe(false);
  expect(tare.disabled).toBe(true);
  await user.selectOptions(parent, "");
  expect(minimum.disabled).toBe(false);
  await user.selectOptions(parent, "9");
  await waitFor(() => expect(minimum.disabled).toBe(true));
  expect(parent.disabled).toBe(false);
  await user.click(button);
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  expect(app.writes).toHaveLength(3);
  expect(app.writes[2]!.body).toHaveProperty("parent_product_id", 9);
  expect(app.writes[2]!.body).not.toHaveProperty("tare_weight");
  expect(app.writes[2]!.body).not.toHaveProperty("min_stock_amount");
});

test.each([
  "closeAfterCreation",
  "closeAfterCreation=",
  "closeAfterCreation=&closeAfterCreation=ignored",
])("native create honors raw %s presence before returnto", async (flag) => {
  const app = mount(`/product/new?${flag}&returnto=%2Fproducts`);
  const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(button.disabled).toBe(false));
  await userEvent.type(screen.getByLabelText("Name"), "New coffee");
  await userEvent.selectOptions(screen.getByLabelText("Default location"), "1");
  await userEvent.selectOptions(screen.getByLabelText("Stock unit"), "1");
  await userEvent.click(button);
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  expect(app.writes.filter((row) => row.path === "/api/objects/products")).toHaveLength(1);
  expect(app.router.state.location.pathname).toBe("/product/new");
});

test("the last custom file gates the product picture, whose bytes stay live outside the busy form", async () => {
  const app = mount("/product/7?closeAfterCreation", { file: true, holdLast: true });
  const button = await screen.findByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(button.disabled).toBe(false));
  await userEvent.type(screen.getByLabelText("First"), "Lot");
  const certificate = new File(["Certificate bytes"], "Lot.pdf", { type: "application/pdf" });
  await userEvent.upload(screen.getByLabelText("Certificate"), certificate);
  const initial = new File([pictureBytes], "Crème A.png", { type: "image/png" });
  const replacement = new File([pictureBytes], "Replacement B.png", { type: "image/png" });
  await userEvent.upload(screen.getByLabelText("Product picture"), initial);
  await userEvent.click(button);
  await waitFor(() => expect(app.writes.some((row) => "certificate" in row.body)).toBe(true));
  expect(app.fileWrites).toHaveLength(0);
  expect(screen.getByLabelText<HTMLInputElement>("Name").matches(":disabled")).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>("Product picture").matches(":disabled")).toBe(
    false,
  );
  const submittedName = String(app.writes[0]?.body.picture_file_name);
  expect(submittedName).toMatch(/crmea\.png$/);
  await userEvent.upload(screen.getByLabelText("Product picture"), replacement);
  await act(async () => {
    app.last.release(Response.json({}));
  });
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  expect(app.fileWrites.map((row) => row.body)).toEqual([certificate, replacement]);
  expect(decodeURIComponent(app.fileWrites[1]!.path)).toContain(btoa(submittedName));
});

test("last metadata failure silently keeps the committed native form busy", async () => {
  const app = mount("/product/7?closeAfterCreation", { holdLast: true });
  await userEvent.click(await editFields());
  await waitFor(() => expect(app.writes).toHaveLength(3));
  await act(async () => {
    app.last.release(Response.json({ error_message: "Metadata refused" }, { status: 503 }));
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save & continue" }).matches(":disabled"),
  ).toBe(true);
  expect(screen.queryByText("Metadata refused")).toBeNull();
  expect(app.close).not.toHaveBeenCalled();
});

test("independent picture deletion failure unlocks live custom edits and the flow completion name while PUT waits", async () => {
  const app = mount("/product/7?flow=&returnto=%2Fproduct%2F7%3Freturned", {
    storedPicture: true,
    removeFailure: true,
    holdPrimary: true,
  });

  const button = await editFields();
  await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));
  await userEvent.click(button);
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(button.matches(":disabled")).toBe(false));
  expect(app.writes[0]?.path).toContain("/api/files/productpictures/");
  expect(app.writes[1]?.body.picture_file_name).toBeNull();
  await userEvent.type(screen.getByLabelText("Last"), " changed while PUT waits");
  await userEvent.clear(screen.getByLabelText("Name"));
  await userEvent.type(screen.getByLabelText("Name"), "Live coffee");
  await act(async () => {
    app.primary.release(Response.json({}));
  });
  await waitFor(() =>
    expect(app.router.history.location.href).toBe("/product/7?returned&product-name=Live%20coffee"),
  );
  expect(app.writes[1]?.body.name).toBe("Saved coffee");
  expect(app.writes.map((row) => row.body)).toContainEqual({
    last: "Final draft changed while PUT waits",
  });
  expect(app.fileWrites).toHaveLength(0);
});

test.each(["new", "7"])(
  "native primary failure for %s unlocks its draft and retries the primary write",
  async (id) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount(`/product/${id}?closeAfterCreation`, { holdPrimary: true });
    const button = await editFields();

    if (id === "new") {
      await userEvent.type(screen.getByLabelText("Name"), "Draft coffee");
      await userEvent.selectOptions(screen.getByLabelText("Default location"), "1");
      await userEvent.selectOptions(screen.getByLabelText("Stock unit"), "1");
    }

    await userEvent.click(button);
    await waitFor(() => expect(app.writes).toHaveLength(1));
    await act(async () => {
      app.primary.release(Response.json({ error_message: "Primary refused" }, { status: 503 }));
    });
    await waitFor(() => expect(button.matches(":disabled")).toBe(false));
    expect(screen.getByLabelText<HTMLInputElement>("First").value).toBe("Earlier draft");

    if (id === "new")
      await screen.findByRole("button", {
        name: /Error while saving, probably this item already exists/,
      });
    else {
      expect(error).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: /Error while saving/ })).toBeNull();
    }

    await userEvent.click(button);
    await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
    expect(
      app.writes.filter(
        (row) => row.path === (id === "new" ? "/api/objects/products" : "/api/objects/products/7"),
      ),
    ).toHaveLength(2);
  },
);

test("native create retries POST after picture failure but retains the first created ID for fields", async () => {
  const app = mount("/product/new?closeAfterCreation", { pictureFailure: true });
  const button = await editFields();
  await userEvent.type(screen.getByLabelText("Name"), "First coffee");
  await userEvent.selectOptions(screen.getByLabelText("Default location"), "1");
  await userEvent.selectOptions(screen.getByLabelText("Stock unit"), "1");
  await userEvent.upload(
    screen.getByLabelText("Product picture"),
    new File([pictureBytes], "Picture.png", { type: "image/png" }),
  );
  await userEvent.click(button);
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(button.matches(":disabled")).toBe(false));
  await userEvent.clear(screen.getByLabelText("Name"));
  await userEvent.type(screen.getByLabelText("Name"), "Second coffee");
  await userEvent.click(button);
  await waitFor(() => expect(app.close).toHaveBeenCalledOnce());
  expect(
    app.writes.filter((row) => row.path === "/api/objects/products").map((row) => row.body.name),
  ).toEqual(["First coffee", "Second coffee"]);
  expect(
    app.writes.filter((row) => row.path.includes("/userfields/")).map((row) => row.path),
  ).toEqual(Array(4).fill("/api/userfields/products/42"));
  expect(app.fileWrites).toHaveLength(2);
});

test.each(["primary", "field", "picture"])(
  "departing during native %s settlement invalidates caches without a late completion",
  async (stage) => {
    const app = mount("/product/7?closeAfterCreation", {
      holdPrimary: stage === "primary",
      holdLast: stage === "field",
      holdPicture: stage === "picture",
    });

    const button = await editFields();
    await userEvent.upload(
      screen.getByLabelText("Product picture"),
      new File([pictureBytes], "Picture.png", { type: "image/png" }),
    );
    await userEvent.click(button);
    await waitFor(() =>
      expect(
        stage === "primary"
          ? app.writes.length
          : stage === "field"
            ? app.writes.length
            : app.fileWrites.length,
      ).toBe(stage === "primary" ? 1 : stage === "field" ? 3 : 1),
    );
    await act(async () => {
      await app.router.navigate({ href: "/barcodescannertesting" });
    });
    const keys = [["stock", "held-product"], ["recipe-overview"], ["shopping", "held-product"]];

    for (const key of keys) app.client.setQueryData(key, []);
    await act(async () => {
      (stage === "primary" ? app.primary : stage === "field" ? app.last : app.picture).release(
        Response.json({ created_object_id: "42" }),
      );
    });
    await waitFor(() => {
      for (const key of keys) expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
    });
    expect(app.router.state.location.pathname).toBe("/barcodescannertesting");
    expect(app.close).not.toHaveBeenCalled();
    expect(app.fileWrites).toHaveLength(stage === "picture" ? 1 : 0);
    expect(app.writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(
      stage === "primary" ? 0 : 2,
    );
  },
);

test("raw first returnto and flow append the source suffix without inventing a query separator", async () => {
  const app = mount("/product/7?returnto=%2Fbarcodescannertesting&returnto=%2Fproducts&flow=");
  await userEvent.click(await editFields());
  await waitFor(() =>
    expect(app.router.state.location.pathname).toBe(
      "/barcodescannertesting&product-name=Saved coffee",
    ),
  );
  expect(app.router.state.location.searchStr).toBe("");
  expect(app.close).not.toHaveBeenCalled();
});

test("canonical script-prefix completion preserves raw return-query spelling while appending the native flow suffix", async () => {
  const target = "/barcodescannertesting?barcode=NEW&flag&dupe=first&dupe=second";

  const app = mount(
    `/house.hold/index.php/product/7?returnto=${encodeURIComponent(target)}&flow=InplaceNewProductWithName&name=Saved%20coffee`,
    { basepath: "/house.hold/index.php" },
  );

  await userEvent.click(await editFields());
  await waitFor(() =>
    expect(app.router.history.location.pathname).toBe(
      "/house.hold/index.php/barcodescannertesting",
    ),
  );
  expect(app.router.history.location.search).toBe(
    "?barcode=NEW&flag&dupe=first&dupe=second&product-name=Saved%20coffee",
  );
  expect(app.close).not.toHaveBeenCalled();
});

test("native relation deletion saves parallel fields then reloads the same raw URI before close or returnto", async () => {
  const path =
    "/product/7?closeAfterCreation&returnto=%2Fbarcodescannertesting&keep&duplicate=one&duplicate=two";

  const app = mount(path, { related: true, holdFirst: true, holdLast: true });
  await editFields();

  const remove = await screen.findByRole<HTMLButtonElement>("button", {
    name: /Delete.*Piece.*Box/,
  });

  await waitFor(() => expect(remove.disabled).toBe(false));
  await userEvent.click(remove);
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(app.writes.some((row) => "last" in row.body)).toBe(true));
  expect(app.writes.map((row) => row.path)).toEqual([
    "/api/objects/quantity_unit_conversions/21",
    "/api/objects/products/7",
    "/api/userfields/products/7",
    "/api/userfields/products/7",
  ]);
  await act(async () => {
    app.last.release(Response.json({}));
  });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Last").value).toBe("Final draft"),
  );
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("First").matches(":disabled")).toBe(false),
  );
  expect(app.router.history.location.href).toBe(path);
  expect(app.close).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Delete.*Piece.*Box/ })).toBeNull();
  await userEvent.type(screen.getByLabelText("First"), "Replacement draft");
  await act(async () => {
    app.first.release(Response.json({}));
  });
  expect(screen.getByLabelText<HTMLInputElement>("First").value).toBe("Replacement draft");
  expect(app.close).not.toHaveBeenCalled();
});
