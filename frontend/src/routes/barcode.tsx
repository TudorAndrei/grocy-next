import { useI18n } from "@/lib/i18n";
import { z } from "zod";
import type { JsonObject } from "@/lib/json";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { api, ApiError, type ExternalBarcodeProduct } from "@/lib/api";
import { objectsQuery } from "@/hooks/queries";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { CameraScanner } from "@/components/CameraScanner";

export const Route = createFileRoute("/barcode")({
  component: BarcodePage,
});

const scanModeSchema = z.enum(["lookup", "purchase", "consume", "open", "transfer", "inventory"]);

type ScanMode = z.infer<typeof scanModeSchema>;

function BarcodePage() {
  const { t: tr } = useI18n();

  const features = useFeatures();
  const preferences = usePreferences();
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const openingEnabled = features.enabled("STOCK_PRODUCT_OPENED_TRACKING");
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const locations = useQuery({ ...objectsQuery("locations"), enabled: locationsEnabled });
  const [barcode, setBarcode] = useState("");
  const [amount, setAmount] = useState("1");
  const [selectedMode, setMode] = useState<ScanMode | null>(null);

  const chosenMode =
    selectedMode ??
    (preferences.scanPurchase ? "purchase" : preferences.scanConsume ? "consume" : "lookup");

  const mode =
    (chosenMode === "open" && !openingEnabled) || (chosenMode === "transfer" && !locationsEnabled)
      ? "lookup"
      : chosenMode;

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
    mutationFn: async (scannedCode: string) => {
      const code = scannedCode.trim();

      if (!code) throw new Error(tr("Enter a barcode."));
      const qty = Number(amount);

      if (!Number.isFinite(qty) || qty < 0) {
        throw new Error(tr("Enter a valid amount."));
      }

      if (mode !== "inventory" && qty <= 0) {
        throw new Error(tr("Enter a positive amount."));
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

      if (mode === "purchase" && !features.enabled("STOCK_PRICE_TRACKING")) body.price = 0;

      if (mode === "transfer") {
        if (!from || !to) {
          throw new Error(tr("Choose from and to locations."));
        }

        body.location_id_from = Number(from);
        body.location_id_to = Number(to);
      } else if (locationsEnabled && from && (mode === "purchase" || mode === "inventory")) {
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

      if (!code) throw new Error(tr("Enter a barcode."));
      const created = await api.externalBarcodeLookup(code, true);

      if (!created) throw new Error(tr("External lookup found nothing to create."));
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
    run.mutate(barcode);
  };

  const needsLocation =
    locationsEnabled && (mode === "transfer" || mode === "inventory" || mode === "purchase");

  const showAmount = mode !== "lookup";

  const externalName = external?.name ?? null;

  const canCreateFromExternal =
    lookupMiss && external !== null && Boolean(externalName || external.__barcode);

  return (
    <>
      <PageHeader
        title={tr("Barcode")}
        lead={tr(
          "Look up products or post stock moves by barcode. The field stays focused for handheld scanners.",
        )}
      />
      <form className="panel panel-inner" onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="barcode-value">{tr("Barcode")}</label>
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
            <label htmlFor="barcode-mode">{tr("Action")}</label>
            <select
              id="barcode-mode"
              value={mode}
              onChange={(e) => setMode(scanModeSchema.parse(e.target.value))}
            >
              <option value="lookup">{tr("Look up")}</option>
              <option value="purchase">{tr("Purchase")}</option>
              <option value="consume">{tr("Consume")}</option>
              {openingEnabled ? <option value="open">{tr("Open")}</option> : null}
              {locationsEnabled ? <option value="transfer">{tr("Transfer")}</option> : null}
              <option value="inventory">{tr("Count stock")}</option>
            </select>
          </div>
          {showAmount ? (
            <div className="field">
              <label htmlFor="barcode-amount">
                {mode === "inventory" ? tr("New stock count") : tr("Amount in stock units")}
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
                {mode === "transfer" ? tr("From location") : tr("Location")}
              </label>
              <select
                id="barcode-from"
                required={mode === "transfer"}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                <option value="">
                  {mode === "purchase" || mode === "inventory"
                    ? tr("Product default")
                    : tr("Select location")}
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
              <label htmlFor="barcode-to">{tr("To location")}</label>
              <select id="barcode-to" required value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{tr("Select location")}</option>
                {(locations.data ?? []).map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="actions">
          <CameraScanner
            disabled={run.isPending}
            onScan={(code) => {
              setBarcode(code);
              run.mutate(code);
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={run.isPending}>
            {mode === "lookup" ? tr("Look up") : tr("Submit")}
          </button>
        </div>
      </form>
      {run.error ? <ErrorBlock message={run.error.message} /> : null}
      {createFromExternal.error ? <ErrorBlock message={createFromExternal.error.message} /> : null}
      {lookupMiss && !lookup ? (
        <section className="panel">
          <div className="panel-inner">
            <h2>{tr("No product for this barcode")}</h2>
            {canCreateFromExternal ? (
              <>
                <p>
                  {tr("External lookup found")} <strong>{externalName ?? tr("a product")}</strong>.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createFromExternal.isPending}
                  onClick={() => createFromExternal.mutate()}
                >
                  {tr("Create product from lookup")}
                </button>
              </>
            ) : (
              <p className="muted">
                {tr("External lookup did not return a creatable product for this code.")}
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
            <p className="muted">
              {tr("Product ID")} {lookup.product_id}
            </p>
            <div className="actions">
              <Link
                to="/products/$productId"
                params={{ productId: String(lookup.product_id) }}
                hash="stock-actions"
                className="btn btn-ghost"
              >
                {tr("Open product stock")}
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
