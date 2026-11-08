import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { BatteryEditor } from "@/components/BatteryEditor";

export const Route = createFileRoute("/battery/$batteryId")({
  validateSearch: z.object({ embedded: z.string().optional().catch(undefined) }).passthrough(),
  component: BatteryFormPage,
});

function BatteryFormPage() {
  const { batteryId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();

  return (
    <BatteryEditor
      key={batteryId}
      recordId={batteryId === "new" ? null : Number(batteryId)}
      onSaved={async () => {
        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ to: "/batteries", search: {} });
      }}
    />
  );
}
