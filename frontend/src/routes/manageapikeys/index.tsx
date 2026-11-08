import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { NativeApiKeys } from "@/components/NativeApiKeys";

export const Route = createFileRoute("/manageapikeys/")({ component: Page });

function Page() {
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });

  return <NativeApiKeys key={search} search={search} />;
}
