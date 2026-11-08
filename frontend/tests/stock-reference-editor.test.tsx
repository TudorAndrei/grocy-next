import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";

const subjects = [
  { path: "location", entity: "locations", name: "location", list: "/locations" },
  { path: "productgroup", entity: "product_groups", name: "product group", list: "/productgroups" },
  {
    path: "shoppinglocation",
    entity: "shopping_locations",
    name: "store",
    list: "/shoppinglocations",
  },
] as const;

const config = {
  FEATURE_FLAG_STOCK: true,
  FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
  FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
};

test.each(subjects)(
  "native $name editor selects its record and existing custom fields",
  async (subject) => {
    const { fetchMock } = mountNativeEditor(
      `/${subject.path}/5`,
      (url, init) => {
        if (url === `/api/objects/${subject.entity}/5` && init?.method !== "PUT")
          return Response.json({
            id: 5,
            name: "Selected reference",
            active: 0,
            description: "Existing description",
            is_freezer: 1,
          });

        if (
          url === "/api/objects/userfields" ||
          url === `/api/objects/userfields?query[]=entity=${subject.entity}` ||
          url === "/api/v2/custom-data/fields"
        )
          return Response.json([notesField(subject.entity)]);

        if (url === `/api/userfields/${subject.entity}/5`)
          return Response.json({ note: "Selected note" });

        return undefined;
      },
      config,
    );

    expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe(
      "Selected reference",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(false);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Description").value).toBe(
      "Existing description",
    );
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Owner note").value).toBe("Selected note"),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === `/api/objects/${subject.entity}`),
    ).toBe(false);
  },
);

test.each(subjects)(
  "creating a $name saves native fields before custom values and follows its native completion behavior",
  async (subject) => {
    const sequence: string[] = [];
    let body: unknown;
    const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

    const { router } = mountNativeEditor(
      `/${subject.path}/new`,
      (url, init) => {
        if (
          url === "/api/objects/userfields" ||
          url === `/api/objects/userfields?query[]=entity=${subject.entity}` ||
          url === "/api/v2/custom-data/fields"
        )
          return Response.json([notesField(subject.entity)]);

        if (url === `/api/objects/${subject.entity}` && init?.method === "POST") {
          sequence.push("object");
          body = JSON.parse(String(init.body));

          return Response.json({ created_object_id: "8" });
        }

        if (url === `/api/userfields/${subject.entity}/8` && init?.method === "PUT") {
          sequence.push("custom");
          expect(JSON.parse(String(init.body))).toEqual({ note: "Saved custom note" });

          return new Response(null, { status: 204 });
        }

        return undefined;
      },
      config,
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "New reference");
    expect(screen.getByLabelText<HTMLInputElement>("Active").checked).toBe(true);
    await user.type(screen.getByLabelText("Description"), "Native description");
    await user.type(screen.getByLabelText("Owner note"), "Saved custom note");

    if (subject.path === "location")
      await user.click(screen.getByRole("checkbox", { name: "Is freezer" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    if (subject.path === "productgroup") {
      await waitFor(() =>
        expect(parent).toHaveBeenCalledWith(
          { Message: "CloseLastModal", Payload: null },
          window.location.origin,
        ),
      );
      expect(router.state.location.pathname).toBe("/productgroup/new");
    } else await waitFor(() => expect(router.state.location.pathname).toBe(subject.list));
    expect(sequence).toEqual(["object", "custom"]);
    const expected = { name: "New reference", active: "1", description: "Native description" };
    expect(body).toEqual(subject.path === "location" ? { ...expected, is_freezer: "1" } : expected);
    expect(parent).not.toHaveBeenCalledWith(
      { Message: "Reload", Payload: null },
      window.location.origin,
    );
  },
);

test.each(subjects)(
  "an embedded $name editor honors parameter presence and keeps its own URL after saving",
  async (subject) => {
    const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

    const { router } = mountNativeEditor(
      `/${subject.path}/new?embedded=0`,
      (url, init) => {
        if (url === `/api/objects/${subject.entity}` && init?.method === "POST")
          return Response.json({ created_object_id: "9" });

        return undefined;
      },
      config,
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Embedded reference");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(parent).toHaveBeenCalledWith(
        { Message: subject.path === "productgroup" ? "CloseLastModal" : "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(router.state.location.pathname).toBe(`/${subject.path}/new`);
  },
);

test("location editing with freezing disabled clears the native freezer flag while updating the selected record", async () => {
  let body: unknown;
  mountNativeEditor(
    "/location/5?embedded",
    (url, init) => {
      if (url === "/api/objects/locations/5" && init?.method === "PUT") {
        body = JSON.parse(String(init.body));

        return new Response(null, { status: 204 });
      }

      if (url === "/api/objects/locations/5")
        return Response.json({
          id: 5,
          name: "Cold room",
          description: "Old freezer",
          active: 0,
          is_freezer: 1,
        });

      return undefined;
    },
    { ...config, FEATURE_FLAG_STOCK_PRODUCT_FREEZING: false },
  );
  vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("Cold room");
  expect(screen.queryByRole("checkbox", { name: "Is freezer" })).toBeNull();
  await user.clear(name);
  await user.type(name, "Pantry");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(body).toEqual({
      name: "Pantry",
      description: "Old freezer",
      active: "0",
      is_freezer: "0",
    }),
  );
});

test("authenticated readers retain native editable controls and denied writes expose details without saving custom fields", async () => {
  let fieldWrites = 0;
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  mountNativeEditor(
    "/productgroup/new",
    (url, init) => {
      if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: false });

      if (
        url === "/api/objects/userfields" ||
        url === "/api/objects/userfields?query[]=entity=product_groups" ||
        url === "/api/v2/custom-data/fields"
      )
        return Response.json([notesField("product_groups")]);

      if (url === "/api/objects/product_groups" && init?.method === "POST")
        return Response.json({ error_message: "Permission denied" }, { status: 403 });

      if (url.startsWith("/api/userfields/product_groups/") && init?.method === "PUT")
        fieldWrites++;

      return undefined;
    },
    config,
  );
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  expect(name.matches(":disabled")).toBe(false);
  await user.type(name, "Denied group");
  await user.type(screen.getByLabelText("Owner note"), "Never saved");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    }),
  );
  const details = await screen.findByRole("dialog", { name: "Error details" });
  expect(within(details).getByText(/Permission denied/)).toBeTruthy();
  expect(fieldWrites).toBe(0);
  expect(parent).not.toHaveBeenCalledWith(
    { Message: "CloseLastModal", Payload: null },
    window.location.origin,
  );
});

test.each(subjects)(
  "a malformed $name ID cannot load or write a different record",
  async (subject) => {
    const { fetchMock } = mountNativeEditor(`/${subject.path}/not-an-id`, () => undefined, config);
    await screen.findByText("Object not found");
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith(`/api/objects/${subject.entity}`),
      ),
    ).toBe(false);
  },
);

test("missing selected records show their read error and retry the same location", async () => {
  let reads = 0;
  mountNativeEditor(
    "/location/5",
    (url) => {
      if (url === "/api/objects/locations/5") {
        reads++;

        return reads === 1
          ? Response.json({ error_message: "Location missing" }, { status: 404 })
          : Response.json({ id: 5, name: "Restored location", active: 1, is_freezer: 0 });
      }

      return undefined;
    },
    config,
  );
  await screen.findByText("Location missing");
  expect(screen.queryByLabelText("Name")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("Restored location");
  expect(reads).toBe(2);
});

test("a departed product-group save cannot close a replacement editor or start its custom-field writes", async () => {
  let release: ((response: Response) => void) | undefined;

  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });

  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const { router, fetchMock } = mountNativeEditor(
    "/productgroup/new",
    (url, init) => {
      if (
        url === "/api/objects/userfields" ||
        url === "/api/objects/userfields?query[]=entity=product_groups" ||
        url === "/api/v2/custom-data/fields"
      )
        return Response.json([notesField("product_groups")]);

      if (url === "/api/objects/product_groups" && init?.method === "POST") return held;

      return undefined;
    },
    config,
  );

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), "Held group");
  await user.type(screen.getByLabelText("Owner note"), "Pending group note");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === "/api/objects/product_groups" && init?.method === "POST",
      ),
    ).toBe(true),
  );
  await act(async () => {
    await router.navigate({ href: "/location/new" });
  });
  await screen.findByRole("heading", { name: "Create location" });
  await user.type(await screen.findByLabelText("Name"), "Replacement location");
  await act(async () => {
    release?.(Response.json({ created_object_id: "8" }));
    await held;
  });
  expect(router.state.location.pathname).toBe("/location/new");
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Replacement location");
  expect(parent).not.toHaveBeenCalledWith(
    { Message: "CloseLastModal", Payload: null },
    window.location.origin,
  );
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        String(url).startsWith("/api/userfields/product_groups/") && init?.method === "PUT",
    ),
  ).toBe(false);
});

test.each(subjects.filter((subject) => subject.path !== "productgroup"))(
  "standalone $name save keeps the configured frontend base path",
  async (subject) => {
    const app = mountNativeEditor(
      `/house/${subject.path}/new`,
      (url, init) => {
        if (url === `/api/objects/${subject.entity}` && init?.method === "POST")
          return Response.json({ created_object_id: "8" });

        if (url === `/api/objects/${subject.entity}`) return Response.json([]);

        return undefined;
      },
      config,
      { basepath: "/house" },
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "New reference");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.router.history.location.pathname).toBe(`/house${subject.list}`));
    await screen.findByRole("heading", {
      name: subject.path === "location" ? "Locations" : "Stores",
      level: 1,
    });
  },
);

function referenceGate() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

const nativeFamilies = [
  { path: "location", entity: "locations", selected: false },
  { path: "productgroup", entity: "product_groups", selected: false },
  { path: "shoppinglocation", entity: "shopping_locations", selected: true },
  { path: "taskcategory", entity: "task_categories", selected: true },
] as const;

test.each(nativeFamilies)(
  "native $entity serializes main DOM text and dispatches parallel custom fields before its exact last-field completion",
  async (subject) => {
    const gates = { primary: referenceGate(), first: referenceGate(), last: referenceGate() };
    const calls: { path: string; method: string; body: Record<string, string> }[] = [];
    const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const id = subject.selected ? "5" : "new";
    const pathname = `/${subject.path}/${id}`;

    const app = mountNativeEditor(
      `${pathname}${subject.path === "productgroup" ? "" : "?embedded=0"}`,
      async (url, init) => {
        if (
          url === "/api/v2/custom-data/fields" ||
          url === "/api/objects/userfields" ||
          url === `/api/objects/userfields?query[]=entity=${subject.entity}`
        )
          return Response.json([
            {
              ...notesField(subject.entity),
              name: "first",
              caption: "First native note",
              type: "text-multi-line",
            },
            { ...notesField(subject.entity), id: 2, name: "clean", caption: "Clean native note" },
            { ...notesField(subject.entity), id: 3, name: "last", caption: "Last native note" },
          ]);

        if (url === `/api/objects/${subject.entity}/5` && init?.method !== "PUT")
          return Response.json({
            id: 5,
            name: "Imported\rName\nTail",
            active: 2,
            description: "Stored\nDescription",
            is_freezer: 0,
          });

        if (url === `/api/userfields/${subject.entity}/5` && init?.method !== "PUT")
          return Response.json({ clean: "Untouched metadata" });

        if (
          url.startsWith(`/api/objects/${subject.entity}`) &&
          ["POST", "PUT"].includes(init?.method ?? "")
        ) {
          calls.push({ path: url, method: init!.method!, body: JSON.parse(String(init!.body)) });
          await gates.primary.promise;

          return subject.selected
            ? new Response(null, { status: 204 })
            : Response.json({ created_object_id: "41" });
        }

        if (
          url === `/api/userfields/${subject.entity}/${subject.selected ? 5 : 41}` &&
          init?.method === "PUT"
        ) {
          const body: Record<string, string> = JSON.parse(String(init.body));
          calls.push({ path: url, method: "PUT", body });
          await gates["first" in body ? "first" : "last"].promise;

          return new Response(null, { status: 204 });
        }

        return undefined;
      },
      config,
    );

    const name = await screen.findByLabelText<HTMLInputElement>("Name");

    if (subject.selected) expect(name.value).toBe("ImportedNameTail");
    else await userEvent.type(name, "Ordered reference");
    const description = screen.getByLabelText<HTMLTextAreaElement>("Description");
    fireEvent.change(description, { target: { value: "Main line1\nMain line2" } });
    await userEvent.type(screen.getByLabelText("Last native note"), "Edited first");
    fireEvent.change(screen.getByLabelText("First native note"), {
      target: { value: "Custom line1\nCustom line2" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toHaveLength(1));

    const expected = {
      name: subject.selected ? "ImportedNameTail" : "Ordered reference",
      active: subject.selected ? "0" : "1",
      description: "Main line1\r\nMain line2",
    };

    expect.soft(calls[0]).toEqual({
      path: `/api/objects/${subject.entity}${subject.selected ? "/5" : ""}`,
      method: subject.selected ? "PUT" : "POST",
      body: subject.path === "location" ? { ...expected, is_freezer: "0" } : expected,
    });
    expect(name.matches(":disabled")).toBe(true);
    await act(async () => gates.primary.release());
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.slice(1)).toEqual([
      {
        path: `/api/userfields/${subject.entity}/${subject.selected ? 5 : 41}`,
        method: "PUT",
        body: { first: "Custom line1\nCustom line2" },
      },
      {
        path: `/api/userfields/${subject.entity}/${subject.selected ? 5 : 41}`,
        method: "PUT",
        body: { last: "Edited first" },
      },
    ]);
    expect(messages).not.toHaveBeenCalledWith(
      expect.objectContaining({
        Message: subject.path === "productgroup" ? "CloseLastModal" : "Reload",
      }),
      window.location.origin,
    );
    await act(async () => gates.last.release());
    await waitFor(() =>
      expect(messages).toHaveBeenCalledWith(
        { Message: subject.path === "productgroup" ? "CloseLastModal" : "Reload", Payload: null },
        window.location.origin,
      ),
    );
    expect(app.router.state.location.pathname).toBe(pathname);
    expect(name.matches(":disabled")).toBe(true);
    await act(async () => gates.first.release());
    expect(
      messages.mock.calls.filter(([bag]) => ["Reload", "CloseLastModal"].includes(bag?.Message)),
    ).toHaveLength(1);
  },
);

test("location final metadata failure is silent busy with no partial recovery UI", async () => {
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const writes: string[] = [];
  mountNativeEditor(
    "/location/new?embedded=false",
    (url, init) => {
      if (
        url === "/api/v2/custom-data/fields" ||
        url === "/api/objects/userfields" ||
        url === "/api/objects/userfields?query[]=entity=locations"
      )
        return Response.json([notesField("locations")]);

      if (url === "/api/objects/locations" && init?.method === "POST") {
        writes.push("primary");

        return Response.json({ created_object_id: "8" });
      }

      if (url === "/api/userfields/locations/8" && init?.method === "PUT") {
        writes.push("metadata");

        return Response.json({ error_message: "Location note save failed" }, { status: 503 });
      }

      return undefined;
    },
    config,
  );
  await userEvent.type(await screen.findByLabelText("Name"), "Kitchen");
  await userEvent.type(screen.getByLabelText("Owner note"), "Pending note");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toEqual(["primary", "metadata"]));
  await act(async () => {});
  expect(screen.queryByText(/Location note save failed|The record is saved/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(parent).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
});

test("store file upload is gated by metadata and retires with its real selected document", async () => {
  const metadata = referenceGate();
  const upload = referenceGate();

  const calls: {
    stage: string;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
    value?: string;
  }[] = [];

  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const app = mountNativeEditor(
    "/shoppinglocation/5?embedded",
    async (url, init) => {
      if (
        url === "/api/v2/custom-data/fields" ||
        url === "/api/objects/userfields" ||
        url === "/api/objects/userfields?query[]=entity=shopping_locations"
      )
        return Response.json([
          {
            ...notesField("shopping_locations"),
            name: "document",
            caption: "Store document",
            type: "file",
          },
        ]);

      if (url === "/api/objects/shopping_locations/5" && init?.method !== "PUT")
        return Response.json({ id: 5, name: "Store", active: 1, description: "" });

      if (url === "/api/userfields/shopping_locations/5" && init?.method !== "PUT")
        return Response.json({});

      if (url === "/api/objects/shopping_locations/5" && init?.method === "PUT")
        return new Response(null, { status: 204 });

      if (url === "/api/userfields/shopping_locations/5" && init?.method === "PUT") {
        calls.push({
          stage: "metadata",
          signal: init.signal,
          value: JSON.parse(String(init.body)).document,
        });
        await metadata.promise;

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/files/userfiles/") && init?.method === "PUT") {
        calls.push({ stage: "upload", body: init.body, signal: init.signal });
        await upload.promise;

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    config,
  );

  await screen.findByLabelText("Name");
  const file = new File(["Store attachment proof"], "store.pdf", { type: "application/pdf" });
  await userEvent.upload(screen.getByLabelText("Store document"), file);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(atob(calls[0]!.value!.split("_")[1]!)).toBe("store.pdf");
  await act(async () => metadata.release());
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]!.body).toBe(file);
  expect(parent).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  await act(async () => app.router.navigate({ href: "/location/new" }));
  await screen.findByRole("heading", { name: "Create location" });
  app.client.setQueryData(["objects", "shopping_locations"], [{ id: 5, name: "Fresh store read" }]);
  expect(calls[1]!.signal?.aborted).toBe(true);
  await act(async () => upload.release());
  expect(app.client.getQueryState(["objects", "shopping_locations"])?.isInvalidated).toBe(true);
  expect(parent).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
});
