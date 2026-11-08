import { createFileRoute } from "@tanstack/react-router";
import { ChoresOverview } from "@/components/ChoresOverview";
import { choresOverviewSearch } from "@/lib/chores-overview";

export const Route = createFileRoute("/choresoverview")({
  validateSearch: choresOverviewSearch,
  component: ChoresPage,
});

function ChoresPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ChoresOverview
      search={search}
      onChange={(search) => {
        void navigate({ search, replace: true });
      }}
    />
  );
}
