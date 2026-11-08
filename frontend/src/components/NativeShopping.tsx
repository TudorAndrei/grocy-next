import { useLocation, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useNativeDocumentReload } from "@/lib/native-document";
import { getNativeShoppingContext } from "@/lib/native-shopping";
import { useI18n } from "@/lib/i18n";
import { ShoppingPage } from "./ShoppingPage";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";

export function NativeShopping() {
  const router = useRouter();
  const { t } = useI18n();
  const raw = useLocation({ select: () => router.history.location.search });
  const reloadDocument = useNativeDocumentReload("/shoppinglist");

  const context = useQuery({
    queryKey: ["shopping", "native-context", raw, 0],
    queryFn: ({ signal }) => getNativeShoppingContext(raw, signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  const select = (id?: number) => {
    const path = router
      .buildLocation({ to: "/shoppinglist", search: {} })
      .publicHref.replace(/\/$/, "");

    const search = id === undefined ? "" : `?list=${id}`;

    reloadDocument();

    if (router.history.location.search !== search || router.history.location.hash)
      void router.navigate({ href: path + search });
  };

  if (context.isSuccess)
    return (
      <ShoppingPage
        key={raw}
        nativePage
        nativeContext={context.data}
        nativeSearch={raw}
        onNativeReload={reloadDocument}
        selectedListId={context.data.list?.id ?? context.data.lists[0]?.id ?? 1}
        onListChange={select}
        onListReset={() => select()}
      />
    );

  return (
    <>
      <PageHeader title={t("Shopping list")} />
      {context.error ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button type="button" className="btn" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : (
        <LoadingBlock />
      )}
    </>
  );
}
