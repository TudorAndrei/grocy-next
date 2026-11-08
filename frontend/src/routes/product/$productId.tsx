import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { ProductEditor } from "@/components/ProductEditor";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";
import { getNativeProductContext, nativeProductRouteArgument } from "@/lib/native-product-context";
import { useNativeDocumentReload, useNativePresentation } from "@/lib/native-document";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/product/$productId")({
  validateSearch: z
    .object({
      flow: z.coerce.string().optional().catch(undefined),
      name: z.coerce.string().optional().catch(undefined),
      barcode: z.coerce.string().optional().catch(undefined),
      returnto: z.string().optional().catch(undefined),
      "copy-of": z.union([z.string(), z.number()]).optional().catch(undefined),
    })
    .passthrough(),
  component: ProductFormPage,
});

function ProductFormPage() {
  const { t } = useI18n();
  const { productId } = Route.useParams();
  const router = useRouter();
  const pathname = useLocation({ select: () => router.history.location.pathname });
  const [initialSearch] = useState(router.history.location.search);
  const flow = nativeQueryParameter(initialSearch, "flow");
  const returnTo = nativeQueryParameter(initialSearch, "returnto");
  const copyOf = nativeQueryParameter(initialSearch, "copy-of");
  const presentation = useNativePresentation();
  const source = presentation?.kind === "product-form" ? presentation.value : undefined;
  let row: string | undefined;
  let pathError: Error | undefined;

  try {
    row = nativeProductRouteArgument(pathname);
  } catch (error) {
    pathError = error instanceof Error ? error : new Error("Object not found");
  }

  const context = useQuery({
    queryKey: ["native-product-editor", row],
    queryFn: ({ signal }) => getNativeProductContext(row!, signal),
    enabled: row !== undefined && !source,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [snapshot, setSnapshot] = useState(source);

  if (!snapshot && context.isSuccess && context.isFetchedAfterMount && !context.isFetching)
    setSnapshot(context.data);
  const navigate = Route.useNavigate();

  const nativeHref = (relative: string) => {
    const base = new URL(
      router.buildLocation({ to: "/", search: {} }).publicHref,
      window.location.href,
    ).href.replace(/\/$/, "");

    const target = new URL(base + relative);

    return target.origin === window.location.origin
      ? target.pathname + target.search + target.hash
      : target.href;
  };

  const reloadDocument = useNativeDocumentReload(/^\/product\/[^/]+$/);
  const recordId = snapshot?.mode === "edit" ? snapshot.product!.id : null;

  if (pathError || context.error)
    return <ErrorBlock message={(pathError ?? context.error)!.message} />;

  if (!snapshot) return <LoadingBlock />;

  return (
    <>
      <PageHeader title={t(recordId === null ? "Create product" : "Edit product")} />
      <ProductEditor
        nativeSelected
        nativeProductContext={snapshot}
        key={row}
        editor={{
          recordId,
          nativeCopyOf: recordId === null && copyOf !== undefined ? String(copyOf) : undefined,
          nativeInitialSearch: initialSearch,
          continueLabel: "Save & continue",
          allowReturn: flow === undefined && returnTo === undefined,
          initialValues:
            flow === "InplaceNewProductWithName"
              ? { name: String(nativeQueryParameter(initialSearch, "name") ?? "") }
              : undefined,
          onCancel: () => {
            const target = nativeQueryParameter(router.history.location.search, "returnto");

            try {
              void navigate({
                href: nativeHref(
                  target !== undefined && target !== true && target.length > 0
                    ? target
                    : "/products",
                ),
              });
            } catch (error) {
              console.error(error);
            }
          },
          onRefresh: async () => {
            reloadDocument();
          },
          onSaved: async (id, body, returnToList) => {
            const currentSearch = router.history.location.search;

            if (nativeQueryParameter(currentSearch, "closeAfterCreation") !== undefined) {
              window.close();

              return;
            }

            const target = nativeQueryParameter(currentSearch, "returnto");

            if (target !== undefined) {
              const suffix =
                nativeQueryParameter(currentSearch, "flow") !== undefined
                  ? `&product-name=${encodeURIComponent(String(body.name ?? ""))}`
                  : "";

              await navigate({ href: nativeHref(String(target) + suffix) });
            } else if (returnToList) await navigate({ href: `/products?product=${id}` });
            else {
              if (String(id) === productId) reloadDocument();
              await navigate({
                to: "/product/$productId",
                params: { productId: String(id) },
                search: {},
              });
            }
          },
        }}
      />
    </>
  );
}
