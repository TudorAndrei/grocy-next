import { createFileRoute } from "@tanstack/react-router";
import { NativeMealPlan } from "@/components/NativeMealPlan";

export const Route = createFileRoute("/mealplan")({
  component: NativeMealPlan,
});
