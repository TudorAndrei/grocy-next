import { createFileRoute } from "@tanstack/react-router";
import { CustomDataLists } from "@/components/CustomDataLists";

export const Route = createFileRoute("/userobjects/$entityName")({ component: List });

function List() {
  const { entityName } = Route.useParams();

  return (
    <CustomDataLists
      key={entityName}
      kind="objects"
      entityName={entityName}
      onDeleteNavigation={() => {}}
    />
  );
}
