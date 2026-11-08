import { createFileRoute } from "@tanstack/react-router";
import { StockReferenceEditor } from "@/components/StockReferenceEditor";

export const Route = createFileRoute("/productgroup/$groupId")({ component: Page });

function Page() {
  const { groupId } = Route.useParams();

  return (
    <StockReferenceEditor
      key={groupId}
      entity="product_groups"
      recordId={groupId === "new" ? null : Number(groupId)}
      onSaved={() => {
        window.parent.postMessage(
          { Message: "CloseLastModal", Payload: null },
          window.location.origin,
        );
      }}
    />
  );
}
