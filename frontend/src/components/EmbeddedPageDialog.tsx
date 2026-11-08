import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useI18n } from "@/lib/i18n";
import { resizeResponsiveEmbeds } from "@/lib/responsive-embeds";

export type EmbeddedPage = { id: number; url: string; dialogType: string };

export function EmbeddedPageDialog({ page, onClose }: { page: EmbeddedPage; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const path = new URL(page.url).pathname;

  const labels = new Map([
    ["about", "About Grocy"],
    ["purchase", "Purchase"],
    ["consume", "Consume"],
    ["inventory", "Inventory"],
    ["transfer", "Transfer"],
    ["stockentries", "Stock entries"],
    ["stockentry", "Edit stock entry"],
    ["stockjournal", "Stock journal"],
    ["choresjournal", "Chores journal"],
    ["batteriesjournal", "Batteries journal"],
    ["product", "Product"],
    ["recipe", "Recipe"],
    ["recipes", "Recipe"],
    ["mealplansection", "Meal plan section"],
    ["battery", "Battery"],
    ["task", "Task"],
    ["taskcategory", "Task category"],
    ["location", "Location"],
    ["productgroup", "Product group"],
    ["shoppinglocation", "Store"],
    ["quantityunit", "Quantity unit"],
    ["quantityunitconversion", "Quantity unit conversion"],
    ["quantityunitpluraltesting", "Test plural forms"],
    ["quantityunitconversionsresolved", "Resolved quantity unit conversions"],
    ["productbarcodes", "Barcode"],
    ["shoppinglist", "Shopping list"],
    ["shoppinglistitem", "Shopping list item"],
    ["equipment", "Equipment"],
    ["userfield", "Userfield"],
    ["userentity", "Userentity"],
    ["userobject", "Userobject"],
  ]);

  const title = t(
    /\/stockentry\/[^/]+$/.test(path)
      ? "Edit stock entry"
      : /\/recipe\/[^/]+\/pos\/(new|\d+)$/.test(path)
        ? "Recipe ingredient"
        : /\/userobject\/[^/]+\/(new|\d+)$/.test(path)
          ? "Userobject"
          : path.endsWith("/stockjournal/summary")
            ? "Stock journal summary"
            : (labels.get(
                /\/(recipe|mealplansection|battery|task|taskcategory|stockentry|location|productgroup|shoppinglocation|quantityunit|quantityunitconversion|productbarcodes|userfield|userentity|shoppinglist|shoppinglistitem|equipment)\/(new|\d+)$/.exec(
                  path,
                )?.[1] ??
                  path.split("/").filter(Boolean).at(-1) ??
                  "",
              ) ?? "Details"),
  );

  useEffect(() => resizeResponsiveEmbeds(), []);

  return createPortal(
    <dialog
      ref={dialog}
      className={`recipe-action-dialog embedded-page-dialog ${page.dialogType}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2>{title}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <iframe className="embed-responsive embedded-page-frame" src={page.url} title={title} />
    </dialog>,
    document.body,
  );
}
