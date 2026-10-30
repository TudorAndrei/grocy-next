import { createFileRoute } from "@tanstack/react-router";
import { ShoppingItemForm } from "@/components/ShoppingItemForm";
import { shoppingItemSearchSchema } from "@/lib/shopping-list";

export const Route = createFileRoute("/shoppinglistitem/$itemId")({
  validateSearch: shoppingItemSearchSchema,
  component: ShoppingItemRoute,
});

function ShoppingItemRoute() {
  const { itemId } = Route.useParams();
  const search = Route.useSearch();
  const { list } = search;
  const navigate = Route.useNavigate();

  const close = async (listId: number) => {
    await navigate({ to: "/shopping", search: { list: listId } });
  };

  return (
    <ShoppingItemForm
      itemId={itemId === "new" ? undefined : Number(itemId)}
      listId={list ?? 1}
      options={{
        product: search.product,
        productName: search["product-name"],
        amount: search.amount,
        list,
        merge: search.updateexistingproduct,
        flow: search.flow,
        barcode: search.flow === "InplaceAddBarcodeToExistingProduct" ? search.barcode : undefined,
      }}
      onClose={() => {
        void close(list ?? 1);
      }}
      onSaved={close}
    />
  );
}
