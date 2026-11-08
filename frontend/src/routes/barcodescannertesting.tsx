import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { BarcodeScannerTesting } from "@/components/BarcodeScannerTesting";

export const Route = createFileRoute("/barcodescannertesting")({ component: Page });

function Page() {
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });

  return <BarcodeScannerTesting key={search} search={search} />;
}
