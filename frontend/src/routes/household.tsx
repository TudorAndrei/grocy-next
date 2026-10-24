import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/household")({
  beforeLoad: () => {
    throw redirect({ to: "/chores" });
  },
});
