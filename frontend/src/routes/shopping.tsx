import { createFileRoute } from "@tanstack/react-router";
import { ShoppingPage } from "@/components/ShoppingPage";
import { shoppingSearchSchema } from "@/lib/shopping-list";

export const Route = createFileRoute("/shopping")({
  validateSearch: shoppingSearchSchema,
  component: ShoppingRoute,
});

function ShoppingRoute() {
  const { list } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ShoppingPage
      selectedListId={list ?? 1}
      onListChange={(id) => {
        void navigate({ search: { list: id } });
      }}
    />
  );
}
