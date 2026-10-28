import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { downloadApiDocument } from "@/lib/open-document";
import { printLabel } from "@/lib/printing";
import { Icon } from "./Icon";
import { useNotify } from "./Toaster";

export function GrocycodeActions({
  id,
  kind,
  name,
  compact = false,
}: {
  id: number;
  kind: "product" | "recipe" | "chore" | "battery" | "stock-entry";
  name: string;
  compact?: boolean;
}) {
  const targets = {
    product: {
      label: "Product",
      code: `/api/v2/products/${id}/grocycode`,
      print: `/api/stock/products/${id}/printlabel`,
    },
    recipe: {
      label: "Recipe",
      code: `/api/v2/recipes/${id}/grocycode`,
      print: `/api/recipes/${id}/printlabel`,
    },
    chore: {
      label: "Chore",
      code: `/api/v2/chores/${id}/grocycode`,
      print: `/api/chores/${id}/printlabel`,
    },
    battery: {
      label: "Battery",
      code: `/api/v2/batteries/${id}/grocycode`,
      print: `/api/batteries/${id}/printlabel`,
    },
    "stock-entry": {
      label: "Stock entry",
      code: `/api/v2/stock/entries/${id}/grocycode`,
      print: `/api/stock/entry/${id}/printlabel`,
    },
  };

  const target = targets[kind];
  const { t } = useI18n();
  const features = useFeatures();
  const notify = useNotify();
  const prefix = useId();
  const popover = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const error = (failure: Error) => notify({ message: t(failure.message), tone: "error" });

  const download = useMutation({
    mutationFn: () => downloadApiDocument(`${target.code}?download=true`, "Grocycode.png"),
    onSuccess: () => popover.current?.hidePopover(),
    onError: error,
  });

  const label = useMutation({
    mutationFn: () => printLabel(target.print, features.query.data ?? {}),
    onSuccess: () => {
      popover.current?.hidePopover();
      notify({ message: t("Label request sent") });
    },
    onError: error,
  });

  return (
    <div className="grocycode-control">
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
        className="grocycode-popover"
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
          {t("Download %s Grocycode", t(target.label))}
        </button>
        {features.enabled("LABEL_PRINTER") ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={download.isPending || label.isPending}
            onClick={() => label.mutate()}
          >
            {t("Print %s Grocycode on label printer", t(target.label))}
          </button>
        ) : null}
      </div>
    </div>
  );
}
