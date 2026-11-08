import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";

const labels = {
  ADMIN: "All permissions",
  USERS: "User management",
  USERS_CREATE: "Create users",
  USERS_EDIT: "Edit users (including passwords)",
  USERS_READ: "Show users",
  STOCK: "Stock",
  STOCK_CONSUME: "Consume",
};

function mountPermissions({
  self = false,
  admin = false,
  denied = false,
  hold = false,
  rawUserId = "",
  holdContext = false,
} = {}) {
  const user = { id: self ? 7 : 2, username: "alex", first_name: "Alex", last_name: "River" };

  const selected = rawUserId || String(user.id);

  const raw = [
    [1, "ADMIN", null],
    [2, "USERS", 1],
    [3, "USERS_CREATE", 2],
    [4, "USERS_EDIT", 3],
    [5, "USERS_READ", 4],
    [7, "STOCK", 1],
    [16, "STOCK_CONSUME", 7],
  ] as const;

  const permissions = raw.map(([id, permission_name, parent]) => ({
    id,
    user_id: user.id,
    permission_id: id,
    permission_name,
    parent,
    has_permission: admin || id === 16 ? 1 : 0,
  }));

  const writes: number[][] = [];

  let release = () => {};

  const response = new Promise<void>((resolve) => {
    release = resolve;
  });

  let releaseContext = () => {};

  const contextResponse = new Promise<void>((resolve) => {
    releaseContext = resolve;
  });

  let reads = 0;
  let reject = denied;

  const app = mountNativeEditor(`/user/${selected}/permissions`, async (url, options) => {
    if (url === `/api/v2/users/${selected}/permissions-context`) {
      reads++;

      if (holdContext && reads > 1) await contextResponse;

      return Response.json({ user, permissions, current_user_id: 7 });
    }

    if (url === `/api/users/${user.id}/permissions` && options?.method === "PUT") {
      writes.push(JSON.parse(String(options.body)).permissions);

      if (hold) await response;

      return reject
        ? Response.json({ error_message: "Permission denied by server" }, { status: 400 })
        : new Response(null, { status: 204 });
    }

    if (url.startsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: {
          domain: "grocy/strings",
          "plural-forms": null,
          messages: {
            "": Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, [label]])),
          },
        },
      });

    return undefined;
  });

  return {
    ...app,
    writes,
    release,
    releaseContext,
    reads: () => reads,
    allow: () => {
      reject = false;
    },
  };
}

const checkbox = (name: string) => screen.getByRole<HTMLInputElement>("checkbox", { name });

test("native permission hierarchy checks and disables descendants, then saves only enabled selected grants", async () => {
  const app = mountPermissions({ rawUserId: "2e0" });
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Permissions for user Alex River" });
  expect(checkbox("Consume").checked).toBe(true);
  await user.click(checkbox("User management"));

  for (const name of ["Create users", "Edit users (including passwords)", "Show users"]) {
    expect(checkbox(name).checked).toBe(true);
    expect(checkbox(name).disabled).toBe(true);
  }

  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Permissions saved");
  expect(app.writes).toEqual([[2, 16]]);
  expect(app.reads()).toBe(1);
  expect(app.router.history.location.pathname).toBe("/user/2e0/permissions");
  await user.click(checkbox("User management"));
  expect(checkbox("Show users").checked).toBe(false);
  expect(checkbox("Show users").disabled).toBe(false);
  await user.click(checkbox("Edit users (including passwords)"));
  expect(checkbox("Show users").disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.writes).toEqual([
      [2, 16],
      [4, 16],
    ]),
  );
});

test("removing own full permissions asks for confirmation and No restores the whole hierarchy", async () => {
  const app = mountPermissions({ self: true, admin: true });
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Permissions for user Alex River" });
  expect(checkbox("Stock").disabled).toBe(true);
  await user.click(checkbox("All permissions"));
  await screen.findByRole("dialog", {
    name: "Are you sure you want to remove full permissions for yourself?",
  });
  await user.click(screen.getByRole("button", { name: "No" }));
  expect(checkbox("All permissions").checked).toBe(true);
  expect(checkbox("Consume").disabled).toBe(true);
  await user.click(checkbox("All permissions"));
  await user.click(await screen.findByRole("button", { name: "Yes" }));
  expect(checkbox("Consume").checked).toBe(false);
  expect(checkbox("Consume").disabled).toBe(false);
  await user.click(checkbox("Stock"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toEqual([[7]]));
});

test("a rejected permission replacement retains selections for retry and reports the server message", async () => {
  const app = mountPermissions({ denied: true });
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Permissions for user Alex River" });
  await user.click(checkbox("User management"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Permission denied by server");
  expect(checkbox("User management").checked).toBe(true);
  app.allow();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Permissions saved");
  expect(app.writes).toEqual([
    [2, 16],
    [2, 16],
  ]);
});

test("background context refresh retains unsaved permission selections and the living save owner", async () => {
  const app = mountPermissions({ hold: true, holdContext: true });
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Permissions for user Alex River" });
  await user.click(checkbox("User management"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await act(async () => {
    void app.client.refetchQueries({ queryKey: ["user-permissions-editor", "2"] });
  });
  await waitFor(() => expect(app.reads()).toBe(2));
  expect(checkbox("User management").checked).toBe(true);
  await act(async () => app.releaseContext());
  expect(checkbox("User management").checked).toBe(true);
  await act(async () => app.release());
  await screen.findByText("Permissions saved");
});

test("overlapping permission saves stay enabled; departure suppresses late receipts and invalidates cached permissions", async () => {
  const app = mountPermissions({ hold: true });
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Permissions for user Alex River" });
  app.client.setQueryData(["user-permissions"], { ADMIN: true });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toEqual([[16], [16]]);
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await act(async () => app.release());
  await waitFor(() =>
    expect(app.client.getQueryState(["user-permissions"])?.isInvalidated).toBe(true),
  );
  expect(screen.queryByText("Permissions saved")).toBeNull();
  expect(app.router.history.location.pathname).toBe("/settings");
});
