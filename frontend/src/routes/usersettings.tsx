import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { UserSettings } from "@/components/UserSettings";

export const Route = createFileRoute("/usersettings")({ component: Page });

function Page() {
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });

  return <UserSettings key={search} search={search} />;
}
