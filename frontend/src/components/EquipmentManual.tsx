import { useEffect, useState } from "react";
import { filePath } from "@/lib/api";
import { fetchApiDocument } from "@/lib/open-document";
import { useI18n } from "@/lib/i18n";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

type ManualResult = { name: string } & ({ url: string } | { error: string });

export function EquipmentManual({ name, label }: { name: string; label: string }) {
  const { t } = useI18n();
  const [result, setResult] = useState<ManualResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;

    void fetchApiDocument(filePath("equipmentmanuals", name), controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        // The legacy viewer displays PDFs. Do not interpret an uploaded HTML file here.
        objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setResult({ name, url: objectUrl });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ name, error: error.message });
      });

    return () => {
      controller.abort();

      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [name]);

  if (!result || result.name !== name) return <LoadingBlock label={t("Loading…")} />;

  if ("error" in result) return <ErrorBlock message={result.error} />;

  return (
    <object
      className="equipment-manual"
      data={result.url}
      type="application/pdf"
      aria-label={label}
    >
      <p>{t("Use Download manual to open this file.")}</p>
    </object>
  );
}
