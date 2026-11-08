import { createFileRoute } from "@tanstack/react-router";
import { ShoppingListEditor } from "@/components/ShoppingListEditor";
import { shoppingListFormSearch } from "@/lib/shopping-list-form";

export const Route = createFileRoute("/shoppinglist/$listId")({
  validateSearch: shoppingListFormSearch,
  component: Page,
});

function Page() {
  const { listId } = Route.useParams();

  return (
    <ShoppingListEditor
      key={listId}
      recordId={listId === "new" ? null : Number(listId)}
      onSaved={(id) => {
        window.parent.postMessage(
          { Message: "ShoppingListChanged", Payload: id },
          window.location.origin,
        );
        window.parent.postMessage({ Message: "Ready", Payload: null }, window.location.origin);
        window.parent.postMessage(
          { Message: "CloseLastModal", Payload: null },
          window.location.origin,
        );
      }}
    />
  );
}
