import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { HouseholdObjectEditor } from "./HouseholdObjectEditor";

type StockReferenceEntity = "locations" | "product_groups" | "shopping_locations";

const titles = {
  locations: { create: "Create location", edit: "Edit location" },
  product_groups: { create: "Create product group", edit: "Edit product group" },
  shopping_locations: { create: "Create store", edit: "Edit store" },
};

export function StockReferenceEditor({
  entity,
  recordId,
  onSaved,
}: {
  entity: StockReferenceEntity;
  recordId: number | null;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const nativeDocument = useDocumentTasks();
  const features = useFeatures();
  const freezing = features.enabled("STOCK_PRODUCT_FREEZING");

  return (
    <HouseholdObjectEditor
      entity={entity}
      recordId={recordId}
      nativeDocument={nativeDocument}
      title={titles[entity][recordId === null ? "create" : "edit"]}
      onSaved={onSaved}
      defaults={(record) => {
        const values = {
          name: String(record?.name ?? ""),
          active: record === null || Number(record.active) === 1 ? "1" : "0",
          description: String(record?.description ?? ""),
        };

        if (entity === "locations")
          return {
            ...values,
            is_freezer: freezing && Number(record?.is_freezer) === 1 ? "1" : "0",
          };

        return values;
      }}
      fields={(values, change) => (
        <>
          <label className="field">
            {t("Name")}
            <input
              name="name"
              required
              autoFocus
              value={values.name}
              onChange={(event) => change("name", event.target.value)}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              name="active"
              checked={values.active === "1"}
              onChange={(event) => change("active", event.target.checked ? "1" : "0")}
            />
            {t("Active")}
          </label>
          <label className="field">
            {t("Description")}
            <textarea
              name="description"
              rows={2}
              value={values.description}
              onChange={(event) => change("description", event.target.value)}
            />
          </label>
          {entity === "locations" ? (
            freezing ? (
              <>
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="is_freezer"
                    checked={values.is_freezer === "1"}
                    onChange={(event) => change("is_freezer", event.target.checked ? "1" : "0")}
                  />
                  {t("Is freezer")}
                </label>
                <p className="field-hint">
                  {t(
                    "When moving products from/to a freezer location, the products due date is automatically adjusted according to the product settings",
                  )}
                </p>
              </>
            ) : (
              <input type="hidden" name="is_freezer" value="0" />
            )
          ) : null}
        </>
      )}
    />
  );
}
