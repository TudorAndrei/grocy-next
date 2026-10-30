import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { InventoryForm } from "@/components/InventoryForm";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/lib/i18n";
import { inventorySearch } from "@/lib/inventory";

export const Route = createFileRoute("/inventory")({
  validateSearch: inventorySearch,
  component: InventoryPage,
});

function InventoryPage() {
  const { t } = useI18n();
  const options = Route.useSearch();
  const navigate = Route.useNavigate();

  const close = () =>
    window.parent.postMessage({ Message: "CloseLastModal", Payload: null }, window.location.origin);

  useEffect(() => {
    if (options.embedded === undefined) return;

    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        window.parent.postMessage(
          { Message: "CloseLastModal", Payload: null },
          window.location.origin,
        );
    };

    window.addEventListener("keydown", escape);

    return () => window.removeEventListener("keydown", escape);
  }, [options.embedded]);

  return (
    <>
      <PageHeader
        title={t("Inventory")}
        actions={
          options.embedded === undefined ? undefined : (
            <button type="button" className="btn btn-ghost" onClick={close}>
              {t("Close")}
            </button>
          )
        }
      />
      <InventoryForm
        options={options}
        onOptionsChange={(search) => void navigate({ search, replace: true })}
      />
    </>
  );
}
