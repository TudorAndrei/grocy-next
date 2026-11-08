import { createFileRoute, useRouter } from "@tanstack/react-router";
import { EquipmentPage } from "@/components/EquipmentPage";

export const Route = createFileRoute("/equipment/")({ component: EquipmentIndex });

function EquipmentIndex() {
  const router = useRouter();

  return (
    <EquipmentPage
      onDeleted={() =>
        router.history.push(router.buildLocation({ to: "/equipment", search: {} }).publicHref)
      }
    />
  );
}
