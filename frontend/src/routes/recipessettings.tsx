import { createFileRoute } from "@tanstack/react-router";
import { RecipeSettings } from "@/components/RecipeSettings";

export const Route = createFileRoute("/recipessettings")({ component: RecipeSettings });
