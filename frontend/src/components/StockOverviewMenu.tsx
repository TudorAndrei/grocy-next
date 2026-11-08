import { useId, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions";
import { useInvalidateStock } from "@/lib/catalog";
import type { StockOverviewRow } from "@/lib/stock-overview";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useDialogState } from "@/hooks/useDialogState";
import { EntriesDialog } from "./StockEntries";
import { JournalDialog } from "./StockJournal";
import { StockJournalSummary } from "./StockJournalSummary";
import { ShoppingItemForm } from "./ShoppingItemForm";

export function StockOverviewMenu({
  row,
  onOverview,
}: {
  row: StockOverviewRow;
  onOverview: () => void;
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const can = usePermissions();
  const invalidate = useInvalidateStock();
  const returnto = useLocation({ select: (location) => location.href });
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const dialogs = useDialogState<"shopping" | "entries" | "journal" | "summary">();
  const dialog = dialogs.state?.value;
  const name = row.product_name ?? "";

  const close = () => {
    if (dialogs.state) dialogs.close(dialogs.state.id);
  };

  const open = (target: NonNullable<typeof dialog>) => {
    popover.current?.hidePopover();
    trigger.current?.focus();
    dialogs.open(target);
  };

  return (
    <>
      <div className="grocycode-control">
        <button
          ref={trigger}
          type="button"
          className="btn btn-sm"
          popoverTarget={id}
          aria-controls={id}
          aria-expanded={expanded}
          aria-label={t("More actions for %s", name)}
        >
          {t("More")}
        </button>
        <div
          id={id}
          ref={popover}
          popover="auto"
          className="grocycode-popover"
          role="group"
          aria-label={t("More actions for %s", name)}
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
            onClick={() => {
              popover.current?.hidePopover();
              trigger.current?.focus();
              onOverview();
            }}
          >
            {t("Product overview")}
          </button>
          {features.enabled("SHOPPINGLIST") ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!can("SHOPPINGLIST_ITEMS_ADD")}
              onClick={() => open("shopping")}
            >
              {t("Add to shopping list")}
            </button>
          ) : null}
          {features.enabled("RECIPES") ? (
            <Link to="/recipes" search={{ search: name }} className="btn btn-ghost">
              {t("Search for recipes containing this product")}
            </Link>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => open("entries")}>
            {t("Stock entries")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => open("journal")}>
            {t("Stock journal")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => open("summary")}>
            {t("Stock journal summary")}
          </button>
          {can("MASTER_DATA_EDIT") ? (
            <Link
              to="/product/$productId"
              params={{ productId: String(row.product_id) }}
              search={{ returnto }}
              className="btn btn-ghost"
            >
              {t("Edit product")}
            </Link>
          ) : null}
        </div>
      </div>
      {dialog === "shopping" ? (
        <ShoppingItemForm
          listId={1}
          options={{ product: row.product_id, merge: true }}
          onClose={close}
          onSaved={async () => {
            await invalidate();
            close();
          }}
        />
      ) : null}
      {dialog === "entries" ? (
        <EntriesDialog productId={row.product_id} name={name} onClose={close} />
      ) : null}
      {dialog === "journal" ? (
        <JournalDialog productId={row.product_id} name={name} onClose={close} />
      ) : null}
      {dialog === "summary" ? (
        <SummaryDialog productId={row.product_id} name={name} onClose={close} />
      ) : null}
    </>
  );
}

function SummaryDialog({
  productId,
  name,
  onClose,
}: {
  productId: number;
  name: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-journal-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={title}>{t("Stock journal summary")}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <p>{name}</p>
      <StockJournalSummary search={{ product_id: String(productId), embedded: "" }} />
    </dialog>
  );
}
