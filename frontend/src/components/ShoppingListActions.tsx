import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";
import { shoppingListsQuery } from "@/lib/shopping-list";
import { Link } from "@tanstack/react-router";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";

export function ShoppingListActions({
  listId,
  name,
  onDeleted,
  editHref,
}: {
  listId: number;
  name: string;
  onDeleted: () => void;
  editHref?: string;
}) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLAnchorElement>(null);
  const [expanded, setExpanded] = useState(false);
  const menuId = useId();
  const [deleting, setDeleting] = useState(false);
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const close = () => {
    setDeleting(false);
  };

  const open = () => {
    menu.current?.hidePopover();
    trigger.current?.focus();
    setDeleting(true);
  };

  const openEditor = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    menu.current?.hidePopover();
    trigger.current?.focus();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
  };

  const client = useQueryClient();

  const deletion = useMutation({
    mutationFn: (id: number) => api.deleteObject("shopping_lists", id),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: shoppingListsQuery.queryKey }),
        client.invalidateQueries({ queryKey: queryKeys.objects("shopping_lists") }),
        client.invalidateQueries({ queryKey: queryKeys.shopping(1) }),
      ]);

      if (alive.current) onDeleted();
    },
  });

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
        <Link
          to="/shoppinglist/$listId"
          params={{ listId: "new" }}
          search={{ embedded: "" }}
          className="btn btn-ghost"
          ref={firstAction}
          onClick={openEditor}
        >
          {t("New shopping list")}
        </Link>
        {editHref ? (
          <a className="btn btn-ghost" href={editHref} onClick={openEditor}>
            {t("Edit shopping list")}
          </a>
        ) : (
          <Link
            to="/shoppinglist/$listId"
            params={{ listId: String(listId) }}
            search={{ embedded: "" }}
            className="btn btn-ghost"
            onClick={openEditor}
          >
            {t("Edit shopping list")}
          </Link>
        )}
        <button
          type="button"
          className="btn btn-danger-quiet"
          disabled={listId === 1}
          onClick={open}
        >
          {t("Delete shopping list")}
        </button>
      </div>
      {deleting ? (
        <DeleteList
          name={name}
          onClose={close}
          onDelete={() => {
            deletion.mutate(listId);
            close();
          }}
        />
      ) : null}
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
    </>
  );
}

function DeleteList({
  name,
  onClose,
  onDelete,
}: {
  name: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();

        onClose();
      }}
    >
      <h2 id={title}>{t("Delete shopping list")}</h2>
      <p>{t('Are you sure you want to delete shopping list "%s"?', name)}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t("No")}
        </button>
        <button type="button" className="btn btn-danger-quiet" onClick={onDelete}>
          {t("Yes")}
        </button>
      </div>
    </dialog>
  );
}
