import { useI18n } from "@/lib/i18n";

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useI18n();

  return (
    <p className="loading" role="status">
      {label ?? t("Loading…")}
    </p>
  );
}
