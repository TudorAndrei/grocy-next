import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { api, ApiError } from "@/lib/api";
import { userSettingsQuery } from "@/hooks/queries";

export const Route = createFileRoute("/barcode")({
  component: BarcodePage,
});

type ScanMode = "lookup" | "purchase" | "consume" | "open";

function BarcodePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const settings = useQuery(userSettingsQuery());
  const [barcode, setBarcode] = useState("");
  const [amount, setAmount] = useState("1");
  const [mode, setMode] = useState<ScanMode>("lookup");
  const [lookup, setLookup] = useState<Awaited<
    ReturnType<typeof api.getProductByBarcode>
  > | null>(null);
  const [external, setExternal] = useState<unknown>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    if (s.scan_mode_purchase_enabled === true || s.scan_mode_purchase_enabled === "1") {
      setMode("purchase");
    } else if (
      s.scan_mode_consume_enabled === true ||
      s.scan_mode_consume_enabled === "1"
    ) {
      setMode("consume");
    }
  }, [settings.data]);

  const run = useMutation({
    mutationFn: async () => {
      const code = barcode.trim();
      if (!code) throw new Error("Enter a barcode.");
      const qty = Number(amount);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Enter a positive amount.");
      }
      if (mode === "lookup") {
        const product = await api.getProductByBarcode(code);
        setLookup(product);
        try {
          setExternal(await api.externalBarcodeLookup(code));
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            setExternal(null);
          } else {
            throw error;
          }
        }
        return;
      }
      const action =
        mode === "purchase" ? "add" : mode === "consume" ? "consume" : "open";
      await api.stockActionByBarcode(code, action, { amount: qty });
      setLookup(null);
      setExternal(null);
    },
    onSuccess: async () => {
      if (mode !== "lookup") {
        await client.invalidateQueries();
        setBarcode("");
        inputRef.current?.focus();
      }
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    run.mutate();
  };

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
              onChange={(e) => setMode(e.target.value as ScanMode)}
            >
              <option value="lookup">Look up</option>
              <option value="purchase">Purchase</option>
              <option value="consume">Consume</option>
              <option value="open">Open</option>
            </select>
          </div>
          {mode !== "lookup" ? (
            <div className="field">
              <label htmlFor="barcode-amount">Amount</label>
              <input
                id="barcode-amount"
                type="number"
                min="0.000001"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={run.isPending}
        >
          {mode === "lookup" ? "Look up" : "Submit"}
        </button>
      </form>
      {run.error ? <ErrorBlock message={run.error.message} /> : null}
      {lookup ? (
        <section className="panel">
          <div className="panel-inner">
            <h2>{lookup.product.name}</h2>
            <p className="muted">Product ID {lookup.product_id}</p>
            <Link
              to="/products/$productId"
              params={{ productId: String(lookup.product_id) }}
              className="btn btn-ghost"
            >
              Open product
            </Link>
            {external ? (
              <pre className="code-block">{JSON.stringify(external, null, 2)}</pre>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
