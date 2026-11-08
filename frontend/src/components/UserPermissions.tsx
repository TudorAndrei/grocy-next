import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  getUserPermissionsContext,
  invalidateUserPermissions,
  setUserPermission,
  userPermissionSelections,
  type UserPermissionContext,
  type UserPermissionRow,
  type UserPermissionSelection,
} from "@/lib/native-user-permissions";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { PageHeader } from "./PageHeader";
import { useNotify } from "./Toaster";

export function UserPermissions({ userId }: { userId: string }) {
  const { t } = useI18n();

  const context = useQuery({
    queryKey: ["user-permissions-editor", userId],
    queryFn: ({ signal }) => getUserPermissionsContext(userId, signal),
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const [initial, setInitial] = useState<UserPermissionContext>();

  if (!initial && context.isSuccess && !context.isFetching) setInitial(context.data);

  if (initial) return <PermissionForm key={userId} context={initial} userId={userId} />;

  return (
    <>
      <PageHeader title={t("Permissions")} />
      {context.isError ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button type="button" className="btn" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : (
        <LoadingBlock />
      )}
    </>
  );
}

function PermissionForm({ context, userId }: { context: UserPermissionContext; userId: string }) {
  const { t } = useI18n();
  const notify = useNotify();
  const client = useQueryClient();
  const owner = useRef<AbortController>(undefined);
  const prefix = useId();
  const [selections, setSelections] = useState(() => userPermissionSelections(context.permissions));
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    owner.current = controller;

    return () => controller.abort();
  }, []);

  const change = (permission: UserPermissionRow, checked: boolean) => {
    setSelections((previous) =>
      setUserPermission(previous, context.permissions, permission.permission_id, checked),
    );

    if (
      permission.permission_name === "ADMIN" &&
      !checked &&
      context.user.id === context.current_user_id
    )
      setConfirm(true);
  };

  const save = async () => {
    const signal = owner.current?.signal;

    const permissions = context.permissions
      .filter((row) => {
        const selection = selections[row.permission_id];

        return selection?.checked && !selection.disabled;
      })
      .map((row) => row.permission_id);

    try {
      signal?.throwIfAborted();

      try {
        await request(`/api/users/${context.user.id}/permissions`, {
          method: "PUT",
          body: JSON.stringify({ permissions }),
          signal,
        });
      } finally {
        invalidateUserPermissions(client, userId);
      }

      if (!signal?.aborted) notify({ message: t("Permissions saved") });
    } catch (error) {
      if (!signal?.aborted)
        notify({ message: error instanceof Error ? error.message : String(error), tone: "error" });
    }
  };

  const named = (name: string | null) => name !== "0" && name;

  const display =
    [named(context.user.first_name), named(context.user.last_name)].filter(Boolean).join(" ") ||
    context.user.username ||
    "";

  return (
    <>
      <PageHeader title={t("Permissions for user %s", display)} />
      <PermissionBranches
        parent={null}
        rows={context.permissions}
        selections={selections}
        prefix={prefix}
        onChange={change}
      />
      <button type="button" className="btn btn-primary" onClick={() => void save()}>
        {t("Save")}
      </button>
      {confirm ? (
        <OwnPermissionConfirmation
          onClose={(restore) => {
            if (restore) {
              const admin = context.permissions.find((row) => row.permission_name === "ADMIN");

              if (admin)
                setSelections((previous) =>
                  setUserPermission(previous, context.permissions, admin.permission_id, true),
                );
            }

            setConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}

function PermissionBranches({
  parent,
  rows,
  selections,
  prefix,
  onChange,
}: {
  parent: number | null;
  rows: UserPermissionRow[];
  selections: Record<number, UserPermissionSelection>;
  prefix: string;
  onChange: (row: UserPermissionRow, checked: boolean) => void;
}) {
  const { t } = useI18n();
  const children = rows.filter((row) => row.parent === parent);

  if (!children.length) return null;

  return (
    <ul className="native-permissions">
      {children.map((row) => (
        <li key={row.permission_id}>
          <label htmlFor={`${prefix}-${row.permission_id}`}>
            <input
              type="checkbox"
              id={`${prefix}-${row.permission_id}`}
              name={row.permission_name}
              checked={selections[row.permission_id]?.checked ?? false}
              disabled={selections[row.permission_id]?.disabled ?? false}
              onChange={(event) => onChange(row, event.target.checked)}
            />
            {t(row.permission_name)}
          </label>
          <PermissionBranches
            parent={row.permission_id}
            rows={rows}
            selections={selections}
            prefix={prefix}
            onChange={onChange}
          />
        </li>
      ))}
    </ul>
  );
}

function OwnPermissionConfirmation({ onClose }: { onClose: (restore: boolean) => void }) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const message = t("Are you sure you want to remove full permissions for yourself?");

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={message}
      onCancel={(event) => {
        event.preventDefault();
        onClose(true);
      }}
    >
      <p>{message}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => onClose(false)}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={() => onClose(true)}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}
