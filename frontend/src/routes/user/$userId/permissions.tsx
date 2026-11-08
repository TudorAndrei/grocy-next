import { createFileRoute } from "@tanstack/react-router";
import { UserPermissions } from "@/components/UserPermissions";

export const Route = createFileRoute("/user/$userId/permissions")({ component: Page });

function Page() {
  const { userId } = Route.useParams();

  return <UserPermissions key={userId} userId={userId} />;
}
