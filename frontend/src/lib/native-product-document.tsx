import { createContext, useContext, useId, useState, type ReactNode } from "react";
import type { NativeProductContext } from "./native-product-context";

type NativeProductDocument = {
  scope: string;
  context: NativeProductContext;
};

const ProductDocument = createContext<NativeProductDocument | undefined>(undefined);

/** Native PHP metadata belongs to one document, independent of live shared reads. */
export function NativeProductDocumentProvider({
  context,
  children,
}: {
  context: NativeProductContext;
  children: ReactNode;
}) {
  const scope = useId();

  const [document] = useState(() => ({
    scope,
    context: { ...context, config: { ...context.config, LOCALE: context.locale } },
  }));

  return <ProductDocument.Provider value={document}>{children}</ProductDocument.Provider>;
}

export function useNativeProductDocument() {
  return useContext(ProductDocument);
}
