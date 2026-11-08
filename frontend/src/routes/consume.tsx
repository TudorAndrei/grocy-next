import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ConsumeForm } from "@/components/ConsumeForm";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";
import { consumeSearch } from "@/lib/consume";
import { initialConsumeOptions } from "@/lib/consume-document";

export const Route = createFileRoute("/consume")({
  validateSearch: consumeSearch,
  component: ConsumePage,
});

function ConsumePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [options] = useState(() => initialConsumeOptions(router.history.location.search));

  return (
    <>
      <PageHeader title={t("Consume")} />
      <ConsumeForm options={options} />
    </>
  );
}
