import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import { supportDescriptionEditors } from "./fixtures/editor";
import { nativeProductContext } from "./fixtures/native-product";

function deferred() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

const selected = {
  id: 7,
  name: "Selected coffee",
  active: 1,
  location_id: 2,
  qu_id_stock: 1,
  qu_id_purchase: 1,
  qu_id_consume: 1,
  qu_id_price: 1,
  min_stock_amount: 1.23456,
  description: "",
  picture_file_name: null,
  userfields: null,
  default_stock_label_type: 0,
};

const settings = {
  stock_decimal_places_amounts: 2,
  product_presets_location_id: 2,
  product_presets_qu_id: 1,
  product_presets_default_due_days: 6,
};

const config = {
  FEATURE_FLAG_STOCK: true,
  FEATURE_FLAG_SHOPPINGLIST: false,
  FEATURE_FLAG_LABEL_PRINTER: true,
};

const references = {
  locations: [{ id: 2, name: "Shelf", active: 1 }],
  quantity_units: [
    { id: 1, name: "Piece", active: 1 },
    { id: 3, name: "Inactive case", active: 0 },
  ],
  shopping_locations: [],
  product_groups: [],
  products: [],
};

function mount(
  path: string,
  options: {
    raw?: string;
    recordId?: number;
    asymmetricUnits?: boolean;
    parents?: boolean;
    storedParent?: number | null;
    parentReplies?: Promise<Response>[];
    legacyReply?: Promise<Response>;
    copyReply?: Promise<Response>;
    copyFailure?: boolean;
    oldSettings?: Promise<Response>;
    basepath?: string;
  } = {},
) {
  const reads: string[] = [];
  const copySignals: (AbortSignal | null | undefined)[] = [];
  const parentRequests: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const parentReplies = options.parentReplies?.slice() ?? [];

  const parents = [
    { id: 9, name: "Parent alpha", active: 1 },
    { id: 10, name: "Parent beta", active: 1 },
    { id: 7, name: "Parent coffee", active: 1 },
  ];

  const writes: { path: string; body: JsonObject }[] = [];
  let settingsReads = 0;
  const canonicalId = options.recordId ?? 7;

  const products = new Map<number, JsonObject & { id: number; userfields: null }>([
    [canonicalId, { ...selected, id: canonicalId }],
  ]);

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (!init?.method || init.method === "GET") reads.push(url);

      if (url.startsWith("/api/v2/products/native-editor?")) {
        const raw = new URL(url, window.location.origin).searchParams.get("row");

        const product =
          raw === "new"
            ? null
            : raw === options.raw
              ? products.get(canonicalId)
              : [...products.values()].find((row) => String(row.id) === raw);

        if (raw !== "new" && !product)
          return Response.json({ error_message: "Object not found" }, { status: 404 });

        const eligibleParents = options.parents
          ? parents.filter((parent) => raw === "new" || parent.id !== product?.id)
          : [];

        return Response.json(
          nativeProductContext({
            product: product
              ? {
                  ...product,
                  qu_id_purchase: options.asymmetricUnits ? 99 : product.qu_id_purchase,
                  parent_product_id: options.storedParent ?? null,
                }
              : null,
            references: {
              ...references,
              quantity_units: options.asymmetricUnits
                ? [references.quantity_units[1]!, references.quantity_units[0]!]
                : references.quantity_units,
              products: eligibleParents,
            },
            user_settings: settings,
            config,
            options: {
              parent_disabled: false,
              references: {
                location_id: [2],
                default_consume_location_id: [2],
                shopping_location_id: [],
                product_group_id: [],
                parent_product_id: eligibleParents.map((parent) => parent.id),
                qu_id_stock: options.asymmetricUnits ? [3, 1] : [1, 3],
                qu_id_purchase: [1],
                qu_id_consume: [1],
                qu_id_price: [1],
              },
              conversions: [],
            },
          }),
        );
      }

      if (url.startsWith("/api/v2/products/context"))
        return Response.json({
          products: [],
          locations: [],
          quantity_units: [],
          shopping_locations: [],
          product_groups: [],
          userfields: [],
          userfield_values: [],
          user_settings: settings,
          config,
          locale: "en",
        });

      if (url === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (url === "/api/user/settings") {
        settingsReads++;

        return settingsReads === 1 && options.oldSettings
          ? options.oldSettings
          : Response.json(settings);
      }

      if (url === "/api/objects/products" && !init?.method)
        return options.legacyReply ?? Response.json([selected]);

      if (url === "/api/objects/locations") return Response.json(references.locations);

      if (url === "/api/objects/quantity_units") return Response.json(references.quantity_units);

      if (options.parents && /^\/api\/objects\/products\/(9|10)$/.test(url) && !init?.method) {
        parentRequests.push({ url, signal: init?.signal });

        return (
          parentReplies.shift() ??
          Response.json({
            id: Number(url.split("/").at(-1)),
            cumulate_min_stock_amount_of_sub_products: url.endsWith("/9") ? 1 : 0,
          })
        );
      }

      if (url.startsWith("/api/objects/products/") && !init?.method) {
        copySignals.push(init?.signal);

        return (
          options.copyReply ??
          (options.copyFailure
            ? Response.json({ error_message: "Copy unavailable" }, { status: 503 })
            : Response.json(selected))
        );
      }

      if (url.startsWith("/api/objects/products") && ["POST", "PUT"].includes(init?.method ?? "")) {
        const body: JsonObject = JSON.parse(String(init?.body));
        writes.push({ path: url, body });
        const id = init?.method === "POST" ? 42 : Number(url.split("/").at(-1));
        products.set(id, { ...products.get(id), ...body, id, userfields: null });

        return Response.json({ created_object_id: "42" });
      }

      if (url.startsWith("/api/v2/products/form-options"))
        return Response.json({
          parent_disabled: false,
          references: {
            location_id: [2],
            default_consume_location_id: [2],
            shopping_location_id: [],
            product_group_id: [],
            parent_product_id: [],
            qu_id_stock: [1, 3],
            qu_id_purchase: [1],
            qu_id_consume: [1],
            qu_id_price: [1],
          },
          conversions: [],
        });

      return undefined;
    },
    config,
    { basepath: options.basepath },
  );

  supportDescriptionEditors();

  return {
    ...app,
    reads,
    writes,
    copySignals,
    parentRequests,
    getSettingsReads: () => settingsReads,
  };
}

test.each([
  { segment: "07", raw: "07", id: 7 },
  { segment: "7e0", raw: "7e0", id: 7 },
  { segment: "%2537", raw: "7", id: 7 },
  { segment: "+7", raw: "+7", id: 7 },
  { segment: "7%2500tail%ZZ", raw: "7\0tail%ZZ", id: 7 },
  { segment: "0", raw: "0", id: 0 },
  { segment: "-7", raw: "-7", id: -7 },
])(
  "native product $segment preserves source-decoded identity and writes canonical row",
  async ({ segment, raw, id }) => {
    const { reads, writes } = mount(`/product/${segment}?embedded`, { raw, recordId: id });
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    expect(name.value).toBe("Selected coffee");
    expect(reads.filter((url) => url.startsWith("/api/v2/products/native-editor?"))).toEqual([
      `/api/v2/products/native-editor?row=${encodeURIComponent(raw)}`,
    ]);
    await userEvent.type(name, " changed");
    await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      path: `/api/objects/products/${id}`,
      body: { name: "Selected coffee changed" },
    });
  },
);

test("the native controller snapshot supplies choices while an unrelated generic catalog read is held", async () => {
  const legacy = deferred();
  const { writes, reads, router } = mount("/catalog", { raw: "7", legacyReply: legacy.promise });
  await waitFor(() => expect(reads).toContain("/api/objects/products"));
  await act(async () => {
    await router.navigate({ to: "/product/$productId", params: { productId: "7" } });
  });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("Selected coffee");
  expect(screen.getByLabelText<HTMLSelectElement>("Default location").value).toBe("2");
  expect(screen.getByRole("option", { name: "Inactive case" })).toBeTruthy();
  await userEvent.type(name, " draft");
  await act(async () => {
    legacy.release(Response.json([{ ...selected, name: "Old catalog row" }]));
  });
  expect(name.value).toBe("Selected coffee draft");
  expect(writes).toEqual([]);
});

test("held copy source fills only native copied controls without hiding or replacing the new draft", async () => {
  const copy = deferred();

  const { reads, writes } = mount(
    "/product/new?copy-of=07&flow=InplaceNewProductWithName&name=Typed%20name",
    { copyReply: copy.promise },
  );

  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("Typed name");
  expect(screen.getByLabelText<HTMLInputElement>("Days before expiry").value).toBe("0");
  await waitFor(() => expect(reads).toContain("/api/objects/products/07"));
  await userEvent.type(name, " draft");
  await userEvent.type(screen.getByLabelText("Minimum stock"), "8");
  await act(async () => {
    copy.release(
      Response.json({
        ...selected,
        name: "Never copied",
        min_stock_amount: 4.5,
        default_best_before_days: 21,
        qu_id_stock: 1,
        qu_id_purchase: 1,
      }),
    );
  });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Minimum stock").value).toBe("4.5"),
  );
  expect(name.value).toBe("Typed name draft");
  expect(screen.getByLabelText<HTMLInputElement>("Days before expiry").value).toBe("21");
  expect(screen.queryByRole("button", { name: "Save & return to products" })).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>("Consume unit").value).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("Price unit").value).toBe("");
  await userEvent.type(name, " extra");
  expect(screen.getByLabelText<HTMLSelectElement>("Consume unit").value).toBe("1");
  expect(screen.getByLabelText<HTMLSelectElement>("Price unit").value).toBe("1");
  expect(writes).toEqual([]);
});

test("failed raw copy lookup leaves its new form and edits usable without a retry gate", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { reads, writes } = mount("/product/new?copy-of=&name=Ignored", { copyFailure: true });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("");
  await waitFor(() => expect(reads).toContain("/api/objects/products/"));
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(screen.queryByText("Copy unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await userEvent.type(name, "New after copy failure");
  await userEvent.selectOptions(screen.getByLabelText("Default location"), "2");

  for (const label of ["Stock unit", "Purchase unit", "Consume unit", "Price unit"])
    await userEvent.selectOptions(screen.getByLabelText(label), "1");
  await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    path: "/api/objects/products",
    body: { name: "New after copy failure" },
  });
});

test("a selected controller snapshot wins over an older held generic settings response", async () => {
  const old = deferred();
  const { router, getSettingsReads } = mount("/catalog", { raw: "7", oldSettings: old.promise });
  await waitFor(() => expect(getSettingsReads()).toBe(1));
  await act(async () => {
    await router.navigate({ to: "/product/$productId", params: { productId: "7" } });
  });
  const minimum = await screen.findByLabelText<HTMLInputElement>("Minimum stock");
  expect(minimum.value).toBe("1.23");
  expect(minimum.step).toBe("0.01");
  await userEvent.clear(minimum);
  await userEvent.type(minimum, "5.25");
  await act(async () => {
    old.release(Response.json({ stock_decimal_places_amounts: 9 }));
  });
  expect(minimum.value).toBe("5.25");
  expect(minimum.step).toBe("0.01");
});

test.each(["%252537", "7%26bad", "0x7"])(
  "native nonmatching product %s stays controlled without a write",
  async (segment) => {
    const { writes } = mount(`/product/${segment}`, { raw: "7" });
    expect(await screen.findByText("Object not found")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(writes).toEqual([]);
  },
);

test("a configured script deployment retains the raw malformed product bookmark", async () => {
  const path = "/house.hold/index.php/product/7%2500tail%ZZ?embedded&marker=%26value";
  const { router, reads } = mount(path, { raw: "7\0tail%ZZ", basepath: "/house.hold/index.php" });
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("Selected coffee");
  expect(router.history.location.href).toBe(path);
  expect(reads.filter((url) => url.startsWith("/api/v2/products/native-editor?"))).toEqual([
    "/api/v2/products/native-editor?row=7%00tail%25ZZ",
  ]);
});

test("a copy response from the retired document cannot restore the departed form", async () => {
  const copy = deferred();

  const { router, reads, writes, copySignals } = mount("/product/new?copy-of=7", {
    copyReply: copy.promise,
    raw: "new",
  });

  await screen.findByLabelText("Name");
  await waitFor(() => expect(reads).toContain("/api/objects/products/7"));
  await act(async () => {
    await router.navigate({ to: "/catalog" });
  });
  await waitFor(() => expect(copySignals[0]?.aborted).toBe(true));
  await act(async () => {
    copy.release(Response.json({ ...selected, min_stock_amount: 99 }));
  });
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(writes).toEqual([]);
});

test("native stock-unit defaults use the selected option index and leave unmatched initial references alone", async () => {
  mount("/product/7", { raw: "7", asymmetricUnits: true });
  const purchase = await screen.findByLabelText<HTMLSelectElement>("Purchase unit");
  expect(purchase.value).toBe("");
  const stock = screen.getByLabelText<HTMLSelectElement>("Stock unit");
  await userEvent.selectOptions(stock, "3");
  expect(stock.value).toBe("3");
  expect(purchase.value).toBe("1");
});

test.each([
  {
    suffix: "returnto=%2Fproducts%3Fmarker%3Dfirst&returnto=%2Frecipes",
    destination: "/products?marker=first",
  },
  { suffix: "returnto=", destination: "/products" },
  { suffix: "returnto", destination: "/products" },
])(
  "native Cancel respects first raw return target under a configured script prefix: $suffix",
  async ({ suffix, destination }) => {
    const prefix = "/house.hold/index.php";

    const { router, writes } = mount(`${prefix}/product/7?${suffix}`, {
      raw: "7",
      basepath: prefix,
    });

    await screen.findByLabelText("Name");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.history.location.href).toBe(prefix + destination));
    expect(writes).toEqual([]);
  },
);

test("copied nullable and unmatched selectors preserve native payload omission and the committed new record", async () => {
  const copy = deferred();
  const { writes, reads, router } = mount("/product/new?copy-of=7", { copyReply: copy.promise });
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await act(async () => {
    copy.release(
      Response.json({
        ...selected,
        min_stock_amount: 0,
        default_best_before_days: 0,
        default_best_before_days_after_open: 0,
        default_best_before_days_after_freezing: 0,
        default_best_before_days_after_thawing: 0,
        quick_consume_amount: 1,
        quick_open_amount: 1,
        default_consume_location_id: null,
        default_stock_label_type: 99,
      }),
    );
  });
  const location = screen.getByLabelText<HTMLSelectElement>("Default consume location");
  const label = screen.getByLabelText<HTMLSelectElement>("Default stock label");
  await waitFor(() => expect(label.selectedIndex).toBe(-1));
  expect(location.value).toBe("");
  expect(location.selectedIndex).toBe(0);
  await userEvent.type(name, "Copied new product");
  await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body.default_consume_location_id).toBe("");
  expect(writes[0]?.body).not.toHaveProperty("default_stock_label_type");
  await waitFor(() => expect(router.history.location.pathname).toBe("/product/42"));
  await waitFor(() => expect(reads).toContain("/api/v2/products/native-editor?row=42"));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Copied new product"),
  );
});

test.each([
  { row: "new", query: "product=9", parent: "9", stored: null },
  { row: "new", query: "product=10&product=9", parent: "10", stored: null },
  { row: "new", query: "product-name=Parent", parent: "9", stored: null },
  { row: "new", query: "product-name=Parent&product=10", parent: "10", stored: null },
  { row: "new", query: "product=07", parent: "", stored: null },
  { row: "7", query: "product=10", parent: "9", stored: 9 },
  { row: "7", query: "product=10", parent: "10", stored: 0 },
])(
  "native initial parent follows query and stored-ID priority: $row $query stored=$stored",
  async ({ row, query, parent, stored }) => {
    const { parentRequests } = mount(`/product/${row}?${query}`, {
      raw: row,
      parents: true,
      storedParent: stored,
    });

    const picker = await screen.findByLabelText<HTMLSelectElement>("Parent product");
    expect(picker.value).toBe(parent);

    if (parent) {
      await waitFor(() =>
        expect(parentRequests.map((request) => request.url)).toEqual([
          `/api/objects/products/${parent}`,
        ]),
      );
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLInputElement>("Minimum stock").disabled).toBe(
          parent === "9",
        ),
      );
    } else expect(parentRequests).toEqual([]);
  },
);

test("late copy parent selection does not start another rule read, while prior user reads retain their document scope", async () => {
  const copy = deferred();
  const firstParent = deferred();
  const departedParent = deferred();

  const { parentRequests, writes, router, reads } = mount("/product/new?copy-of=7", {
    parents: true,
    copyReply: copy.promise,
    parentReplies: [firstParent.promise, departedParent.promise],
  });

  const picker = await screen.findByLabelText<HTMLSelectElement>("Parent product");
  await waitFor(() => expect(reads).toContain("/api/objects/products/7"));
  await userEvent.selectOptions(picker, "9");
  await waitFor(() => expect(parentRequests).toHaveLength(1));
  await act(async () => {
    copy.release(Response.json({ ...selected, parent_product_id: 10 }));
  });
  await waitFor(() => expect(picker.value).toBe("10"));
  expect(parentRequests.map((request) => request.url)).toEqual(["/api/objects/products/9"]);
  await act(async () => {
    firstParent.release(Response.json({ id: 9, cumulate_min_stock_amount_of_sub_products: 1 }));
  });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Minimum stock").disabled).toBe(true),
  );
  expect(picker.value).toBe("10");
  await userEvent.selectOptions(picker, "9");
  await waitFor(() => expect(parentRequests).toHaveLength(2));
  await act(async () => {
    await router.navigate({ to: "/catalog" });
  });
  await waitFor(() => expect(parentRequests[1]?.signal?.aborted).toBe(true));
  await act(async () => {
    departedParent.release(Response.json({ id: 9, cumulate_min_stock_amount_of_sub_products: 0 }));
  });
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(writes).toEqual([]);
});
