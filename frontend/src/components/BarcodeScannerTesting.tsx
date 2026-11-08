import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "./PageHeader";
import { CameraScanner } from "./CameraScanner";

type ScanResult = { id: number; barcode: string; hit: boolean };

export function BarcodeScannerTesting({ search }: { search: string }) {
  const { t } = useI18n();
  const id = useId();
  const prefill = nativeQueryParameter(search, "barcode");
  const [expected, setExpected] = useState(() => (prefill === undefined ? "" : String(prefill)));
  const [scanned, setScanned] = useState("");
  const [scanEnabled, setScanEnabled] = useState(false);
  const [focusScan, setFocusScan] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);

  const [history, setHistory] = useState<{ hits: number; misses: number; results: ScanResult[] }>({
    hits: 0,
    misses: 0,
    results: [],
  });

  const expectedInput = useRef<HTMLInputElement>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const delay = useRef(500);
  const timers = useRef(new Set<number>());
  const alive = useRef(false);

  const updateEnabled = (value: string) => {
    setScanEnabled(value.length > 1);
    setCameraEnabled(value.length > 1);
  };

  useLayoutEffect(() => {
    if (!focusScan) return;
    scanInput.current?.focus();
  }, [focusScan]);

  useEffect(() => {
    alive.current = true;
    delay.current = 500;

    const initial = window.setTimeout(() => {
      setCameraEnabled(false);
      expectedInput.current?.focus();

      if (prefill !== undefined) {
        updateEnabled(expectedInput.current?.value ?? "");
        setFocusScan(true);
      }
    }, 500);

    const initialized = window.setTimeout(() => {
      delay.current = 0;
    }, 1000);

    const pending = timers.current;

    return () => {
      alive.current = false;
      window.clearTimeout(initial);
      window.clearTimeout(initialized);

      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, [prefill]);

  const record = (barcode: string) => {
    if (!alive.current || barcode.length === 0) return;
    const hit = barcode === (expectedInput.current?.value ?? expected);
    setHistory((current) => ({
      hits: current.hits + Number(hit),
      misses: current.misses + Number(!hit),
      results: [{ id: current.results.length, barcode, hit }, ...current.results],
    }));

    // Each native result schedules its own clear: Enter and blur may both count
    // the same value before the initial focus delay expires.
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);

      if (!alive.current) return;
      setScanned("");

      if (document.activeElement !== expectedInput.current) scanInput.current?.focus();
    }, delay.current);

    timers.current.add(timer);
  };

  return (
    <>
      <PageHeader title={t("Barcode scanner testing")} />
      <form
        className="panel panel-inner scanner-diagnostic"
        noValidate
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="field" htmlFor={`${id}-expected`}>
          {t("Expected barcode")}
          <input
            ref={expectedInput}
            id={`${id}-expected`}
            type="text"
            required
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            onKeyUp={(event) => updateEnabled(event.currentTarget.value)}
          />
        </label>
        <label className="field" htmlFor={`${id}-scanned`}>
          {t("Scan field")}
          <input
            ref={scanInput}
            id={`${id}-scanned`}
            type="text"
            disabled={!scanEnabled}
            value={scanned}
            onChange={(event) => setScanned(event.target.value)}
            onBlur={(event) => record(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                record(event.currentTarget.value);
              }
            }}
          />
        </label>
        <CameraScanner disabled={!cameraEnabled} onScan={record} />
        <div className="scanner-diagnostic-counts" aria-live="polite">
          <span
            data-result="hit"
            data-flash={history.hits ? (history.hits % 2 ? "odd" : "even") : undefined}
          >
            {t("Hit")}: <span aria-label={t("Hit count")}>{String(history.hits)}</span>
          </span>
          <span aria-hidden="true"> // </span>
          <span
            data-result="miss"
            data-flash={history.misses ? (history.misses % 2 ? "odd" : "even") : undefined}
          >
            {t("Miss")}: <span aria-label={t("Miss count")}>{String(history.misses)}</span>
          </span>
        </div>
        <label className="field" htmlFor={`${id}-history`}>
          {t("Scanned barcodes")}
          <select className="scanner-diagnostic-history" id={`${id}-history`} multiple size={30}>
            {history.results.map((result) => (
              <option key={result.id} data-result={result.hit ? "hit" : "miss"}>
                {result.barcode}
              </option>
            ))}
          </select>
        </label>
      </form>
    </>
  );
}
