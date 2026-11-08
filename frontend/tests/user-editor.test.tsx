import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { mountUsers, department } from "./fixtures/users";
import { pictureBytes } from "./fixtures/picture";
import type { JsonObject } from "@/lib/json";
import { getUsersOverview } from "@/lib/user-form";

test("selected user hydration uses canonical stored identity while the overview retains its first loose alias", async () => {
  const app = mountUsers("/users", {
    fields: [
      department,
      {
        ...department,
        id: 2,
        name: "missing",
        caption: "Missing field",
        default_value: "Configured default",
      },
      {
        ...department,
        id: 3,
        name: "started",
        caption: "Started",
        type: "date",
        default_value: "now",
      },
    ],
    values: [
      { object_id: "02", name: "department", value: "Overview alias" },
      { object_id: "2", name: "department", value: "Canonical department" },
      { object_id: "2e0", name: "department", value: "Scientific alias" },
    ],
  });

  const row = (await screen.findByRole("rowheader", { name: "alex" })).closest("tr")!;
  expect(within(row).getByText("Overview alias")).toBeTruthy();
  await userEvent.click(within(row).getByRole("link", { name: "Edit this item" }));
  expect((await screen.findByLabelText<HTMLInputElement>("Department")).value).toBe(
    "Canonical department",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Missing field").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Started").value).toBe("");
  expect(app.writes).toEqual([]);
});

test.each([
  ["0", 0, "imported"],
  ["-1", -1, "imported"],
  ["02", 2, "alex"],
  ["2e0", 2, "alex"],
] as const)(
  "selected user %s resolves native numeric aliases and writes the canonical ID",
  async (raw, id, username) => {
    const app = mountUsers(`/user/${raw}`, id <= 0 ? { importedId: id } : {});
    expect((await screen.findByLabelText<HTMLInputElement>("Username")).value).toBe(username);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(1));
    expect(app.writes[0]!.path).toBe(`/api/users/${id}`);
    await screen.findByRole("heading", { level: 1, name: "Users" });
  },
);

test.each(["0x2", "0b10"])("selected user %s does not alias an unrelated record", async (raw) => {
  const app = mountUsers(`/user/${raw}`);
  expect(await screen.findByText("User missing")).toBeTruthy();
  expect(screen.queryByLabelText("Username")).toBeNull();
  expect(app.writes).toEqual([]);
});

test("selected users submit raw name fields without disabled passwords and return to users even when embedded", async () => {
  const app = mountUsers("/user/2?embedded");
  const user = userEvent.setup();
  expect((await screen.findByLabelText<HTMLInputElement>("Username")).value).toBe("alex");
  expect(screen.getByLabelText<HTMLInputElement>("Department").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Password", { exact: true }).disabled).toBe(true);
  await user.clear(screen.getByLabelText("Username"));
  await user.type(screen.getByLabelText("Username"), " alex ");
  await user.clear(screen.getByLabelText("Last name"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { level: 1, name: "Users" });
  expect(app.writes).toEqual([
    {
      path: "/api/users/2",
      method: "PUT",
      body: { username: " alex ", first_name: "Alex", last_name: "", change_password: "0" },
    },
  ]);
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(app.revokeObjectURL).toHaveBeenCalledWith("blob:user-picture");
});

test.each([
  ["?changepw=true&changepw=false", true],
  ["?changepw&changepw=true", false],
  ["?changepw=TRUE", false],
])("native first raw changepw query %s controls password serialization", async (query, checked) => {
  const app = mountUsers(`/user/2${query}`);
  const user = userEvent.setup();
  await screen.findByLabelText("Username");
  expect(screen.getByLabelText<HTMLInputElement>("Change password").checked).toBe(checked);

  if (checked) {
    await user.type(screen.getByLabelText("Password", { exact: true }), " raw password ");
    await user.type(screen.getByLabelText("Confirm password"), " raw password ");
  }

  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));

  const expected: JsonObject = {
    username: "alex",
    first_name: "Alex",
    last_name: "River",
    change_password: "0",
  };

  if (checked)
    Object.assign(expected, {
      change_password: "1",
      password: " raw password ",
      password_confirm: " raw password ",
    });
  expect(app.writes[0]!.body).toEqual(expected);
});

test("new user password confirmation rejects mismatch, then accepts matching credentials on Enter", async () => {
  const app = mountUsers("/user/new");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Username"), "new-person");
  await user.type(screen.getByLabelText("Password", { exact: true }), "secret");
  await user.type(screen.getByLabelText("Confirm password"), "different");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toEqual([]);
  await user.clear(screen.getByLabelText("Confirm password"));
  await user.type(screen.getByLabelText("Confirm password"), "secret{Enter}");
  await screen.findByRole("heading", { level: 1, name: "Users" });
  expect(app.writes[0]).toEqual({
    path: "/api/users",
    method: "POST",
    body: {
      username: "new-person",
      first_name: "",
      last_name: "",
      password: "secret",
      password_confirm: "secret",
    },
  });
});

test.each([
  [true, false],
  [false, true],
] as const)(
  "external=%s hidden=%s follows native password markup and payload",
  async (external, hiddenPassword) => {
    const app = mountUsers("/user/2", { external, hiddenPassword });
    await screen.findByLabelText("Username");
    expect(screen.queryByLabelText("Change password")).toBeNull();
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(1));
    const expected: JsonObject = { username: "alex", first_name: "Alex", last_name: "River" };

    if (hiddenPassword) Object.assign(expected, { password: "x", password_confirm: "x" });
    expect(app.writes[0]!.body).toEqual(expected);
  },
);

test("selected User main body follows imported single-line DOM values and unchecked change-password serialization", async () => {
  const app = mountUsers("/user/2", {
    selectedUser: { username: "im\r\nported", first_name: "First\nName", last_name: "Last\rName" },
  });

  const username = await screen.findByLabelText<HTMLInputElement>("Username");
  expect(username.value).toBe("imported");
  expect(screen.getByLabelText<HTMLInputElement>("First name").value).toBe("FirstName");
  expect(screen.getByLabelText<HTMLInputElement>("Last name").value).toBe("LastName");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { level: 1, name: "Users" });
  expect(app.writes).toEqual([
    {
      path: "/api/users/2",
      method: "PUT",
      body: {
        username: "imported",
        first_name: "FirstName",
        last_name: "LastName",
        change_password: "0",
      },
    },
  ]);
});

test("selected User sends unchanged Arrow fields and live custom textarea LF at primary success while omitting clean controls", async () => {
  const app = mountUsers("/user/2", {
    holdPrimary: true,
    values: [{ object_id: "2", name: "department", value: "Garden" }],
    fields: [
      department,
      {
        ...department,
        id: 2,
        name: "notes",
        caption: "Custom notes",
        type: "text-multi-line",
        sort_number: 2,
      },
      { ...department, id: 3, name: "clean", caption: "Clean field", sort_number: 3 },
    ],
  });

  const user = userEvent.setup();
  const unchanged = await screen.findByLabelText<HTMLInputElement>("Department");
  await user.click(unchanged);
  await user.keyboard("{ArrowLeft}");
  expect(unchanged.value).toBe("Garden");
  const notes = screen.getByLabelText<HTMLTextAreaElement>("Custom notes");
  await user.type(notes, "Before primary");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(notes.matches(":disabled")).toBe(true);
  // Controlled disabled-DOM assignment isolates the source post-primary .val() binding.
  // Natural disabled-control editing is not claimed by this callback-timing proof.
  notes.value = "Live\r\nCustom line";
  await act(async () => app.primary.release());
  await screen.findByRole("heading", { level: 1, name: "Users" });
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/users/2", method: "PUT", body: { department: "Garden" } },
    { path: "/api/userfields/users/2", method: "PUT", body: { notes: "Live\nCustom line" } },
  ]);
});

test("held selected User save survives same-path raw-query replacement without remounting or replaying startup password controls", async () => {
  const app = mountUsers("/user/2?changepw=false&changepw=true&embedded", { holdPrimary: true });
  const user = userEvent.setup();
  const firstName = await screen.findByLabelText<HTMLInputElement>("First name");
  await user.type(firstName, " draft");
  expect(screen.getByLabelText<HTMLInputElement>("Change password").checked).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  const signal = app.signals.find((write) => write.path === "/api/users/2")?.signal;
  await act(async () =>
    app.router.history.replace("/user/2?changepw=true&changepw=false&keep=raw&%65mbedded"),
  );
  expect(screen.getByLabelText("First name")).toBe(firstName);
  expect(firstName.value).toBe("Alex draft");
  expect(screen.getByLabelText<HTMLInputElement>("Change password").checked).toBe(false);
  expect(firstName.matches(":disabled")).toBe(true);
  expect(app.contextReads).toBe(1);
  await act(async () => app.primary.release());
  await screen.findByRole("heading", { level: 1, name: "Users" });
  expect(app.users.find((row) => row.id === 2)?.first_name).toBe("Alex draft");
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(signal?.aborted).toBe(true);
  expect(app.writes).toHaveLength(1);
});

test("native create 204 leaves a dirty custom field saving against undefined without inventing a new ID", async () => {
  const app = mountUsers("/user/new", { hiddenPassword: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Username"), "custom-user");
  await user.type(screen.getByLabelText("Department"), "Kitchen");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes[1]).toEqual({
    path: "/api/userfields/users/undefined",
    method: "PUT",
    body: { department: "Kitchen" },
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(app.router.state.location.pathname).toBe("/user/new");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  expect(screen.queryByText(/Error while saving/)).toBeNull();
  expect(app.users.some((row) => row.username === "custom-user")).toBe(true);
});

test("primary user denial enables required passwords, preserves unchecked flag0 and permits fresh retries after native validation", async () => {
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mountUsers("/user/2", { failPrimary: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("First name"), " changed");
  const password = screen.getByLabelText<HTMLInputElement>("Password", { exact: true });
  const confirmation = screen.getByLabelText<HTMLInputElement>("Confirm password");
  const change = screen.getByLabelText<HTMLInputElement>("Change password");
  expect(password.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(password.matches(":disabled")).toBe(false));
  expect(confirmation.matches(":disabled")).toBe(false);
  expect(password.required).toBe(true);
  expect(change.checked).toBe(false);
  expect(logger).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Error while saving/)).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("First name").value).toBe("Alex changed");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(1);
  expect(password.validity.valueMissing).toBe(true);
  await user.type(password, " secret ");
  await user.type(confirmation, "different");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(1);
  expect(confirmation.validity.customError).toBe(true);
  await user.clear(confirmation);
  await user.type(confirmation, " secret {Enter}");
  await waitFor(() => expect(logger).toHaveBeenCalledTimes(2));
  expect(app.writes[1]).toEqual({
    path: "/api/users/2",
    method: "PUT",
    body: {
      username: "alex",
      first_name: "Alex changed",
      last_name: "River",
      change_password: "0",
      password: " secret ",
      password_confirm: " secret ",
    },
  });
  await user.click(change);
  await user.click(change);
  expect(change.checked).toBe(false);
  expect(password.disabled).toBe(true);
  expect(confirmation.disabled).toBe(true);
  app.allowPrimary();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { level: 1, name: "Users" });
  expect(app.writes).toHaveLength(3);
  expect(app.writes[2]!.body).toEqual({
    username: "alex",
    first_name: "Alex changed",
    last_name: "River",
    change_password: "0",
  });
});

test("primary, parallel final custom field and live picture bytes follow native user save staging", async () => {
  const app = mountUsers("/user/2", {
    values: [{ object_id: "2", name: "department", value: "Garden" }],
    holdPrimary: true,
    holdField: "department",
    holdPicture: true,
    fields: [
      department,
      { ...department, id: 2, name: "last", caption: "Last field", sort_number: 2 },
    ],
  });

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Department"), " changed");
  await user.type(screen.getByLabelText("Last field"), "Last");
  const first = new File([pictureBytes], "First.PNG", { type: "image/png" });
  const second = new File([pictureBytes], "Second.PNG", { type: "image/png" });
  await user.upload(screen.getByLabelText("User picture", { selector: "input" }), first);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]!.body?.picture_file_name).toBe("iifirst.png");
  expect(screen.getByLabelText<HTMLInputElement>("Username").matches(":disabled")).toBe(true);
  expect(
    screen.getByLabelText<HTMLInputElement>("User picture", { selector: "input" }).disabled,
  ).toBe(false);
  await user.upload(screen.getByLabelText("User picture", { selector: "input" }), second);
  await act(async () => app.primary.release());
  await waitFor(() => expect(app.writes).toHaveLength(4));
  expect(app.writes[1]!.body).toEqual({ department: "Garden changed" });
  expect(app.writes[2]!.body).toEqual({ last: "Last" });
  expect(app.writes[3]).toEqual({
    path: `/api/files/userpictures/${encodeURIComponent(btoa("iifirst.png"))}`,
    method: "PUT",
    file: second,
  });
  await act(async () => app.picture.release());
  await screen.findByRole("heading", { level: 1, name: "Users" });
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await screen.findByRole("heading", { level: 1, name: "Settings" });

  const reader = {
    queryKey: ["users-overview"],
    queryFn: ({ signal }: { signal: AbortSignal }) => getUsersOverview(signal),
    staleTime: Infinity,
  };

  const before = await app.client.fetchQuery(reader);
  expect(
    before.values.find((value) => String(value.object_id) === "2" && value.name === "department")
      ?.value,
  ).toBe("Garden");
  const overviewReads = app.overviewReads;
  await act(async () => app.metadata.release());
  await waitFor(() => expect(app.client.getQueryState(reader.queryKey)?.isInvalidated).toBe(true));
  expect(app.overviewReads).toBe(overviewReads);
  const after = await app.client.fetchQuery(reader);
  expect(
    after.values.find((value) => String(value.object_id) === "2" && value.name === "department")
      ?.value,
  ).toBe("Garden changed");
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(screen.queryByText(/Error while saving/)).toBeNull();
});

test("Delete then picture selection retains the native misspelled flag reset and independent old-file deletion", async () => {
  const app = mountUsers("/user/2", { holdDelete: true });
  const user = userEvent.setup();
  await screen.findByLabelText("Username");
  await user.click(screen.getByRole("button", { name: "Delete picture" }));
  await user.upload(
    screen.getByLabelText("User picture", { selector: "input" }),
    new File([pictureBytes], "Replacement.PNG", { type: "image/png" }),
  );
  expect(screen.queryByText("The current picture will be deleted on save")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { level: 1, name: "Users" });
  expect(app.writes.map((call) => call.method)).toEqual(["DELETE", "PUT"]);
  expect(app.writes[0]!.path).toBe(
    `/api/files/userpictures/${encodeURIComponent(btoa("old.png"))}`,
  );
  expect(app.writes[1]!.body?.picture_file_name).toBeNull();
  await act(async () => app.deletion.release());
});

test("picture upload errors show details and unlock the retained user draft", async () => {
  const app = mountUsers("/user/2", { failPicture: true });
  const user = userEvent.setup();
  await screen.findByLabelText("Username");
  await user.upload(
    screen.getByLabelText("User picture", { selector: "input" }),
    new File([pictureBytes], "New.PNG", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(await screen.findByRole("button", { name: /Click to show technical details/ }));
  expect(await screen.findByText(/Picture upload rejected/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false);
  expect(app.router.state.location.pathname).toBe("/user/2");
});

test("departed user save invalidates warm users caches but cannot start custom fields or picture upload", async () => {
  const app = mountUsers("/user/2", { holdPrimary: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Department"), " changed");
  app.client.setQueryData(["users-overview"], { users: app.users });
  app.client.setQueryData(["task-form-context"], { users: [], categories: [], current_user_id: 7 });
  app.client.setQueryData(["tracking-users"], []);
  await user.upload(
    screen.getByLabelText("User picture", { selector: "input" }),
    new File([pictureBytes], "Late.PNG", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await act(async () => {
    app.primary.release();
    await app.primary.promise;
  });
  await waitFor(() =>
    expect(app.client.getQueryState(["users-overview"])?.isInvalidated).toBe(true),
  );
  expect(app.client.getQueryState(["task-form-context"])?.isInvalidated).toBe(true);
  expect(app.client.getQueryState(["tracking-users"])?.isInvalidated).toBe(true);
  expect(app.writes).toHaveLength(1);
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(screen.queryByText(/Error while saving/)).toBeNull();
});

test.each(["delete", "upload"] as const)(
  "retired User picture %s settlement marks a fresh inactive reader stale without old UI effects",
  async (stage) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = mountUsers("/user/2", {
      holdDelete: stage === "delete",
      holdPicture: stage === "upload",
      failPicture: true,
    });

    const user = userEvent.setup();
    await screen.findByLabelText("Username");

    if (stage === "delete")
      await user.click(screen.getByRole("button", { name: "Delete picture" }));
    else
      await user.upload(
        screen.getByLabelText("User picture", { selector: "input" }),
        new File([pictureBytes], "Pending.PNG", { type: "image/png" }),
      );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.writes.some((write) => write.path.startsWith("/api/files/userpictures/"))).toBe(
        true,
      ),
    );

    if (stage === "delete") await screen.findByRole("heading", { level: 1, name: "Users" });
    await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    const reader = {
      queryKey: ["users-overview"],
      queryFn: ({ signal }: { signal: AbortSignal }) => getUsersOverview(signal),
      staleTime: Infinity,
    };

    await app.client.fetchQuery(reader);
    expect(app.client.getQueryState(reader.queryKey)?.isInvalidated).toBe(false);
    const reads = app.overviewReads;
    await act(async () => (stage === "delete" ? app.deletion.release() : app.picture.release()));
    await waitFor(() =>
      expect(app.client.getQueryState(reader.queryKey)?.isInvalidated).toBe(true),
    );
    expect(app.overviewReads).toBe(reads);
    expect(app.router.state.location.pathname).toBe("/settings");
    expect(screen.queryByText(/Error while saving/)).toBeNull();
    expect(logged).not.toHaveBeenCalled();
    expect(app.writes.filter((write) => write.path === "/api/users/2")).toHaveLength(1);

    const fileSignal = app.signals.find((write) =>
      write.path.startsWith("/api/files/userpictures/"),
    )?.signal;

    expect(fileSignal?.aborted).toBe(true);
  },
);

test("selected-user context denial and invalid identifiers do not expose an unrelated editable record", async () => {
  const app = mountUsers("/user/7", { deniedForm: true });
  expect(await screen.findByText("USERS_EDIT_SELF required")).toBeTruthy();
  expect(screen.queryByLabelText("Username")).toBeNull();
  await act(async () => app.router.navigate({ href: "/user/not-an-id" }));
  expect(await screen.findByText("USERS_EDIT_SELF required")).toBeTruthy();
  await waitFor(() => expect(app.contextReads).toBe(2));
  expect(screen.queryByLabelText("Username")).toBeNull();
});

test("picture deletion failure unlocks live custom edits before the held primary response saves them", async () => {
  const app = mountUsers("/user/2", { holdPrimary: true, failPicture: true });
  const user = userEvent.setup();
  await user.clear(await screen.findByLabelText("Department"));
  await user.type(screen.getByLabelText("Department"), "Before");
  await user.click(screen.getByRole("button", { name: "Delete picture" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Error while saving, probably this item already exists");
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Department").disabled).toBe(false),
  );
  await user.clear(screen.getByLabelText("Department"));
  await user.type(screen.getByLabelText("Department"), "After");
  await act(async () => app.primary.release());
  await waitFor(() =>
    expect(app.writes.some((call) => call.path === "/api/userfields/users/2")).toBe(true),
  );
  expect(app.writes.find((call) => call.path === "/api/userfields/users/2")!.body).toEqual({
    department: "After",
  });
});

test("fresh selected-user context wins over cached data and later refetch preserves the editable draft", async () => {
  const app = mountUsers("/settings?tab=connection", { holdContext: true });
  app.client.setQueryData(["user-editor", "2"], {
    user: { ...app.users[1]!, username: "stale" },
    fields: app.fields,
    values: { department: "Stale department" },
    current_user_id: 7,
    password_controls: true,
    hidden_password: false,
    externally_managed_authentication: false,
  });
  await act(async () => app.router.navigate({ href: "/user/2" }));
  await waitFor(() => expect(app.contextReads).toBe(1));
  expect(screen.queryByLabelText("Username")).toBeNull();
  await act(async () => app.read.release());
  expect((await screen.findByLabelText<HTMLInputElement>("Username")).value).toBe("alex");
  await userEvent.type(screen.getByLabelText("First name"), " draft");
  await act(async () => {
    await app.client.invalidateQueries({ queryKey: ["user-editor", "2"] });
  });
  expect(screen.getByLabelText<HTMLInputElement>("First name").value).toBe("Alex draft");
});
