import { createFileRoute, useRouter } from "@tanstack/react-router";
import { MealPlanSectionEditor } from "@/components/MealPlanSectionEditor";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/mealplansection/$sectionId")({ component: Page });

function Page() {
  const { sectionId } = Route.useParams();
  const navigate = Route.useNavigate();
  const router = useRouter();

  return (
    <MealPlanSectionEditor
      key={sectionId}
      recordId={sectionId === "new" ? null : Number(sectionId)}
      onSaved={async (signal) => {
        if (signal.aborted) return;

        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ to: "/mealplansections", search: {} });
      }}
    />
  );
}
