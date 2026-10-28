import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";
import {
  initialUserfields,
  saveUserfields,
  shoppingEditor,
  shoppingListsQuery,
  type FieldEdits,
  type shoppingEditorSchema,
} from "@/lib/shopping-list";
import type { z } from "zod";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldsEditor } from "./UserfieldsEditor";

export function ShoppingListActions({
  listId,
  name,
  onChanged,
}: {
  listId: number;
  name: string;
  onChanged: (id: number) => void;
}) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const menuId = useId();
  const [action, setAction] = useState<"create" | "edit" | "delete">();

  const open = (next: "create" | "edit" | "delete") => {
    menu.current?.hidePopover();
    trigger.current?.focus();
    setAction(next);
  };

  const client = useQueryClient();

  const changed = async (id: number) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: shoppingListsQuery.queryKey }),
      client.invalidateQueries({ queryKey: queryKeys.objects("shopping_lists") }),
      client.invalidateQueries({ queryKey: queryKeys.shopping(id) }),
    ]);
    setAction(undefined);
    onChanged(id);
  };

  return (
    <>
      <button
        type="button"
        className="btn"
        ref={trigger}
        popoverTarget={menuId}
        aria-controls={menuId}
        aria-expanded={expanded}
      >
        {t("List actions")}
      </button>
      <div
        id={menuId}
        ref={menu}
        popover="auto"
        className="grocycode-popover"
        onToggle={(event) => {
          const open = event.newState === "open";
          setExpanded(open);

          if (open) firstAction.current?.focus();
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          ref={firstAction}
          onClick={() => open("create")}
        >
          {t("New shopping list")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => open("edit")}>
          {t("Edit shopping list")}
        </button>
        <button
          type="button"
          className="btn btn-danger-quiet"
          disabled={listId === 1}
          onClick={() => open("delete")}
        >
          {t("Delete shopping list")}
        </button>
      </div>
      {action === "delete" ? (
        <DeleteList
          listId={listId}
          name={name}
          onClose={() => setAction(undefined)}
          onDeleted={() => changed(1)}
        />
      ) : null}
      {action === "create" || action === "edit" ? (
        <ListForm
          key={`${action}:${listId}`}
          listId={action === "edit" ? listId : undefined}
          onClose={() => setAction(undefined)}
          onSaved={changed}
        />
      ) : null}
    </>
  );
}

function DeleteList({
  listId,
  name,
  onClose,
  onDeleted,
}: {
  listId: number;
  name: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();

  const deletion = useMutation({
    mutationFn: () => api.deleteObject("shopping_lists", listId),
    onSuccess: onDeleted,
  });

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();

        if (!deletion.isPending) onClose();
      }}
    >
      <h2 id={title}>{t("Delete shopping list")}</h2>
      <p>{t('Are you sure you want to delete shopping list "%s"?', name)}</p>
      {deletion.isError ? <ErrorBlock message={deletion.error.message} /> : null}
      <div className="actions">
        <button type="button" className="btn" disabled={deletion.isPending} onClick={onClose}>
          {t("No")}
        </button>
        <button
          type="button"
          className="btn btn-danger-quiet"
          disabled={deletion.isPending}
          onClick={() => deletion.mutate()}
        >
          {t("Yes")}
        </button>
      </div>
    </dialog>
  );
}

function ListForm({
  listId,
  onClose,
  onSaved,
}: {
  listId?: number;
  onClose: () => void;
  onSaved: (id: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const [pending, setPending] = useState(false);

  const editor = useQuery({
    queryKey: ["shopping-list-editor", listId],
    queryFn: () => shoppingEditor(listId),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog shopping-list-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();

        if (!pending) onClose();
      }}
    >
      <h2 id={title}>{t(listId === undefined ? "Create shopping list" : "Edit shopping list")}</h2>
      {editor.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
      {editor.isError ? <ErrorBlock message={editor.error.message} /> : null}
      {editor.isSuccess ? (
        <ListFields data={editor.data} onSaved={onSaved} onClose={onClose} onPending={setPending} />
      ) : (
        <button type="button" className="btn" onClick={onClose}>
          {t("Cancel")}
        </button>
      )}
    </dialog>
  );
}

function ListFields({
  data,
  onSaved,
  onClose,
  onPending,
}: {
  data: z.infer<typeof shoppingEditorSchema>;
  onSaved: (id: number) => Promise<void>;
  onClose: () => void;
  onPending: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(data.list?.name ?? "");

  const [values, setValues] = useState<FieldEdits>(() =>
    initialUserfields(data.fields, data.values, !data.list),
  );

  const createdId = useRef<number>(undefined);

  const save = useMutation({
    mutationFn: async () => {
      onPending(true);
      let id = data.list?.id ?? createdId.current;
      const creating = id === undefined;

      if (id === undefined) {
        const result = await api.createObject("shopping_lists", { name });
        id = Number(result.created_object_id);
        createdId.current = id;
      }

      await saveUserfields("shopping_lists", id, data.fields, values, (field, edit) =>
        setValues((current) => ({ ...current, [field]: edit })),
      );

      if (!creating) await api.updateObject("shopping_lists", id, { name });

      return id;
    },
    onSuccess: onSaved,
    onSettled: () => onPending(false),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit}>
      <label className="field">
        {t("Name")}
        <input
          autoFocus
          required
          value={name}
          disabled={save.isPending}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <UserfieldsEditor
        fields={data.fields}
        values={values}
        creating={!data.list}
        disabled={save.isPending}
        onChange={(field, edit) => setValues((current) => ({ ...current, [field]: edit }))}
      />
      {save.isError ? <ErrorBlock message={save.error.message} /> : null}
      <div className="actions">
        <button type="button" className="btn" disabled={save.isPending} onClick={onClose}>
          {t("Cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t("Save")}
        </button>
      </div>
    </form>
  );
}
