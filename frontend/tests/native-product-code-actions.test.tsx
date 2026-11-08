import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { writeApiConfig } from "@/lib/config";
import { mountNativeEditor } from "./fixtures/native-editor";
import { nativeProductContext } from "./fixtures/native-product";
import { supportDescriptionEditors } from "./fixtures/editor";
import { pictureBytes } from "./fixtures/picture";

function deferred() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mount({
  stock = true,
  printer = true,
  id = 7,
  raw = "07",
  basepath = "",
  related,
}: {
  stock?: boolean;
  printer?: boolean;
  id?: number;
  raw?: string;
  basepath?: string;
  related?: Promise<Response>;
} = {}) {
  writeApiConfig({ baseUrl: basepath || "/", apiKey: "native-code-key" });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:native-product-code";
      static revokeObjectURL = vi.fn();
    },
  );
  const calls: { path: string; signal?: AbortSignal | null; method?: string }[] = [];
  const labels: ReturnType<typeof deferred>[] = [];

  const config = {
    FEATURE_FLAG_STOCK: stock,
    FEATURE_FLAG_SHOPPINGLIST: false,
    FEATURE_FLAG_LABEL_PRINTER: printer,
    LABEL_PRINTER_RUN_SERVER: false,
    LABEL_PRINTER_WEBHOOK: "https://printer.invalid/label",
  };

  const references = {
    locations: [{ id: 1, name: "Shelf", active: 1 }],
    quantity_units: [{ id: 1, name: "Piece", active: 1 }],
    shopping_locations: [],
    product_groups: [],
    products: [],
  };

  const product = {
    id,
    name: "Native coffee",
    description: "",
    active: 1,
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    picture_file_name: null,
    userfields: null,
  };

  const app = mountNativeEditor(
    `${basepath}/product/${raw}`,
    (url, init) => {
      const target = new URL(url, "https://app.invalid");

      const path = target.pathname.startsWith(basepath)
        ? target.pathname.slice(basepath.length)
        : target.pathname;

      calls.push({ path: path + target.search, signal: init?.signal, method: init?.method });

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (url === config.LABEL_PRINTER_WEBHOOK) return new Response(null, { status: 204 });

      if (path === "/api/v2/products/native-editor")
        return Response.json(
          nativeProductContext({ product: raw === "new" ? null : product, references, config }),
        );

      if (path === "/api/v2/user/permissions") return Response.json({});

      if (path === "/api/system/config") return Response.json(config);

      if (path === "/api/user") return Response.json([{ id: 2, username: "reader" }]);

      if (path === "/api/user/settings") return Response.json({});

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (path === "/api/v2/custom-data/fields") return Response.json([]);

      if (path === "/api/objects/quantity_units") return Response.json(references.quantity_units);

      if (path === "/api/objects/product_barcodes" && related) return related;

      if (path.endsWith("/grocycode"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

      if (path === `/api/stock/products/${id}/printlabel`) {
        const request = deferred();
        labels.push(request);

        return request.promise;
      }

      return undefined;
    },
    config,
    { basepath },
  );

  supportDescriptionEditors();

  return { ...app, calls, labels };
}

test("native saved Product exposes canonical ordinary code URLs while its unrelated barcode read is held or fails", async () => {
  const related = deferred();

  const app = mount({
    id: 0,
    raw: "000",
    basepath: "/house.hold/index.php",
    related: related.promise,
  });

  await screen.findByDisplayValue("Native coffee");
  const code = await screen.findByRole("region", { name: "Grocycode" });
  const download = within(code).getByRole<HTMLAnchorElement>("link", { name: "Download" });
  expect(new URL(download.href).pathname).toBe("/house.hold/index.php/product/0/grocycode");
  expect(new URL(download.href).search).toBe("?download=true");
  expect(download.hasAttribute("download")).toBe(false);
  expect(download.hasAttribute("target")).toBe(false);

  const print = within(code).getByRole<HTMLAnchorElement>("link", {
    name: "Print on label printer",
  });

  expect(print.getAttribute("href")).toBe("#");
  expect(print.classList.contains("product-grocycode-label-print")).toBe(true);
  expect(print.dataset.productId).toBe("0");
  expect(print.getAttribute("aria-disabled")).toBeNull();
  await within(code).findByRole("img", { name: "Native coffee Grocycode" });
  expect(app.calls.some((call) => call.path === "/product/0/grocycode?size=60")).toBe(true);
  expect(app.calls.some((call) => call.path.startsWith("/api/v2/products/0/grocycode"))).toBe(
    false,
  );
  await act(async () =>
    related.release(Response.json({ error_message: "Barcode table unavailable" }, { status: 503 })),
  );
  await screen.findByText("Barcode table unavailable");
  expect(screen.getByRole("region", { name: "Grocycode" })).toBe(code);
  expect(within(code).getByRole("link", { name: "Download" })).toBe(download);
});

test("native code visibility follows saved mode and printer flag independently of Stock", async () => {
  mount({ stock: false, printer: false });
  await screen.findByDisplayValue("Native coffee");
  const code = await screen.findByRole("region", { name: "Grocycode" });
  expect(within(code).getByRole("link", { name: "Download" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Barcodes" })).toBeNull();
  expect(within(code).queryByRole("link", { name: "Print on label printer" })).toBeNull();
});

test("native printer clicks stay independent and never use the modern pending lock or success receipt", async () => {
  const app = mount({ stock: false });
  await screen.findByDisplayValue("Native coffee");
  const print = await screen.findByRole("link", { name: "Print on label printer" });
  await userEvent.type(screen.getByLabelText("Name"), " unfinished draft");
  await userEvent.click(print);
  await userEvent.click(print);
  await waitFor(() => expect(app.labels).toHaveLength(2));
  expect(print.getAttribute("aria-disabled")).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Name").matches(":disabled")).toBe(false);
  await act(async () => {
    app.labels[1]!.release(Response.json({ product_id: 7, grocycode: "second" }));
    app.labels[0]!.release(Response.json({ product_id: 7, grocycode: "first" }));
  });
  await waitFor(() =>
    expect(
      app.fetchMock.mock.calls.filter(([url]) => String(url) === "https://printer.invalid/label"),
    ).toHaveLength(2),
  );
  expect(screen.queryByText("Label request sent")).toBeNull();
  expect(app.router.history.location.pathname).toBe("/product/07");
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
    "Native coffee unfinished draft",
  );
});

test("departing the native Product retires a held print before it can invoke the webhook", async () => {
  const app = mount();
  await screen.findByDisplayValue("Native coffee");
  await userEvent.click(await screen.findByRole("link", { name: "Print on label printer" }));
  await waitFor(() => expect(app.labels).toHaveLength(1));
  const pending = app.calls.find((call) => call.path.endsWith("/printlabel"))!;
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await screen.findByRole("heading", { name: "Settings", level: 1 });
  expect(pending.signal?.aborted).toBe(true);
  await act(async () => app.labels[0]!.release(Response.json({ grocycode: "late" })));
  expect(
    app.fetchMock.mock.calls.some(([url]) => String(url) === "https://printer.invalid/label"),
  ).toBe(false);
  expect(screen.queryByText("Label request sent")).toBeNull();
});
