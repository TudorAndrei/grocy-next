import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ChoreEditor } from "@/components/ChoreEditor";

export const Route = createFileRoute("/chore/$choreId")({
  validateSearch: z.object({ embedded: z.string().optional() }).passthrough(),
  component: ChorePage,
});

function ChorePage() {
  const { choreId } = Route.useParams();

  return <ChoreEditor key={choreId} choreId={choreId} />;
}
