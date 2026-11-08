import { useId, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDocumentTasks } from "@/lib/document-tasks";
import { taskFormContextQuery } from "@/lib/task-form";
import { useI18n } from "@/lib/i18n";
import { HouseholdObjectEditor } from "./HouseholdObjectEditor";
import { NativeMainDateInput } from "./NativeMainDateInput";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserPicker } from "./UserPicker";

export function TaskEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: (id: number, another: boolean) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const nativeDocument = useDocumentTasks();
  const id = useId();
  const category = useRef<HTMLSelectElement>(null);
  const context = useQuery(taskFormContextQuery);

  if (context.isError)
    return (
      <>
        <ErrorBlock message={context.error.message} />
        <button
          type="button"
          className="btn"
          onClick={() => {
            void context.refetch();
          }}
        >
          {t("Retry")}
        </button>
      </>
    );

  if (!context.isSuccess) return <LoadingBlock />;
  const data = context.data;

  return (
    <HouseholdObjectEditor
      entity="tasks"
      nativeDocument={nativeDocument}
      recordId={recordId}
      title={recordId === null ? "Create task" : "Edit task"}
      addAnother={recordId === null}
      onSaved={onSaved}
      defaults={(row) => ({
        name: String(row?.name ?? ""),
        description: String(row?.description ?? ""),
        due_date: String(row?.due_date ?? "").slice(0, 10),
        category_id:
          row && data.categories.some((category) => category.id === Number(row.category_id))
            ? String(row.category_id)
            : "",
        assigned_to_user_id: row
          ? data.users.some((user) => user.id === Number(row.assigned_to_user_id))
            ? String(row.assigned_to_user_id)
            : ""
          : String(data.current_user_id),
      })}
      fields={(values, change, initialRecord) => (
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
          <label className="field">
            {t("Description")}
            <textarea
              name="description"
              rows={4}
              value={values.description}
              onChange={(event) => change("description", event.target.value)}
            />
          </label>
          <div className="field">
            <NativeMainDateInput
              id={`${id}-due`}
              caption={t("Due")}
              datetime={false}
              required={false}
              value={values.due_date}
              name="due_date"
              initialValue={String(initialRecord?.due_date ?? "")}
              onChange={(value) => change("due_date", value)}
              nextInputSelector="category_id"
            />
          </div>
          <label className="field">
            {t("Category")}
            <select
              id={`${id}-category`}
              ref={category}
              name="category_id"
              value={values.category_id}
              onChange={(event) => change("category_id", event.target.value)}
            >
              <option value="" />
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <UserPicker
            label={t("Assigned to")}
            users={data.users}
            value={values.assigned_to_user_id}
            onChange={(id) => change("assigned_to_user_id", id)}
          />
        </>
      )}
    />
  );
}
