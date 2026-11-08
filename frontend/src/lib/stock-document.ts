import { useState } from "react";
import { z } from "zod";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./api";
import type { JsonObject } from "./json";
import { nativeQueryParameter, nativeQueryParameterPresent } from "./native-query-flag";
import { useNativeDocumentReload } from "./native-document";

type StockOptions = Record<string, string | undefined>;

type Kind = "purchase" | "consume" | "inventory" | "transfer";

/** Native control initialization and live GetUriParam reads have separate lifetimes. */
export function initialStockOptions<Options extends StockOptions>(
  search: string,
  parameters: readonly (keyof Options & string)[],
): Partial<Record<keyof Options, string>> {
  const options: Partial<Record<keyof Options, string>> = {};

  const keys = new Set(
    search
      .replace(/^\?/, "")
      .split("&")
      .map((part) => part.split("=")[0]),
  );

  for (const key of parameters) {
    if (!keys.has(key)) continue;

    // Delay decoding until the original control actually reads the parameter.
    Object.defineProperty(options, key, {
      enumerable: true,
      get: () => String(nativeQueryParameter(search, key)),
    });
  }

  return options;
}

function logicalSearch(options: StockOptions) {
  const parts = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) =>
      key === "embedded" && value === ""
        ? key
        : `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );

  return parts.length ? `?${parts.join("&")}` : "";
}

function stockUrl(kind: Kind, config: JsonObject | undefined, basepath: string) {
  const configuredBase = z.string().safeParse(config?.BASE_URL);

  if (!configuredBase.success) return `${basepath.replace(/\/$/, "")}/${kind}`;

  const base = configuredBase.data === "/" ? window.location.origin : configuredBase.data;

  const script =
    config?.DISABLE_URL_REWRITING === undefined || config.DISABLE_URL_REWRITING === false
      ? ""
      : "/index.php";

  return `${base.replace(/\/+$/, "")}${script}/${kind}`;
}

export type StockDocument<Options extends StockOptions> = {
  revision: number;
  initialOptions: Partial<Record<keyof Options, string>>;
  /** PHP-rendered markup remains fixed when browser history changes. */
  readonly serverEmbedded: boolean;
  read: (name: string) => string | true | undefined;
  barcodeAdded: () => void;
  finishFlow: () => void;
  assignBarcode: (barcode: string) => void;
};

/** Inline booking dialogs own a logical child URI, never their parent's stock query. */
export function useStockDocument<Options extends StockOptions>(
  kind: Kind,
  initialOptions: Options,
  parameters: readonly (keyof Options & string)[],
): StockDocument<Options> {
  const router = useRouter();
  const client = useQueryClient();
  const reload = useNativeDocumentReload(`/${kind}`);
  const [revision, setRevision] = useState(0);

  const [document] = useState<StockDocument<Options>>(() => {
    const physical = router.state.location.pathname.replace(/\/$/, "") === `/${kind}`;

    const canonical = stockUrl(
      kind,
      client.getQueryData<JsonObject>(queryKeys.systemConfig),
      router.options.basepath ?? "/",
    );

    let logical = { pathname: canonical, search: physical ? "" : logicalSearch(initialOptions) };
    const current = () => (physical ? router.history.location : logical);
    let initial = initialStockOptions<Options>(current().search, parameters);
    let serverEmbedded = nativeQueryParameterPresent(current().search, "embedded");

    const replace = (href: string, push = false) => {
      if (physical) {
        const target = new URL(href, window.location.href);

        if (target.origin !== window.location.origin)
          throw new DOMException(
            "History replacement must remain on the same origin",
            "SecurityError",
          );
        const location = target.href.slice(target.origin.length);

        if (push) router.history.push(location);
        else router.history.replace(location);
      } else {
        const target = new URL(href, window.location.href);
        logical = { pathname: target.pathname, search: target.search };
      }
    };

    return {
      revision: 0,
      get initialOptions() {
        return initial;
      },
      get serverEmbedded() {
        return serverEmbedded;
      },
      read: (name) => nativeQueryParameter(current().search, name),
      barcodeAdded: () => replace(canonical),
      assignBarcode: (barcode) => {
        const embedded = nativeQueryParameter(current().search, "embedded") !== undefined;
        replace(
          `${canonical}?flow=InplaceAddBarcodeToExistingProduct&barcode=${encodeURIComponent(barcode)}&${embedded ? "embedded" : ""}`,
          true,
        );

        if (physical) reload();
        else {
          initial = initialStockOptions<Options>(logical.search, parameters);
          serverEmbedded = nativeQueryParameterPresent(logical.search, "embedded");
          setRevision((previous) => previous + 1);
        }
      },
      finishFlow: () => {
        // Each native RemoveUriParam reads the URI left by the previous call.
        for (const key of ["flow", "barcode", "product-name"]) {
          const location = current();
          const search = new URLSearchParams(location.search);
          search.delete(key);
          replace(decodeURIComponent(`${location.pathname}?${search}`));
        }
      },
    };
  });

  return { ...document, revision };
}
