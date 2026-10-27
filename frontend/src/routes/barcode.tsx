import { z } from "zod";
import type { JsonObject } from "@/lib/json";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { api, ApiError, type ExternalBarcodeProduct } from "@/lib/api";
import { objectsQuery, userSettingsQuery } from "@/hooks/queries";

export const Route = createFileRoute("/barcode")({
  component: BarcodePage,
});

const scanModeSchema = z.enum(["lookup", "purchase", "consume", "open", "transfer", "inventory"]);

type ScanMode = z.infer<typeof scanModeSchema>;

function BarcodePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const settings = useQuery(userSettingsQuery());
  const locations = useQuery(objectsQuery("locations"));
  const [barcode, setBarcode] = useState("");
  const [amount, setAmount] = useState("1");
  const [selectedMode, setMode] = useState<ScanMode | null>(null);
  const s = settings.data;

  const mode =
    selectedMode ??
    (s?.scan_mode_purchase_enabled === true || s?.scan_mode_purchase_enabled === "1"
      ? "purchase"
      : s?.scan_mode_consume_enabled === true || s?.scan_mode_consume_enabled === "1"
        ? "consume"
        : "lookup");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [lookup, setLookup] = useState<Awaited<ReturnType<typeof api.getProductByBarcode>> | null>(
    null,
  );

  const [external, setExternal] = useState<ExternalBarcodeProduct | null>(null);

  const [lookupMiss, setLookupMiss] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = useMutation({
    mutationFn: async () => {
      const code = barcode.trim();

      if (!code) throw new Error("Enter a barcode.");
      const qty = Number(amount);

      if (!Number.isFinite(qty) || qty < 0) {
        throw new Error("Enter a valid amount.");
      }

      if (mode !== "inventory" && qty <= 0) {
        throw new Error("Enter a positive amount.");
      }

      if (mode === "lookup") {
        setLookup(null);
        setExternal(null);
        setLookupMiss(false);

        try {
          const product = await api.getProductByBarcode(code);
          setLookup(product);

          return;
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            (error.status !== 404 &&
              !(error.status === 400 && error.message === `No product with barcode ${code} found`))
          ) {
            throw error;
          }

          setLookupMiss(true);
        }

        try {
          setExternal(await api.externalBarcodeLookup(code));
        } catch (error) {
          if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
            setExternal(null);
          } else {
            throw error;
          }
        }

        return;
      }

      const body: JsonObject = mode === "inventory" ? { new_amount: qty } : { amount: qty };

      if (mode === "transfer") {
        if (!from || !to) {
          throw new Error("Choose from and to locations.");
        }

        body.location_id_from = Number(from);
        body.location_id_to = Number(to);
      } else if (from && (mode === "purchase" || mode === "inventory")) {
        body.location_id = Number(from);
      }

      const action =
        mode === "purchase"
          ? "add"
          : mode === "consume"
            ? "consume"
            : mode === "open"
              ? "open"
              : mode === "transfer"
                ? "transfer"
                : "inventory";

      await api.stockActionByBarcode(code, action, body);
      setLookup(null);
      setExternal(null);
      setLookupMiss(false);
    },
    onSuccess: async () => {
      if (mode !== "lookup") {
        await client.invalidateQueries();
        setBarcode("");
        inputRef.current?.focus();
      }
    },
  });

  const createFromExternal = useMutation({
    mutationFn: async () => {
      const code = barcode.trim();

      if (!code) throw new Error("Enter a barcode.");
      const created = await api.externalBarcodeLookup(code, true);

      if (!created) throw new Error("External lookup found nothing to create.");
      setExternal(created);
      setLookupMiss(false);
      const id = Number(created.id ?? created.product_id);

      if (Number.isFinite(id) && id > 0) {
        try {
          setLookup(await api.getProductByBarcode(code));
        } catch {
          setLookup(null);
        }
      }

      return created;
    },
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    run.mutate();
  };

  const needsLocation = mode === "transfer" || mode === "inventory" || mode === "purchase";

  const showAmount = mode !== "lookup";

  const externalName = external?.name ?? null;

  const canCreateFromExternal =
    lookupMiss && external !== null && Boolean(externalName || external.__barcode);

  return (
    <>
      <PageHeader
        title="Barcode"
        lead="Look up products or post stock moves by barcode. The field stays focused for handheld scanners."
      />
      <form className="panel panel-inner" onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="barcode-value">Barcode</label>
            <input
              ref={inputRef}
              id="barcode-value"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
          </div>
          <div className="field">
            <label htmlFor="barcode-mode">Action</label>
            <select
              id="barcode-mode"
              value={mode}
              onChange={(e) => setMode(scanModeSchema.parse(e.target.value))}
            >
              <option value="lookup">Look up</option>
              <option value="purchase">Purchase</option>
              <option value="consume">Consume</option>
              <option value="open">Open</option>
              <option value="transfer">Transfer</option>
              <option value="inventory">Count stock</option>
            </select>
          </div>
          {showAmount ? (
            <div className="field">
              <label htmlFor="barcode-amount">
                {mode === "inventory" ? "New stock count" : "Amount in stock units"}
              </label>
              <input
                id="barcode-amount"
                type="number"
                min={mode === "inventory" ? "0" : "0.000001"}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          ) : null}
          {needsLocation ? (
            <div className="field">
              <label htmlFor="barcode-from">
                {mode === "transfer" ? "From location" : "Location"}
              </label>
              <select
                id="barcode-from"
                required={mode === "transfer"}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                <option value="">
                  {mode === "purchase" || mode === "inventory"
                    ? "Product default"
                    : "Select location"}
                </option>
                {(locations.data ?? []).map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {mode === "transfer" ? (
            <div className="field">
              <label htmlFor="barcode-to">To location</label>
              <select id="barcode-to" required value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Select location</option>
                {(locations.data ?? []).map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <button type="submit" className="btn btn-primary" disabled={run.isPending}>
          {mode === "lookup" ? "Look up" : "Submit"}
        </button>
      </form>
      {run.error ? <ErrorBlock message={run.error.message} /> : null}
      {createFromExternal.error ? <ErrorBlock message={createFromExternal.error.message} /> : null}
      {lookupMiss && !lookup ? (
        <section className="panel">
          <div className="panel-inner">
            <h2>No product for this barcode</h2>
            {canCreateFromExternal ? (
              <>
                <p>
                  External lookup found <strong>{externalName ?? "a product"}</strong>.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createFromExternal.isPending}
                  onClick={() => createFromExternal.mutate()}
                >
                  Create product from lookup
                </button>
              </>
            ) : (
              <p className="muted">
                External lookup did not return a creatable product for this code.
              </p>
            )}
            {external ? (
              <pre className="code-block">{JSON.stringify(external, null, 2)}</pre>
            ) : null}
          </div>
        </section>
      ) : null}
      {lookup ? (
        <section className="panel">
          <div className="panel-inner">
            <h2>{lookup.product.name}</h2>
            <p className="muted">Product ID {lookup.product_id}</p>
            <div className="actions">
              <Link
                to="/products/$productId"
                params={{ productId: String(lookup.product_id) }}
                hash="stock-actions"
                className="btn btn-ghost"
              >
                Open product stock
              </Link>
            </div>
            {external ? (
              <pre className="code-block">{JSON.stringify(external, null, 2)}</pre>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
