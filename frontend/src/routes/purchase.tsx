import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PurchaseForm } from "@/components/PurchaseForm";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";
import { purchaseSearch } from "@/lib/purchase";
import { initialPurchaseOptions } from "@/lib/purchase-document";

export const Route = createFileRoute("/purchase")({
  validateSearch: purchaseSearch,
  component: PurchasePage,
});

function PurchasePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [options] = useState(() => initialPurchaseOptions(router.history.location.search));

  return (
    <>
      <PageHeader title={t("Purchase")} />
      <PurchaseForm options={options} />
    </>
  );
}
