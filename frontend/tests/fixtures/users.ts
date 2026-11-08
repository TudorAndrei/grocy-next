import { onTestFinished, vi } from "vitest";
import type { CustomDataField } from "@/lib/custom-data-context";
import type { JsonObject } from "@/lib/json";
import type { UserFormContext, UsersOverview } from "@/lib/user-form";
import { mountNativeEditor } from "./native-editor";
import { pictureBytes } from "./picture";

export function deferredUserRequest() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

export const department: CustomDataField = {
  id: 1,
  entity: "users",
  name: "department",
  caption: "Department",
  type: "text-single-line",
  input_required: 0,
  default_value: null,
  config: null,
  sort_number: 1,
  show_as_column_in_tables: 1,
};

export function mountUsers(
  path = "/users",
  options: {
    external?: boolean;
    hiddenPassword?: boolean;
    deniedRead?: boolean;
    deniedForm?: boolean;
    failPrimary?: boolean;
    holdPrimary?: boolean;
    holdContext?: boolean;
    holdField?: string;
    failField?: string;
    holdPicture?: boolean;
    failPicture?: boolean;
    holdDelete?: boolean;
    fields?: CustomDataField[];
    values?: UsersOverview["values"];
    formValues?: UserFormContext["values"];
    settings?: Record<string, string>;
    importedId?: number;
    selectedUser?: Partial<NonNullable<UserFormContext["user"]>>;
  } = {},
) {
  const users: NonNullable<UserFormContext["user"]>[] = [
    {
      id: 7,
      username: "owner",
      first_name: "Household",
      last_name: "Owner",
      picture_file_name: null,
      row_created_timestamp: "2026-11-01 00:00:00",
      display_name: "Household Owner",
    },
    {
      id: 2,
      username: "alex",
      first_name: "Alex",
      last_name: "River",
      picture_file_name: "old.png",
      row_created_timestamp: "2026-11-02 00:00:00",
      display_name: "Alex River",
    },
    {
      id: 3,
      username: "zed",
      first_name: null,
      last_name: "Stone",
      picture_file_name: null,
      row_created_timestamp: "2026-11-03 00:00:00",
      display_name: "Stone",
    },
  ];

  if (options.selectedUser) Object.assign(users[1]!, options.selectedUser);

  if (options.importedId !== undefined)
    users.push({
      ...users[1]!,
      id: options.importedId,
      username: "imported",
      picture_file_name: null,
    });
  const fields = options.fields ?? [department];

  const values: UsersOverview["values"] = options.values ?? [
    { object_id: 7, name: "department", value: "Kitchen" },
    { object_id: "2.0", name: "department", value: "Garden" },
    { object_id: 3, name: "department", value: "Kitchen" },
  ];

  const writes: { path: string; method: string; body?: JsonObject; file?: BodyInit | null }[] = [];
  const signals: { path: string; signal: AbortSignal | null | undefined }[] = [];
  const primary = deferredUserRequest();
  const metadata = deferredUserRequest();
  const picture = deferredUserRequest();
  const deletion = deferredUserRequest();
  const read = deferredUserRequest();
  const settings = { ...options.settings };
  let failingPrimary = options.failPrimary;
  let contextReads = 0;
  let overviewReads = 0;
  const createObjectURL = vi.fn(() => "blob:user-picture");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => messages.mockRestore());

  const app = mountNativeEditor(
    path,
    (url, init) => {
      if (url === "/api/objects/userfields?query[]=entity=users") return Response.json(fields);

      if (url.startsWith("/api/userfields/users/") && !init?.method) {
        const id = url.split("/").at(-1);

        return Response.json(
          options.formValues ??
            Object.fromEntries(
              fields.map((field) => [
                field.name,
                values.find((row) => String(row.object_id) === id && row.name === field.name)
                  ?.value ?? null,
              ]),
            ),
        );
      }

      if (url === "/api/v2/user/permissions")
        return Response.json({
          USERS_READ: !options.deniedRead,
          USERS_CREATE: true,
          USERS_EDIT: true,
          USERS_EDIT_SELF: true,
          USERS_DELETE: true,
        });

      if (url === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "2026-01-01" },
          php_version: "8.4",
          python_version: "3.13",
          sqlite_version: "3.50",
          db_version: 215,
          os: "Linux",
          client: "test",
        });

      if (url === "/api/user/settings") return Response.json(settings);

      if (url.startsWith("/api/user/settings/") && init?.method) {
        const key = decodeURIComponent(url.split("/").at(-1)!);

        if (init.method === "PUT") settings[key] = JSON.parse(String(init.body)).value;
        else delete settings[key];

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/users/overview") {
        overviewReads++;

        if (options.deniedRead)
          return Response.json({ error_message: "USERS_READ required" }, { status: 403 });

        const response = () =>
          Response.json({
            users,
            fields,
            values,
            current_user_id: 7,
            externally_managed_authentication: !!options.external,
            show_permissions: !options.hiddenPassword,
          });

        return options.holdContext ? read.promise.then(response) : response();
      }

      const form = /^\/api\/v2\/users\/([^/]+)\/form-context$/.exec(url);

      if (form) {
        contextReads++;

        if (options.deniedForm)
          return Response.json({ error_message: "USERS_EDIT_SELF required" }, { status: 403 });
        const raw = decodeURIComponent(form[1]!);
        const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim());

        const user =
          raw === "new"
            ? null
            : numeric
              ? users.find((user) => user.id === Number(raw))
              : undefined;

        if (user === undefined)
          return Response.json({ error_message: "User missing" }, { status: 404 });

        const response = () =>
          Response.json({
            user,
            fields,
            values: user
              ? (options.formValues ??
                Object.fromEntries(
                  fields.map((field) => [
                    field.name,
                    values.find(
                      (row) => String(row.object_id) === String(user.id) && row.name === field.name,
                    )?.value ?? null,
                  ]),
                ))
              : {},
            current_user_id: 7,
            password_controls: !options.hiddenPassword && !options.external,
            hidden_password: !!options.hiddenPassword,
            externally_managed_authentication: !!options.external,
          });

        return options.holdContext ? read.promise.then(response) : response();
      }

      if (
        (url === "/api/users" && init?.method === "POST") ||
        (/^\/api\/users\/-?\d+$/.test(url) && (init?.method === "PUT" || init?.method === "DELETE"))
      ) {
        const body: JsonObject = init.body ? JSON.parse(String(init.body)) : {};
        writes.push({ path: url, method: init.method, body });
        signals.push({ path: url, signal: init.signal });

        return (async () => {
          if (options.holdPrimary) await primary.promise;

          if (failingPrimary)
            return Response.json({ error_message: "User write denied" }, { status: 403 });

          if (init.method === "DELETE")
            users.splice(
              users.findIndex((user) => user.id === Number(url.split("/").at(-1))),
              1,
            );
          else {
            const existing = users.find((user) => user.id === Number(url.split("/").at(-1)));

            if (existing) Object.assign(existing, body);
            else
              users.push({
                id: 9,
                username: String(body.username),
                first_name: String(body.first_name ?? ""),
                last_name: String(body.last_name ?? ""),
                picture_file_name:
                  body.picture_file_name === undefined ? null : String(body.picture_file_name),
              });
          }

          return new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/userfields/users/") && init?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(init.body));
        const name = Object.keys(body)[0]!;
        writes.push({ path: url, method: "PUT", body });
        signals.push({ path: url, signal: init.signal });

        return (async () => {
          if (options.holdField === name) await metadata.promise;

          if (url.endsWith("/undefined") || options.failField === name)
            return Response.json({ error_message: "Custom value rejected" }, { status: 400 });

          const existing = values.find(
            (value) => String(value.object_id) === url.split("/").at(-1) && value.name === name,
          );

          if (existing) existing.value = String(body[name]);
          else
            values.push({
              object_id: Number(url.split("/").at(-1)),
              name,
              value: String(body[name]),
            });

          return new Response(null, { status: 204 });
        })();
      }

      if (url.startsWith("/api/files/userpictures/") || url.startsWith("/api/files/userfiles/")) {
        if (!init?.method || init.method === "GET")
          return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });
        writes.push({ path: url, method: init.method, file: init.body });
        signals.push({ path: url, signal: init.signal });

        return (async () => {
          if (init.method === "DELETE" && options.holdDelete) await deletion.promise;

          if (init.method === "PUT" && options.holdPicture) await picture.promise;

          return options.failPicture
            ? Response.json({ error_message: "Picture upload rejected" }, { status: 503 })
            : new Response(null, { status: 204 });
        })();
      }

      return undefined;
    },
    { FEATURE_FLAG_STOCK: false, FEATURE_FLAG_SHOPPINGLIST: false },
  );

  return {
    ...app,
    users,
    fields,
    values,
    writes,
    signals,
    primary,
    metadata,
    picture,
    deletion,
    read,
    settings,
    messages,
    createObjectURL,
    revokeObjectURL,
    get contextReads() {
      return contextReads;
    },
    get overviewReads() {
      return overviewReads;
    },
    allowPrimary() {
      failingPrimary = false;
    },
  };
}
