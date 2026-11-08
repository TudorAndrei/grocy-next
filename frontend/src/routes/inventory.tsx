import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { InventoryForm } from "@/components/InventoryForm";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";
import { inventorySearch } from "@/lib/inventory";
import { initialInventoryOptions } from "@/lib/inventory-document";

export const Route = createFileRoute("/inventory")({
  validateSearch: inventorySearch,
  component: InventoryPage,
});

function InventoryPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [options] = useState(() => initialInventoryOptions(router.history.location.search));

  return (
    <>
      <PageHeader title={t("Inventory")} />
      <InventoryForm options={options} />
    </>
  );
}
