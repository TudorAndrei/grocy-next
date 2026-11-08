import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { StockReferenceEditor } from "@/components/StockReferenceEditor";

export const Route = createFileRoute("/location/$locationId")({
  validateSearch: z.object({ embedded: z.string().optional().catch(undefined) }).passthrough(),
  component: Page,
});

function Page() {
  const { locationId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();

  return (
    <StockReferenceEditor
      key={locationId}
      entity="locations"
      recordId={locationId === "new" ? null : Number(locationId)}
      onSaved={async () => {
        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ href: "/locations" });
      }}
    />
  );
}
