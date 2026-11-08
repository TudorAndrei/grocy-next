import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import type { JsonObject } from "@/lib/json";
import { request } from "@/lib/api";

type EntityFixture = {
  id: number;
  name: string;
  caption: string;
  description: string;
  show_in_sidebar_menu: number;
  icon_css_class: string;
  userfields: null;
};

function mountEntity(
  path: string,
  {
    denied = false,
    held = false,
    failures = 0,
    commitOnFailure = false,
    basepath = "/",
    initial = {},
  }: {
    denied?: boolean;
    held?: boolean;
    failures?: number;
    commitOnFailure?: boolean;
    basepath?: string;
    initial?: Partial<EntityFixture>;
  } = {},
) {
  const record: EntityFixture = {
    id: 8,
    name: "tools",
    caption: "Tools",
    description: "Workshop",
    show_in_sidebar_menu: 1,
    icon_css_class: "fa-solid fa-hammer",
    userfields: null,
    ...initial,
  };

  const writes: Array<{ url: string; body: JsonObject }> = [];
  const signals: Array<AbortSignal | undefined> = [];
  const reads: string[] = [];
  let release = () => {};

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => messages.mockRestore());

  const write = (url: string, options: RequestInit) => {
    const body: JsonObject = JSON.parse(String(options.body));
    writes.push({ url, body });
    signals.push(options.signal ?? undefined);
    const rejected = denied || writes.length <= failures;

    return (async () => {
      // Ignore transport abortion here: a server can commit before its response retires.
      if (held) await pending;

      if (rejected) {
        if (commitOnFailure) Object.assign(record, body);

        return Response.json(
          { error_message: denied ? "Permission denied" : "Temporary write failure" },
          { status: denied ? 403 : 503 },
        );
      }

      Object.assign(record, body);

      return options.method === "POST"
        ? Response.json({ created_object_id: 8 })
        : new Response(null, { status: 204 });
    })();
  };

  const app = mountNativeEditor(
    path,
    (url, options) => {
      if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: !denied });

      if (url === "/api/objects/userentities") {
        if (options?.method === "POST") return write(url, options);
        reads.push(url);

        return Response.json([record]);
      }

      if (url === "/api/objects/userentities/8") {
        if (options?.method === "PUT") return write(url, options);
        reads.push(url);

        return Response.json(record);
      }

      if (url === "/api/objects/userentities/999")
        return Response.json({ error_message: "Object not found" }, { status: 404 });

      if (url === "/api/v2/custom-data/catalog")
        return Response.json({ entities: ["userentity-tools"], field_types: [] });

      return undefined;
    },
    {},
    { basepath },
  );

  return { ...app, writes, record, messages, release, pending, signals, reads };
}

test("selected userentity initially omits disabled name and icon then returns to native list", async () => {
  const app = mountEntity("/userentity/8");
  const user = userEvent.setup();
  const name = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  expect(name.value).toBe("tools");
  expect(name.disabled).toBe(true);
  const caption = screen.getByRole("textbox", { name: "Caption" });
  await user.clear(caption);
  await user.type(caption, "Workshop tools");
  await user.click(screen.getByRole("checkbox", { name: "Show in sidebar menu" }));
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Icon CSS class" }).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/userentities"));
  expect(app.writes).toEqual([
    {
      url: "/api/objects/userentities/8",
      body: { caption: "Workshop tools", description: "Workshop", show_in_sidebar_menu: "0" },
    },
  ]);
  expect(app.record.name).toBe("tools");
  expect(app.record.icon_css_class).toBe("fa-solid fa-hammer");
});

test("create enforces native identifier and caption constraints and defaults sidebar off", async () => {
  const app = mountEntity("/userentity/new");
  const user = userEvent.setup();
  const name = await screen.findByRole("textbox", { name: "Name" });
  const caption = screen.getByRole("textbox", { name: "Caption" });
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Show in sidebar menu" }).checked,
  ).toBe(false);
  await user.type(name, "bad-name");
  await user.type(caption, "Tools");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  await user.clear(name);
  await user.type(name, "tools_2");
  await user.clear(caption);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(app.writes).toHaveLength(0);
  await user.type(caption, "Tools");
  await user.click(screen.getByRole("checkbox", { name: "Show in sidebar menu" }));
  await user.type(screen.getByRole("textbox", { name: "Icon CSS class" }), "fa-solid fa-wrench");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]?.body).toEqual({
    name: "tools_2",
    caption: "Tools",
    description: "",
    show_in_sidebar_menu: "1",
    icon_css_class: "fa-solid fa-wrench",
  });
});

test.each(["?embedded", "?embedded=", "?embedded=0", "?embedded=&embedded=0"])(
  "embedded presence sends exact Reload envelope after save %s",
  async (query) => {
    const app = mountEntity(`/house/userentity/8${query}`, { basepath: "/house" });
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "Caption" });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(app.messages).toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(app.router.history.location.pathname).toBe("/house/userentity/8");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).closest("fieldset")?.disabled,
    ).toBe(true);
  },
);

test("encoded embedded key does not replace the native userentity return navigation", async () => {
  const app = mountEntity("/userentity/8?%65mbedded=0");
  const user = userEvent.setup();
  await screen.findByRole("textbox", { name: "Caption" });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.router.history.location.pathname).toBe("/userentities"));
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
});

test("native reader can submit then sees API denial with editable draft retained", async () => {
  const app = mountEntity("/userentity/8", { denied: true });
  const user = userEvent.setup();
  const caption = await screen.findByRole<HTMLInputElement>("textbox", { name: "Caption" });
  expect(caption.disabled).toBe(false);
  await user.type(caption, " changed");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  await within(screen.getByRole("dialog", { name: "Error details" })).findByText(
    /Permission denied/,
  );
  expect(caption.value).toBe("Tools changed");
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(caption.closest("fieldset")?.disabled).toBe(false);
});

test("departing during a held entity save suppresses late navigation and messages", async () => {
  const app = mountEntity("/userentity/8?embedded", { held: true });
  const user = userEvent.setup();
  await screen.findByRole("textbox", { name: "Caption" });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await act(async () => {
    app.release();
    await app.pending;
  });
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
});

test("a missing selected userentity does not become a create form", async () => {
  mountEntity("/userentity/999");
  await screen.findByText("Object not found");
  expect(screen.queryByRole("textbox", { name: "Caption" })).toBeNull();
});

test("native primary recovery unlocks Name and Icon independently of the sidebar click policy", async () => {
  const app = mountEntity("/userentity/8?embedded", {
    failures: 2,
    initial: { show_in_sidebar_menu: 0 },
  });

  const user = userEvent.setup();
  const name = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  const icon = screen.getByRole<HTMLInputElement>("textbox", { name: "Icon CSS class" });
  const sidebar = screen.getByRole("checkbox", { name: "Show in sidebar menu" });

  expect(name.disabled).toBe(true);
  expect(icon.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => {
    expect(name.disabled).toBe(false);
    expect(icon.disabled).toBe(false);
  });
  expect(app.writes[0]?.body).toEqual({
    caption: "Tools",
    description: "Workshop",
    show_in_sidebar_menu: "0",
  });
  await user.clear(name);
  await user.type(name, "renamed_tools");
  await user.clear(icon);
  await user.type(icon, "fa-solid fa-new{Enter}");
  await waitFor(() => expect(app.writes).toHaveLength(2));
  await waitFor(() => expect(name.closest("fieldset")?.disabled).toBe(false));
  expect(app.writes[1]?.body).toEqual({
    name: "renamed_tools",
    caption: "Tools",
    description: "Workshop",
    show_in_sidebar_menu: "0",
    icon_css_class: "fa-solid fa-new",
  });
  await user.click(sidebar);
  expect(icon.disabled).toBe(false);
  await user.click(sidebar);
  expect(icon.disabled).toBe(true);
  expect(name.disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(app.writes[2]?.body).toEqual({
    name: "renamed_tools",
    caption: "Tools",
    description: "Workshop",
    show_in_sidebar_menu: "0",
  });
  expect(app.record.name).toBe("renamed_tools");
  expect(app.record.icon_css_class).toBe("fa-solid fa-hammer");
});

test("native main controls serialize sanitized Caption and CRLF Description with imported sidebar2 unchecked", async () => {
  const app = mountEntity("/userentity/8?embedded", {
    initial: {
      caption: "Imported\r\nCaption\nName",
      description: "First\nSecond",
      show_in_sidebar_menu: 2,
    },
  });

  const user = userEvent.setup();
  const caption = await screen.findByRole<HTMLInputElement>("textbox", { name: "Caption" });

  expect(caption.value).toBe("ImportedCaptionName");
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Show in sidebar menu" }).checked,
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.messages).toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    ),
  );
  expect(app.writes[0]?.body).toEqual({
    caption: "ImportedCaptionName",
    description: "First\r\nSecond",
    show_in_sidebar_menu: "0",
  });
});

test("a retired failed entity write marks a newer cached reader stale without old error or active refetch", async () => {
  const app = mountEntity("/userentity/8?embedded", {
    held: true,
    failures: 1,
    commitOnFailure: true,
  });

  const user = userEvent.setup();
  const caption = await screen.findByRole("textbox", { name: "Caption" });
  await user.clear(caption);
  await user.type(caption, "Committed title");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));

  const reader = {
    queryKey: ["objects", "userentities"],
    queryFn: () => request<EntityFixture[]>("/api/objects/userentities"),
    staleTime: Infinity,
  };

  const before = await app.client.fetchQuery(reader);

  expect(before[0]?.caption).toBe("Tools");
  const readsBeforeRelease = app.reads.length;

  await act(async () => app.release());
  await waitFor(() => expect(app.client.getQueryState(reader.queryKey)?.isInvalidated).toBe(true));
  expect(app.reads).toHaveLength(readsBeforeRelease);
  expect(app.router.history.location.pathname).toBe("/settings");
  expect(app.messages).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(
    screen.queryByRole("button", { name: /Error while saving, probably this item already exists/ }),
  ).toBeNull();
  const after = await app.client.fetchQuery(reader);

  expect(after[0]?.caption).toBe("Committed title");
  expect(app.signals[0]?.aborted).toBe(true);
});

test.each([
  ["?%65mbedded=0", "?embedded=0", true],
  ["?embedded=0", "?%65mbedded=0", false],
])(
  "held entity completion reads live literal presence %s to %s",
  async (initial, current, embedded) => {
    const app = mountEntity(`/userentity/8${initial}`, { held: true });
    const user = userEvent.setup();
    const caption = await screen.findByRole<HTMLInputElement>("textbox", { name: "Caption" });
    await user.type(caption, " drafted");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(1));
    await act(async () => app.router.history.replace(`/userentity/8${current}`));
    expect(screen.getByRole("textbox", { name: "Caption" })).toBe(caption);
    expect(caption.value).toBe("Tools drafted");
    expect(app.writes).toHaveLength(1);
    await act(async () => app.release());

    if (embedded) {
      await waitFor(() =>
        expect(app.messages).toHaveBeenCalledWith(
          { Message: "Reload", Payload: null },
          window.location.origin,
        ),
      );
      expect(app.router.history.location.pathname).toBe("/userentity/8");
    } else {
      await waitFor(() => expect(app.router.history.location.pathname).toBe("/userentities"));
      expect(app.messages).not.toHaveBeenCalledWith(
        { Message: "Reload", Payload: null },
        window.location.origin,
      );
    }
  },
);
