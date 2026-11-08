import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { TransferForm } from "@/components/TransferForm";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";
import { transferSearch } from "@/lib/transfer";
import { initialTransferOptions } from "@/lib/transfer-document";

export const Route = createFileRoute("/transfer")({
  validateSearch: transferSearch,
  component: TransferPage,
});

function TransferPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [options] = useState(() => initialTransferOptions(router.history.location.search));

  return (
    <>
      <PageHeader title={t("Transfer")} />
      <TransferForm options={options} />
    </>
  );
}
