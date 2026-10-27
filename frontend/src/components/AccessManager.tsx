import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import { ErrorBlock } from "./ErrorBlock";

type User = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
};

type Key = {
  id: number;
  user_id: number;
  description: string | null;
  expires: string | null;
};

const permissionNames = [
  "Administrator",
  "Users",
  "Create users",
  "Edit users",
  "Read users",
  "Edit own profile",
  "Stock",
  "Shopping list",
  "Recipes",
  "Chores",
  "Batteries",
  "Tasks",
  "Equipment",
  "Calendar",
  "Purchase stock",
  "Consume stock",
  "Count stock",
  "Transfer stock",
  "Open stock",
  "Edit stock",
  "Add shopping items",
  "Delete shopping items",
  "Meal plan",
  "Record chore",
  "Undo chore",
  "Record battery charge",
  "Undo battery charge",
  "Undo task",
  "Complete task",
  "Edit master data",
];

export function AccessManager() {
  const client = useQueryClient();
  const [selected, setSelected] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [draft, setDraft] = useState<number[] | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [description, setDescription] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => request<User[]>("/api/users"),
  });

  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => request<Key[]>("/api/v2/api-keys"),
  });

  const permissions = useQuery({
    queryKey: ["permissions", selected],
    queryFn: () => request<{ permission_id: number }[]>(`/api/users/${selected}/permissions`),
    enabled: selected > 0,
  });

  const mutate = useMutation({
    mutationFn: async (fn: () => Promise<void>) => {
      await fn();
    },
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });

  const ids = draft ?? permissions.data?.map((p) => p.permission_id) ?? [];

  const choose = (id: number) => {
    setSelected(id);
    setDraft(null);
    setPassword("");
    setKeyValue("");
    mutate.reset();
    const user = users.data?.find((u) => u.id === id);
    setUsername(user?.username ?? "");
    setFirstName(user?.first_name ?? "");
    setLastName(user?.last_name ?? "");
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    mutate.mutate(() =>
      request(selected ? `/api/users/${selected}` : "/api/users", {
        method: selected ? "PUT" : "POST",
        body: JSON.stringify({
          username,
          first_name: firstName,
          last_name: lastName,
          password,
        }),
      }),
    );
  };

  const error = users.error || keys.error || permissions.error || mutate.error;

  return (
    <div className="stack">
      <section>
        <h2>Users</h2>
        {error && <ErrorBlock message={error.message} />}
        <div className="field">
          <label htmlFor="access-user">User</label>
          <select
            id="access-user"
            value={selected}
            onChange={(e) => choose(Number(e.target.value))}
          >
            <option value="0">Create a user</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </div>
        <form onSubmit={save} className="panel panel-inner">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="user-name">Username</label>
              <input
                id="user-name"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="user-first">First name</label>
              <input
                id="user-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="user-last">Last name</label>
              <input
                id="user-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="user-password">Password</label>
              <input
                id="user-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary" disabled={mutate.isPending}>
              {selected ? "Save user" : "Create user"}
            </button>
            {selected > 0 && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={mutate.isPending}
                onClick={() =>
                  deleteId === selected
                    ? mutate.mutate(async () => {
                        await request(`/api/users/${selected}`, {
                          method: "DELETE",
                        });
                        choose(0);
                      })
                    : setDeleteId(selected)
                }
              >
                {deleteId === selected ? "Confirm delete user" : "Delete user"}
              </button>
            )}
          </div>
        </form>
      </section>
      {selected > 0 && (
        <>
          <section>
            <h2>Permissions</h2>
            <div className="permission-grid">
              {permissionNames.map((label, i) => (
                <label key={label}>
                  <input
                    type="checkbox"
                    checked={ids.includes(i + 1)}
                    onChange={(e) =>
                      setDraft(
                        e.target.checked ? [...ids, i + 1] : ids.filter((id) => id !== i + 1),
                      )
                    }
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
            <button
              className="btn btn-primary"
              disabled={mutate.isPending || permissions.isPending}
              onClick={() =>
                mutate.mutate(async () => {
                  await request(`/api/users/${selected}/permissions`, {
                    method: "PUT",
                    body: JSON.stringify({ permissions: ids }),
                  });
                  setDraft(null);
                })
              }
            >
              Save permissions
            </button>
          </section>
          <section>
            <h2>API keys</h2>
            <div className="field">
              <label htmlFor="key-description">Key description</label>
              <input
                id="key-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              disabled={mutate.isPending}
              onClick={() =>
                mutate.mutate(async () => {
                  const result = await api.action<{ api_key: string }>("/api/v2/api-keys", {
                    user_id: selected,
                    description,
                  });

                  setKeyValue(result.api_key);
                })
              }
            >
              Create API key
            </button>
            {keyValue && (
              <div className="field">
                <label htmlFor="created-key">New API key. Save this value now.</label>
                <input
                  id="created-key"
                  readOnly
                  value={keyValue}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
            <ul className="product-list">
              {keys.data
                ?.filter((k) => k.user_id === selected)
                .map((k) => (
                  <li className="product-row" key={k.id}>
                    <span>
                      {k.description || `Key #${k.id}`}
                      {k.expires ? `, expires ${k.expires}` : ""}
                    </span>
                    <button
                      className="btn btn-ghost"
                      disabled={mutate.isPending}
                      onClick={() =>
                        mutate.mutate(() =>
                          request(`/api/v2/api-keys/${k.id}`, {
                            method: "DELETE",
                          }),
                        )
                      }
                    >
                      Revoke
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
