import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { StockEntryEditor } from "@/components/StockEntryEditor";
import { useNotify } from "@/components/Toaster";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useInvalidateStock } from "@/lib/catalog";

export const Route = createFileRoute("/stockentry/$entryId")({ component: EntryPage });

function EntryPage() {
  const { t } = useI18n();
  const { entryId } = Route.useParams();
  const navigate = Route.useNavigate();
  const notify = useNotify();
  const invalidate = useInvalidateStock();
  const [version, setVersion] = useState(0);

  return (
    <>
      <PageHeader title={t("Edit stock entry")} />
      <StockEntryEditor
        key={version}
        entryId={Number(entryId)}
        revision={version}
        onCancel={() => {
          void navigate({ to: "/stockentries" });
        }}
        onSaved={(bookings) => {
          const booking = bookings[0];
          notify({
            message: t("Stock entry successfully updated"),
            undo: booking
              ? async () => {
                  await api.action(`/api/stock/bookings/${booking.id}/undo`);
                  await invalidate();
                  setVersion((value) => value + 1);
                }
              : undefined,
          });
          setVersion((value) => value + 1);
        }}
      />
    </>
  );
}
