import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";

export function RichDescription({
  entity,
  objectId,
}: {
  entity: "products" | "recipes" | "equipment";
  objectId: number;
}) {
  const { t } = useI18n();

  const content = useQuery({
    queryKey: queryKeys.content(entity, objectId),
    queryFn: () => api.getContent(entity, objectId),
    enabled: Number.isFinite(objectId),
  });

  if (content.isPending) return <LoadingBlock label={t("Loading…")} />;

  if (content.error) return <ErrorBlock message={content.error.message} />;

  return <RichText html={content.data.html} />;
}

export function RichText({ html }: { html: string }) {
  // The content and recipe-view endpoints prepare this HTML for display in Python.
  return <div className="rich-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
