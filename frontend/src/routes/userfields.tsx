import { createFileRoute, useRouter, useLocation } from "@tanstack/react-router";
import { CustomDataLists } from "@/components/CustomDataLists";
import { z } from "zod";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/userfields")({
  validateSearch: z
    .object({
      entity: z.string().optional().catch(undefined),
      embedded: z.string().optional().catch(undefined),
    })
    .passthrough(),
  component: List,
});

function List() {
  const router = useRouter();
  const raw = useLocation({ select: () => router.history.location.search });

  return (
    <CustomDataLists
      key={raw}
      kind="fields"
      initialEntity={nativeQueryParameter(raw, "entity")}
      onDeleteNavigation={() => {
        router.history.push(router.buildLocation({ to: "/userfields", search: {} }).publicHref);
      }}
    />
  );
}
