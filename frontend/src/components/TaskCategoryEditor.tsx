import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import { HouseholdObjectEditor } from "./HouseholdObjectEditor";

export function TaskCategoryEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const nativeDocument = useDocumentTasks();

  return (
    <HouseholdObjectEditor
      entity="task_categories"
      recordId={recordId}
      nativeDocument={nativeDocument}
      title={recordId === null ? "Create task category" : "Edit task category"}
      onSaved={onSaved}
      defaults={(row) => ({
        name: String(row?.name ?? ""),
        active: row ? (Number(row.active) === 1 ? "1" : "0") : "1",
        description: String(row?.description ?? ""),
      })}
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
        </>
      )}
    />
  );
}
