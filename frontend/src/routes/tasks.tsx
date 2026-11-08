import { useNativeDocumentReload } from "@/lib/native-document";
import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { TasksPage } from "@/components/TasksPage";
import { tasksSearchSchema } from "@/lib/tasks-page";

export const Route = createFileRoute("/tasks")({
  validateSearch: tasksSearchSchema,
  component: TaskOverviewRoute,
});

function TaskOverviewRoute() {
  const router = useRouter();
  const reloadDocument = useNativeDocumentReload("/tasks");
  // Router search serialization equates a bare flag and an empty value; native GetUriParam does not.
  const search = useLocation({ select: () => router.history.location.search });

  return (
    <TasksPage
      key={search}
      search={search}
      onShowDone={(checked) => {
        reloadDocument();
        const target = router.buildLocation({ to: "/tasks", search: {} }).publicHref;
        router.history.push(target + (checked ? "?include_done" : ""));
      }}
    />
  );
}
