import { createFileRoute } from "@tanstack/react-router";
import { ShoppingItemForm } from "@/components/ShoppingItemForm";
import { shoppingSearchSchema } from "@/lib/shopping-list";

export const Route = createFileRoute("/shoppinglistitem/$itemId")({
  validateSearch: shoppingSearchSchema,
  component: ShoppingItemRoute,
});

function ShoppingItemRoute() {
  const { itemId } = Route.useParams();
  const { list } = Route.useSearch();
  const navigate = Route.useNavigate();

  const close = async (listId: number) => {
    await navigate({ to: "/shopping", search: { list: listId } });
  };

  return (
    <ShoppingItemForm
      itemId={itemId === "new" ? undefined : Number(itemId)}
      listId={list ?? 1}
      onClose={() => {
        void close(list ?? 1);
      }}
      onSaved={close}
    />
  );
}
