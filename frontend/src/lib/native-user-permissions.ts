import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";

const permission = z.object({
  id: z.number(),
  user_id: z.number(),
  permission_id: z.number(),
  permission_name: z.string(),
  has_permission: z.number(),
  parent: z.number().nullable(),
});

const context = z.object({
  user: z.object({
    id: z.number(),
    username: z.string().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  }),
  permissions: z.array(permission),
  current_user_id: z.number(),
});

export type UserPermissionContext = z.infer<typeof context>;

export type UserPermissionRow = z.infer<typeof permission>;

export type UserPermissionSelection = { checked: boolean; disabled: boolean };

export function userPermissionSelections(rows: UserPermissionRow[]) {
  return Object.fromEntries(
    rows.map((row) => [
      row.permission_id,
      {
        checked: Boolean(row.has_permission),
        disabled: Boolean(
          rows.find((parent) => parent.permission_id === row.parent)?.has_permission,
        ),
      },
    ]),
  );
}

export function setUserPermission(
  selections: Record<number, UserPermissionSelection>,
  rows: UserPermissionRow[],
  id: number,
  checked: boolean,
) {
  const updated = { ...selections, [id]: { checked, disabled: false } };

  const descendants = (parent: number) => {
    for (const row of rows.filter((candidate) => candidate.parent === parent)) {
      updated[row.permission_id] = { checked, disabled: checked };
      descendants(row.permission_id);
    }
  };

  descendants(id);

  return updated;
}

export async function getUserPermissionsContext(userId: string, signal?: AbortSignal) {
  return context.parse(
    await request(`/api/v2/users/${encodeURIComponent(userId)}/permissions-context`, { signal }),
  );
}

export function invalidateUserPermissions(client: QueryClient, userId: string) {
  for (const key of [["user-permissions"], ["permissions"], ["user-permissions-editor", userId]])
    void client.invalidateQueries({ queryKey: key, refetchType: "none" });
}
