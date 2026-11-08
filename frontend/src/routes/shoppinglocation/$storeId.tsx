import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { StockReferenceEditor } from "@/components/StockReferenceEditor";

export const Route = createFileRoute("/shoppinglocation/$storeId")({
  validateSearch: z.object({ embedded: z.string().optional().catch(undefined) }).passthrough(),
  component: Page,
});

function Page() {
  const { storeId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();

  return (
    <StockReferenceEditor
      key={storeId}
      entity="shopping_locations"
      recordId={storeId === "new" ? null : Number(storeId)}
      onSaved={async () => {
        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ href: "/shoppinglocations" });
      }}
    />
  );
}
