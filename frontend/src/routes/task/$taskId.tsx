import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { TaskEditor } from "@/components/TaskEditor";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { useNativeDocumentReload } from "@/lib/native-document";

export const Route = createFileRoute("/task/$taskId")({
  validateSearch: z.object({ embedded: z.string().optional().catch(undefined) }).passthrough(),
  component: TaskFormPage,
});

function TaskFormPage() {
  const { taskId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [version, setVersion] = useState(0);
  const reloadDocument = useNativeDocumentReload(/^\/task\/[^/]+$/);

  return (
    <TaskEditor
      key={`${taskId}:${version}`}
      recordId={taskId === "new" ? null : Number(taskId)}
      onSaved={async (_id, another) => {
        const embedded =
          nativeQueryParameter(router.history.location.search, "embedded") !== undefined;

        if (another) {
          const replacing = taskId === "new" && reloadDocument();
          await navigate({
            to: "/task/$taskId",
            params: { taskId: "new" },
            search: embedded ? { embedded: "" } : {},
          });

          if (!replacing) setVersion((current) => current + 1);
        } else if (embedded)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ to: "/tasks", search: {} });
      }}
    />
  );
}
