import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CustomDataLists } from "@/components/CustomDataLists";

export const Route = createFileRoute("/userentities")({ component: List });

function List() {
  const router = useRouter();

  return (
    <CustomDataLists
      kind="entities"
      onDeleteNavigation={() => {
        router.history.push(router.buildLocation({ to: "/userentities", search: {} }).publicHref);
      }}
    />
  );
}
