import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { NativeShoppingItemEditor } from "@/components/NativeShoppingItemEditor";
import { shoppingItemSearchSchema } from "@/lib/shopping-list";
import { useNativeDocumentReload } from "@/lib/native-document";
import { useDocumentTasks } from "@/lib/document-tasks";

export const Route = createFileRoute("/shoppinglistitem/$itemId")({
  validateSearch: shoppingItemSearchSchema,
  component: ShoppingItemRoute,
});

function ShoppingItemRoute() {
  const { itemId } = Route.useParams();
  const currentSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [search] = useState(currentSearch);
  const documentTasks = useDocumentTasks();
  const reloadDocument = useNativeDocumentReload(/^\/shoppinglistitem\/[^/]+$/);
  const readSearch = () => router.history.location.search;

  const close = async (listId: string, embedded: boolean) => {
    if (embedded) {
      window.parent.postMessage(
        { Message: "ShoppingListChanged", Payload: listId },
        window.location.origin,
      );
      window.parent.postMessage(
        { Message: "CloseLastModal", Payload: null },
        window.location.origin,
      );
    } else
      await navigate({
        href: `${router.buildLocation({ to: "/shoppinglist", search: {} }).publicHref}?list=${listId}`,
      });
  };

  return (
    <NativeShoppingItemEditor
      key={itemId}
      recordId={itemId === "new" ? null : Number(itemId)}
      initialOptions={{
        product: search.product,
        productName: search["product-name"],
        amount: search.amount,
        list: search.list,
        merge: search.updateexistingproduct,
        flow: search.flow,
        barcode: search.flow === "InplaceAddBarcodeToExistingProduct" ? search.barcode : undefined,
      }}
      readSearch={readSearch}
      onSaved={close}
      onAssignBarcode={(barcode) => {
        const task = documentTasks.capture();

        const suffix =
          nativeQueryParameter(readSearch(), "embedded") !== undefined ? "embedded" : "";

        const href = `${router.history.location.pathname}?flow=InplaceAddBarcodeToExistingProduct&barcode=${encodeURIComponent(barcode)}&${suffix}`;

        void navigate({ href })
          .then(() => {
            if (!task.signal.aborted) reloadDocument();
          })
          .catch((error) => {
            if (!task.signal.aborted) console.error(error);
          });
      }}
    />
  );
}
