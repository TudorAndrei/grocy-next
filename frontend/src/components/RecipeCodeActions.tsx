import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { downloadApiDocument } from "@/lib/open-document";
import { printLabel } from "@/lib/printing";
import { Icon } from "./Icon";
import { useNotify } from "./Toaster";

export function RecipeCodeActions({
  id,
  name,
  compact = false,
}: {
  id: number;
  name: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const notify = useNotify();
  const prefix = useId();
  const popover = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const error = (failure: Error) => notify({ message: t(failure.message), tone: "error" });

  const download = useMutation({
    mutationFn: () =>
      downloadApiDocument(`/api/v2/recipes/${id}/grocycode?download=true`, "Grocycode.png"),
    onSuccess: () => popover.current?.hidePopover(),
    onError: error,
  });

  const label = useMutation({
    mutationFn: () => printLabel(`/api/recipes/${id}/printlabel`, features.query.data ?? {}),
    onSuccess: () => {
      popover.current?.hidePopover();
      notify({ message: t("Label request sent") });
    },
    onError: error,
  });

  return (
    <div className="recipe-code-control">
      <button
        type="button"
        className={compact ? "btn btn-ghost btn-sm" : "btn btn-ghost"}
        popoverTarget={prefix}
        aria-controls={prefix}
        aria-expanded={expanded}
        aria-label={compact ? t("%s Grocycode", name) : undefined}
        title={compact ? t("Grocycode") : undefined}
      >
        {compact ? <Icon name="barcode" /> : t("Grocycode")}
      </button>
      <div
        id={prefix}
        ref={popover}
        popover="auto"
        className="recipe-code-popover"
        data-expanded={expanded || undefined}
        role="group"
        aria-label={t("Grocycode")}
        onToggle={(event) => {
          const open = event.newState === "open";
          setExpanded(open);

          if (open) first.current?.focus();
        }}
      >
        <button
          ref={first}
          type="button"
          className="btn btn-ghost"
          disabled={download.isPending || label.isPending}
          onClick={() => download.mutate()}
        >
          {t("Download %s Grocycode", t("Recipe"))}
        </button>
        {features.enabled("LABEL_PRINTER") ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={download.isPending || label.isPending}
            onClick={() => label.mutate()}
          >
            {t("Print %s Grocycode on label printer", t("Recipe"))}
          </button>
        ) : null}
      </div>
    </div>
  );
}
