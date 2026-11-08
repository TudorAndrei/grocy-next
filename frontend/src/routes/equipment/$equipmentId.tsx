import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { EquipmentEditor } from "@/components/EquipmentEditor";

export const Route = createFileRoute("/equipment/$equipmentId")({
  validateSearch: z.object({ embedded: z.string().optional().catch(undefined) }).passthrough(),
  component: EquipmentFormRoute,
});

function EquipmentFormRoute() {
  const { equipmentId } = Route.useParams();
  const navigate = Route.useNavigate();

  return (
    <EquipmentEditor
      key={equipmentId}
      recordId={equipmentId === "new" ? null : Number(equipmentId)}
      onSaved={async () => {
        await navigate({ to: "/equipment", search: {} });
      }}
    />
  );
}
