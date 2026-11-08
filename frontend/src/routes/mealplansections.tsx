import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { MealPlanSections } from "@/components/MealPlanSections";

export const Route = createFileRoute("/mealplansections")({ component: Page });

function Page() {
  const router = useRouter();
  const raw = useLocation({ select: () => router.history.location.search });

  return <MealPlanSections key={raw} />;
}
