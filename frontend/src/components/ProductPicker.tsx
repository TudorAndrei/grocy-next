import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import type { EntityRow } from "@/lib/entities";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";
import { CameraScanner } from "./CameraScanner";
import { ErrorBlock } from "./ErrorBlock";

export type ProductCode = { barcode: string; stockId?: string };

type ProductChoice = { id: number; name: string };

export function ProductPicker({
  products,
  barcodes,
  plugin,
  value,
  required,
  disabled,
  lookupDisabled,
  autoFocus,
  listId = 1,
  itemId,
  allowCreate = true,
  workflowPath,
  onChange,
  onResolved,
  onAssignBarcode,
  onBusyChange,
}: {
  products: ProductChoice[];
  barcodes: { product_id: number; barcodes: string | null }[];
  plugin: string;
  value: string;
  required: boolean;
  disabled: boolean;
  lookupDisabled: boolean;
  autoFocus: boolean;
  listId?: number;
  itemId?: number;
  allowCreate?: boolean;
  workflowPath?: string;
  onChange: (value: string, code?: ProductCode) => void;
  onResolved: () => void;
  onAssignBarcode: (barcode: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const navigate = useNavigate();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const selection = useRef(value);
  const alive = useRef(true);
  const focusFrame = useRef<number>(undefined);
  const focusAfterCamera = useRef(false);
  const lookupCode = useRef<string>(undefined);

  const [text, setText] = useState(
    products.find((product) => String(product.id) === value)?.name ?? "",
  );

  const [unknown, setUnknown] = useState<string>();
  const [message, setMessage] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  const cameraChange = useCallback((open: boolean) => {
    setCameraOpen(open);

    if (!open && !selection.current) requestAnimationFrame(() => input.current?.focus());
  }, []);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;

      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    };
  }, []);

  useEffect(() => {
    if (selection.current === value) return;
    selection.current = value;
    setText(products.find((product) => String(product.id) === value)?.name ?? "");
  }, [products, value]);

  const choose = (product?: ProductChoice, code?: ProductCode) => {
    selection.current = product ? String(product.id) : "";
    setText(product?.name ?? "");
    onChange(selection.current, code);
    setMessage("");

    if (product) {
      if (cameraOpen) focusAfterCamera.current = true;
      else onResolved();
    }
  };

  useEffect(() => {
    if (!cameraOpen && focusAfterCamera.current) {
      focusAfterCamera.current = false;
      onResolved();
    }
  }, [cameraOpen, onResolved]);

  const focus = () => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = undefined;
      input.current?.focus();
      input.current?.select();
    });
  };

  const check = useMutation({
    mutationFn: async (code: string) => {
      const barcodeQuery = new URLSearchParams([["query[]", `barcode=${code}`]]);

      const foundBarcodes = await request<EntityRow[]>(
        `/api/objects/product_barcodes_view?${barcodeQuery}`,
      );

      const productQuery = new URLSearchParams([["query[]", `name=${code}`]]);
      const foundProducts = await request<EntityRow[]>(`/api/objects/products?${productQuery}`);

      return foundBarcodes.length > 0 || foundProducts.length > 0;
    },
    onSuccess: (exists, code) => {
      if (!alive.current || lookupCode.current !== code) return;

      if (exists) {
        choose();
        setMessage(t("This product is not in stock"));
        focus();
      } else setUnknown(code);
    },
  });

  const startProduct = async (
    mode: "name" | "barcode" | "external",
    code: string,
    productId = "new",
  ) => {
    const flow =
      mode === "barcode" ? "InplaceAddBarcodeToExistingProduct" : "InplaceNewProductWithName";

    const params = new URLSearchParams(workflowPath ? { flow } : { list: String(listId), flow });

    if (mode === "barcode") params.set("barcode", code);
    const path = workflowPath ?? `/shoppinglistitem/${itemId ?? "new"}`;
    const returnto = `${path}${path.includes("?") ? "&" : "?"}${params}`;
    await navigate({
      to: "/product/$productId",
      params: { productId },
      search: {
        flow:
          mode === "name"
            ? "InplaceNewProductWithName"
            : mode === "barcode"
              ? "InplaceNewProductWithBarcode"
              : "InplaceNewProductByExternalBarcodeLookupPlugin",
        name: mode === "name" ? code : undefined,
        barcode: mode === "barcode" ? code : undefined,
        returnto,
      },
    });
  };

  const external = useMutation({
    mutationFn: (code: string) => api.externalBarcodeLookup(code, true),
    onSuccess: async (product, code) => {
      if (!alive.current) return;

      if (product === null) {
        setUnknown(undefined);
        setMessage(t("Nothing was found for the given barcode"));
        focus();

        return;
      }

      const id = Number(product.id ?? product.product_id);

      if (!Number.isInteger(id) || id <= 0)
        throw new Error(t("External lookup returned no product."));
      await client.invalidateQueries();

      if (alive.current) await startProduct("external", code, String(id));
    },
  });

  useEffect(
    () => onBusyChange(check.isPending || external.isPending),
    [check.isPending, external.isPending, onBusyChange],
  );

  const resolve = (code: string) => {
    lookupCode.current = code;
    setText(code);
    setMessage("");
    check.reset();
    external.reset();

    if (!code) {
      choose();

      return;
    }

    let found: ProductChoice | undefined;
    let resolvedCode: ProductCode | undefined;

    if (!lookupDisabled) {
      if (code.startsWith("grcy")) {
        const parts = code.split(":");

        if (parts[1] === "p") {
          found = products.find((product) => String(product.id) === parts[2]);

          if (found)
            resolvedCode = { barcode: code, stockId: parts.length === 4 ? parts[3] : undefined };
        }
      } else {
        found = products.find((product) => {
          const codes = barcodes.find((row) => row.product_id === product.id)?.barcodes;

          return `${codes?.toLowerCase() ?? ""},`.includes(code.toLowerCase() + ",");
        });

        if (found) resolvedCode = { barcode: code };
      }
    }

    found ??= products.find((product) => product.name.toLowerCase() === code.toLowerCase());
    found ??= products.find((product) => product.name.includes(code));

    if (found) {
      choose(found, resolvedCode);

      return;
    }

    selection.current = "";
    onChange("");

    if (!lookupDisabled) check.mutate(code);
  };

  const cancel = () => {
    setUnknown(undefined);
    focus();
  };

  const scanAgain = () => {
    setUnknown(undefined);
    choose();
    setCameraOpen(true);
  };

  const assign = () => {
    if (unknown === undefined) return;
    onAssignBarcode(unknown);
    setUnknown(undefined);
    choose();
    focus();
  };

  return (
    <div className="field" ref={container}>
      <label htmlFor={id}>{t("Product")}</label>
      <input
        ref={input}
        id={id}
        list={`${id}-options`}
        autoComplete="off"
        value={text}
        autoFocus={autoFocus}
        required={required}
        disabled={disabled || check.isPending}
        onChange={(event) => {
          if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
          focusFrame.current = undefined;
          const next = event.target.value;
          lookupCode.current = next;
          setText(next);
          setMessage("");
          const product = products.find((product) => product.name === next);
          selection.current = product ? String(product.id) : "";
          onChange(selection.current);
        }}
        onBlur={(event) => {
          if (
            !disabled &&
            !check.isPending &&
            unknown === undefined &&
            !(
              event.relatedTarget instanceof Node &&
              container.current?.contains(event.relatedTarget)
            )
          )
            resolve(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            resolve(event.currentTarget.value);
          }
        }}
      />
      <datalist id={`${id}-options`}>
        {products.map((product) => (
          <option key={product.id} value={product.name} />
        ))}
      </datalist>
      <CameraScanner
        disabled={disabled || check.isPending}
        open={cameraOpen}
        onOpenChange={cameraChange}
        onScan={resolve}
      />
      {check.isPending ? <p role="status">{t("Loading…")}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {check.isError ? <ErrorBlock message={check.error.message} /> : null}
      {unknown !== undefined
        ? createPortal(
            <ProductWorkflows
              code={unknown}
              plugin={allowCreate ? plugin : ""}
              allowCreate={allowCreate}
              busy={external.isPending}
              error={external.error?.message}
              camera={!features.enabled("DISABLE_BROWSER_BARCODE_CAMERA_SCANNING")}
              onCancel={cancel}
              onAssign={assign}
              onName={() => {
                void startProduct("name", unknown);
              }}
              onBarcode={() => {
                void startProduct("barcode", unknown);
              }}
              onExternal={() => external.mutate(unknown)}
              onCamera={scanAgain}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function ProductWorkflows({
  code,
  plugin,
  allowCreate,
  busy,
  error,
  camera,
  onCancel,
  onAssign,
  onName,
  onBarcode,
  onExternal,
  onCamera,
}: {
  code: string;
  plugin: string;
  allowCreate: boolean;
  busy: boolean;
  error?: string;
  camera: boolean;
  onCancel: () => void;
  onAssign: () => void;
  onName: () => void;
  onBarcode: () => void;
  onExternal: () => void;
  onCamera: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();

  const actions = new Map([
    ...(allowCreate ? [["p", onName] as const, ["a", onBarcode] as const] : []),
    ["b", onAssign],
    ...(plugin ? [["e", onExternal] as const] : []),
    ...(camera ? [["c", onCamera] as const] : []),
  ]);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog shopping-product-workflows"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!busy) onCancel();
      }}
      onKeyDown={(event) => {
        const action = actions.get(event.key.toLowerCase());

        if (action && !busy && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault();
          action();
        }
      }}
    >
      <h2 id={title}>{t("Create or assign product")}</h2>
      <p>{t('"%s" could not be resolved to a product, how do you want to proceed?', code)}</p>
      {error ? <ErrorBlock message={error} /> : null}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </button>
        {allowCreate ? (
          <button type="button" className="btn" disabled={busy} onClick={onName}>
            <kbd>P</kbd>
            {t("Add as new product")}
          </button>
        ) : null}
        <button type="button" className="btn" disabled={busy} onClick={onAssign}>
          <kbd>B</kbd>
          {t("Add as barcode to existing product")}
        </button>
        {allowCreate ? (
          <button type="button" className="btn" disabled={busy} onClick={onBarcode}>
            <kbd>A</kbd>
            {t("Add as new product and prefill barcode")}
          </button>
        ) : null}
        {plugin ? (
          <button type="button" className="btn" disabled={busy} onClick={onExternal}>
            <kbd>E</kbd>
            {t("External barcode lookup")} ({plugin})
          </button>
        ) : null}
        {camera ? (
          <button type="button" className="btn" disabled={busy} onClick={onCamera}>
            <kbd>C</kbd>
            {t("Scan with camera")}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
