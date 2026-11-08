import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { AboutPage } from "@/components/AboutPage";

export const Route = createFileRoute("/about")({ component: Page });

function Page() {
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });

  return <AboutPage key={search} search={search} />;
}
