import { createFileRoute, redirect } from "@tanstack/react-router";
import { shoppingSearchSchema } from "@/lib/shopping-list";

export const Route = createFileRoute("/shoppinglist")({
  validateSearch: shoppingSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/shopping", search, replace: true });
  },
});
