import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { notifyManager } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import { overviewFixture } from "./fixtures/stock-overview";
import { productOverview } from "./fixtures/product-overview";
import { pictureBytes } from "./fixtures/picture";

function held() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

const entries = () => Response.json([{ stock_id: "left" }, { stock_id: "right" }]);

function mount(
  path: string,
  options: { field?: Promise<Response>; webhook?: Promise<Response> } = {},
) {
  const transaction = held();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const writes: { url: string; body: JsonObject }[] = [];
  const hooks: { body: JsonObject; signal: AbortSignal | null | undefined }[] = [];
  const transactionSignals: (AbortSignal | null | undefined)[] = [];
  let amount = 2;
  let catalogReads = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:purchase-lifetime";
      static revokeObjectURL = () => {};
    },
  );

  const app = mountNativeEditor(
    path,
    (url, init) => {
      if (url === "/api/v2/user/permissions") return Response.json({ STOCK_PURCHASE: true });

      if (url === "/api/user/settings")
        return Response.json({ stock_default_purchase_amount: 2, stock_decimal_places_amounts: 2 });

      if (url === "/api/system/db-changed-time")
        return Response.json({ changed_time: "2026-11-07 10:00:00" });

      if (url === "/api/v2/stock/overview")
        return Response.json(
          overviewFixture([{ product_id: 7, product: { id: 7, name: "Coffee" }, amount }]),
        );

      if (url.startsWith("/api/stock/volatile"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      if (url === "/api/stock") return Response.json([]);

      if (url === "/api/v2/custom-data/fields") return Response.json([]);

      if (url === "/api/v2/stock/purchase/editor") {
        catalogReads++;

        return Response.json({
          barcode_lookup_plugin_name: "Demo",
          products: [{ id: 7, name: "Coffee" }],
          locations: [{ id: 1, name: "Shelf", is_freezer: 0 }],
          stores: [],
          units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
          barcodes: [],
          fields: [
            {
              id: 1,
              name: "batch",
              caption: "Batch",
              type: "text-single-line",
              input_required: 0,
              default_value: null,
              config: null,
            },
          ],
          conversions: [
            {
              product_id: 7,
              from_qu_id: 1,
              to_qu_id: 1,
              factor: "1",
              to_qu_name: "Piece",
              to_qu_name_plural: "Pieces",
            },
          ],
        });
      }

      if (url === "/api/stock/products/7")
        return Response.json({
          ...productOverview,
          product: {
            ...productOverview.product,
            parent_product_id: null,
            min_stock_amount: 0,
            due_type: 1,
            enable_tare_weight_handling: 0,
            tare_weight: 0,
            default_best_before_days: 5,
            default_best_before_days_after_freezing: 0,
            default_purchase_price_type: 1,
            default_stock_label_type: 0,
          },
          stock_amount: amount,
          stock_amount_aggregated: amount,
          stock_amount_opened: 0,
          stock_amount_opened_aggregated: 0,
          stock_value: 0,
          next_due_date: null,
          quantity_unit_stock: {
            id: 1,
            name: "Piece",
            name_plural: "Pieces",
            plural_forms: null,
            active: 1,
          },
          default_quantity_unit_purchase: { id: 1, name: "Piece", name_plural: "Pieces" },
          location: { id: 1, name: "Shelf", is_freezer: 0 },
          last_price: null,
          last_shopping_location_id: null,
          default_shopping_location_id: null,
        });

      if (url === "/api/v2/content/products/7") return Response.json({ html: "" });

      if (url.includes("grocycode"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

      if (url === "/api/stock/products/7/add" && init?.method === "POST") {
        const body: JsonObject = JSON.parse(String(init.body));
        writes.push({ url, body });
        amount += Number(body.amount);

        return Response.json([
          {
            id: 90,
            product_id: 7,
            transaction_id: "purchase-print",
            stock_id: "booked",
            best_before_date: "2030-12-24",
          },
        ]);
      }

      if (url === "/api/userfields/stock/purchase-print" && init?.method === "PUT") {
        writes.push({ url, body: JSON.parse(String(init.body)) });

        return options.field ?? Response.json({});
      }

      if (url === "/api/stock/transactions/purchase-print") {
        transactionSignals.push(init?.signal);

        return transaction.promise;
      }

      if (url === "https://printer.invalid/labels") {
        hooks.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });

        return options.webhook ?? new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/v2/tasks/overview"))
        return Response.json({ rows: [], categories: [], next_days: 5, include_done: false });

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_SHOPPINGLIST: false,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
      FEATURE_FLAG_LABEL_PRINTER: true,
      LABEL_PRINTER_RUN_SERVER: false,
      LABEL_PRINTER_WEBHOOK: "https://printer.invalid/labels",
      LABEL_PRINTER_PARAMS: { document: "purchase" },
    },
  );

  return {
    ...app,
    transaction,
    errors,
    writes,
    hooks,
    transactionSignals,
    catalogReads: () => catalogReads,
  };
}

async function submit(app: ReturnType<typeof mount>, dialog: boolean) {
  if (dialog) await userEvent.click(await screen.findByRole("button", { name: "Purchase Coffee" }));
  else {
    const picker = await screen.findByLabelText<HTMLInputElement>("Product");
    fireEvent.change(picker, { target: { value: "Coffee" } });
  }

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));

  // Product initialization finishes with a scheduled focus; enabled controls appear earlier.
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "Booked lot");
  await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.transactionSignals).toHaveLength(1));
}

async function receipt() {
  await screen.findByText("Added 2 Pieces of Coffee to stock");
}

async function release(gate: ReturnType<typeof held>, response: Response) {
  await act(async () => {
    gate.release(response);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
}

for (const path of ["/stockoverview", "/stock"]) {
  for (const outcome of ["success", "failure"]) {
    test(`${path} destroys its purchase document after the receipt and retires a late transaction ${outcome}`, async () => {
      const app = mount(path);
      await submit(app, true);
      await receipt();
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull());
      expect(app.writes.find((write) => write.url.includes("/userfields/"))?.body).toEqual({
        batch: "Booked lot",
      });
      await release(
        app.transaction,
        outcome === "success"
          ? entries()
          : Response.json({ error_message: "Late transaction failure" }, { status: 503 }),
      );
      expect(app.hooks).toEqual([]);
      expect(app.errors).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
      expect(app.router.history.location.pathname).toBe(path);
      expect(app.transactionSignals[0]?.aborted).toBe(true);
    });
  }
}

test("a webhook failure after a destructive purchase dialog closes does not reach the surviving page", async () => {
  const field = held();
  const webhook = held();
  const app = mount("/stockoverview", { field: field.promise, webhook: webhook.promise });
  await submit(app, true);
  await release(app.transaction, entries());
  await waitFor(() => expect(app.hooks).toHaveLength(2));
  expect(screen.getByRole("dialog", { name: "Purchase" })).toBeTruthy();
  await release(field, Response.json({}));
  await receipt();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull());
  await release(webhook, new Response("Late printer failure", { status: 503 }));
  expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
  expect(app.hooks.every((hook) => hook.signal?.aborted)).toBe(true);
});

test.each(["success", "failure"])(
  "a root purchase task never revives after leaving and returning to the same URL: %s",
  async (outcome) => {
    const app = mount("/purchase");
    await submit(app, false);
    await receipt();
    await act(async () => {
      await app.router.navigate({ to: "/tasks", search: {} });
    });
    await screen.findByRole("heading", { name: "Tasks" });
    await act(async () => {
      await app.router.navigate({ to: "/purchase", search: {} });
    });
    await screen.findByLabelText("Product");
    await release(
      app.transaction,
      outcome === "success"
        ? entries()
        : Response.json({ error_message: "Retired transaction failure" }, { status: 503 }),
    );
    expect(app.hooks).toEqual([]);
    expect(app.errors).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
    expect(app.transactionSignals[0]?.aborted).toBe(true);
  },
);

test("an explicit native reload retires a held purchase task even when its pathname is unchanged", async () => {
  const app = mount("/purchase");
  await submit(app, false);
  await receipt();
  expect(app.router.history.location.href).toBe("/purchase?");
  const previous = app.catalogReads();

  const purchase = within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", {
    name: "Purchase",
  });

  expect(purchase.getAttribute("href")).toBe("/purchase");

  await userEvent.click(purchase);
  await waitFor(() => expect(app.catalogReads()).toBeGreaterThan(previous));
  expect(app.router.history.location.href).toBe("/purchase");
  await release(app.transaction, entries());
  expect(app.hooks).toEqual([]);
  expect(app.transactionSignals[0]?.aborted).toBe(true);
});

test.each(["success", "webhook failure"])(
  "same-document purchase reset and query/hash edits retain printing: %s",
  async (outcome) => {
    const webhook = held();
    const app = mount("/purchase", { webhook: webhook.promise });
    await submit(app, false);
    await receipt();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Product")));
    await release(app.transaction, entries());
    await waitFor(() => expect(app.hooks).toHaveLength(2));
    await act(async () => {
      await app.router.navigate({ href: "/purchase?retained=1#after-reset" });
    });
    expect(app.transactionSignals[0]?.aborted).not.toBe(true);
    expect(app.hooks.every((hook) => !hook.signal?.aborted)).toBe(true);
    expect(app.hooks.map((hook) => hook.body)).toEqual([
      {
        product: "Coffee",
        grocycode: "grcy:p:7:left",
        due_date: "DD: 2030-12-24",
        document: "purchase",
      },
      {
        product: "Coffee",
        grocycode: "grcy:p:7:right",
        due_date: "DD: 2030-12-24",
        document: "purchase",
      },
    ]);
    await release(
      webhook,
      outcome === "success"
        ? new Response(null, { status: 204 })
        : new Response("Printer failure", { status: 503 }),
    );

    if (outcome === "webhook failure")
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: /Error while executing WebHook/ }),
        ).toHaveLength(2),
      );
    else expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
  },
);
