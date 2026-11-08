import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { TaskCategoryEditor } from "@/components/TaskCategoryEditor";

export const Route = createFileRoute("/taskcategory/$categoryId")({
  validateSearch: z.object({ embedded: z.string().optional().catch(undefined) }).passthrough(),
  component: CategoryFormPage,
});

function CategoryFormPage() {
  const { categoryId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();

  return (
    <TaskCategoryEditor
      key={categoryId}
      recordId={categoryId === "new" ? null : Number(categoryId)}
      onSaved={async () => {
        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ to: "/taskcategories", search: {} });
      }}
    />
  );
}
