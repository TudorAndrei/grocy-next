import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { NativeStockEntryEditor } from "@/components/StockEntryEditor";
import { useI18n } from "@/lib/i18n";
import { ErrorBlock } from "@/components/ErrorBlock";

export const Route = createFileRoute("/stockentry/$entryId")({ component: EntryPage });

function EntryPage() {
  const { t } = useI18n();
  const { entryId } = Route.useParams();
  const router = useRouter();
  const pathname = useLocation({ select: () => router.history.location.pathname });
  const segment = /\/stockentry\/([^/]+)\/?$/.exec(pathname)?.[1] ?? entryId;

  // Slim decodes the path before matching, then decodes the matched argument.
  // URLSearchParams preserves malformed percent escapes like PHP rawurldecode.
  const decode = (value: string) =>
    new URLSearchParams("row=" + value.replaceAll("+", "%2B").replaceAll("&", "%26")).get("row") ??
    "";

  const matched = decode(segment);
  const selected = decode(matched);

  return (
    <>
      <PageHeader title={t("Edit stock entry")} />
      {matched.includes("/") ? (
        <ErrorBlock message={t("Object not found")} />
      ) : (
        <NativeStockEntryEditor key={selected} entryId={selected} />
      )}
    </>
  );
}
