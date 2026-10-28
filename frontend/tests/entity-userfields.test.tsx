import { supportProductOptions } from "./fixtures/product-options";
import { supportDescriptionEditors } from "./fixtures/editor";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EntityManager } from "@/components/EntityManager";
import type { EntityRow } from "@/lib/entities";
import type { JsonObject } from "@/lib/json";
import { pictureBytes } from "./fixtures/picture";

function field(id: number, name: string, type: string, overrides: JsonObject = {}) {
  return {
    id,
    entity: "products",
    name,
    caption: name,
    type,
    input_required: 0,
    default_value: null,
    config: null,
    sort_number: id,
    ...overrides,
  };
}

function mount(entity: string) {
  supportProductOptions();
  supportDescriptionEditors();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EntityManager entity={entity} />
    </QueryClientProvider>,
  );
}

test("product creation retries a custom file on the saved row before its picture", async () => {
  const writes: string[] = [];
  const rows: EntityRow[] = [];
  const savedFields: Record<string, string> = {};
  savedFields.Untouched = "Database default";
  const storedFiles = new Map<string, BodyInit | null | undefined>();
  let fileAttempts = 0;
  const upload = new File(["Product manual"], "Manual.TXT", { type: "text/plain" });
  const picture = new File([pictureBytes], "product.png", { type: "image/png" });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:product";
      static revokeObjectURL = () => {};
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/objects/userfields")
        return Response.json([
          field(3, "Manual", "file"),
          field(2, "Untouched", "text-single-line", { default_value: "Configured default" }),
          field(1, "Confirmed", "checkbox", { input_required: 1 }),
        ]);

      if (path === "/api/objects/quantity_units") return Response.json([{ id: 1, name: "Piece" }]);

      if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

      if (path === "/api/objects/products" && init?.method === "POST") {
        writes.push("create");
        rows.push({ ...JSON.parse(String(init.body)), id: 42 });

        return Response.json({ created_object_id: "42" });
      }

      if (path === "/api/objects/products/42" && init?.method === "PUT") {
        writes.push("update");
        Object.assign(rows[0]!, JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      if (path === "/api/userfields/products/42" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push(`field:${Object.keys(body).join(",")}`);
        Object.assign(savedFields, body);

        return new Response(null, { status: 204 });
      }

      if (path.startsWith("/api/files/") && init?.method === "PUT") {
        const group = path.split("/")[3];
        writes.push(`file:${group}`);

        if (group === "userfiles" && ++fileAttempts === 1)
          return Response.json({ error_message: "Manual upload failed" }, { status: 500 });
        storedFiles.set(path, init.body);

        return new Response(null, { status: 204 });
      }

      if (path === "/api/objects/products") return Response.json(rows);

      return Response.json([]);
    }),
  );
  mount("products");
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add product" }).disabled).toBe(
      false,
    ),
  );
  await user.click(screen.getByRole("button", { name: "Add product" }));
  expect(screen.getByLabelText<HTMLInputElement>("Untouched").value).toBe("");
  const fields = within(screen.getByRole("group", { name: "Userfields" }));
  expect(
    fields.getAllByText(/Confirmed|Untouched|Manual/).map((element) => element.textContent),
  ).toEqual(["Confirmed", "Untouched", "Manual"]);
  await user.type(screen.getByLabelText("Name"), "Coffee");
  await user.selectOptions(screen.getByLabelText("Default location"), "1");
  await user.selectOptions(screen.getByLabelText("Stock unit"), "1");
  await user.click(screen.getByLabelText("Confirmed"));
  await user.click(screen.getByLabelText("Confirmed"));
  await user.upload(screen.getByLabelText("Manual"), upload);
  await user.upload(screen.getByLabelText("Product picture"), picture);
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await screen.findByText("Manual upload failed");
  expect(rows).toHaveLength(1);
  expect(writes).toEqual(["create", "field:Confirmed", "field:Manual", "file:userfiles"]);
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Edit product" })).toBeNull());
  expect(writes).toEqual([
    "create",
    "field:Confirmed",
    "field:Manual",
    "file:userfiles",
    "update",
    "field:Manual",
    "file:userfiles",
    "file:productpictures",
  ]);
  expect(savedFields).toMatchObject({ Confirmed: "0", Untouched: "Database default" });
  const [fileName, displayName] = savedFields.Manual!.split("_").map((value) => atob(value));
  expect(displayName).toBe("manual.txt");
  expect(storedFiles.get(`/api/files/userfiles/${encodeURIComponent(btoa(fileName!))}`)).toBe(
    upload,
  );
  expect(
    storedFiles.get(
      `/api/files/productpictures/${encodeURIComponent(btoa(String(rows[0]?.picture_file_name)))}`,
    ),
  ).toBe(picture);
});

test("editing loads numeric custom names and writes only changed values", async () => {
  const fields = [
    field(3, "Z", "text-single-line", { entity: "locations", sort_number: 1 }),
    field(2, "0", "text-single-line", { entity: "locations", sort_number: null }),
    field(4, "a", "text-single-line", { entity: "locations", sort_number: 1 }),
    field(1, "1", "checkbox", { entity: "locations", input_required: 1, sort_number: null }),
    field(5, "😀", "text-single-line", { entity: "locations", sort_number: 1 }),
    field(6, "\uE000", "text-single-line", { entity: "locations", sort_number: 1 }),
  ];

  const writes: JsonObject[] = [];
  const row = { id: 1, name: "Shelf", userfields: ["Stored value", "0"] };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/objects/userfields") return Response.json(fields);

      if (path === "/api/objects/locations") return Response.json([row]);

      if (path === "/api/objects/locations/1" && init?.method === "PUT")
        return new Response(null, { status: 204 });

      if (path === "/api/userfields/locations/1" && init?.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  mount("locations");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Shelf/ }));
  expect(screen.getByLabelText<HTMLInputElement>("0").value).toBe("Stored value");
  expect(screen.getByLabelText<HTMLInputElement>("1").required).toBe(false);
  const group = within(screen.getByRole("group", { name: "Userfields" }));
  expect(group.getAllByText(/^(0|1|a|Z|\uE000|😀)$/).map((element) => element.textContent)).toEqual(
    ["0", "1", "a", "Z", "\uE000", "😀"],
  );
  await user.type(screen.getByLabelText("0"), " changed");
  await user.click(screen.getByRole("button", { name: "Save location" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Edit location" })).toBeNull());
  expect(writes).toEqual([{ "0": "Stored value changed" }]);
});

test("a custom record type change uses its own field names and retains shared edits", async () => {
  const writes: { path: string; body: JsonObject }[] = [];

  const definitions = [
    field(1, "Status", "text-single-line", { entity: "userobjects", caption: "Shared status" }),
    field(2, "Status", "text-single-line", { entity: "userentity-first", caption: "First status" }),
    field(3, "Status", "text-single-line", {
      entity: "userentity-second",
      caption: "Second status",
      default_value: "Unused default",
    }),
  ];

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/objects/userfields") return Response.json(definitions);

      if (path === "/api/objects/userentities")
        return Response.json([
          { id: 1, name: "first" },
          { id: 2, name: "second" },
        ]);

      if (path === "/api/objects/userobjects")
        return Response.json([{ id: 3, userentity_id: 1, userfields: { Status: "Shared old" } }]);

      if (path === "/api/userfields/userentity-first/3")
        return Response.json({ Status: "First old" });

      if (init?.method === "PUT") {
        writes.push({ path, body: JSON.parse(String(init.body)) });

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  mount("userobjects");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*3/ }));
  expect(screen.getByLabelText<HTMLInputElement>("First status").value).toBe("First old");
  await user.type(screen.getByLabelText("Shared status"), " changed");
  await user.type(screen.getByLabelText("First status"), " discarded");
  await user.selectOptions(screen.getByLabelText("Record type"), "2");
  expect(screen.getByLabelText<HTMLInputElement>("Second status").value).toBe("");
  await user.type(screen.getByLabelText("Second status"), "Second new");
  await user.click(screen.getByRole("button", { name: "Save record" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Edit record" })).toBeNull());
  expect(writes).toEqual([
    { path: "/api/objects/userobjects/3", body: { userentity_id: 2 } },
    { path: "/api/userfields/userobjects/3", body: { Status: "Shared old changed" } },
    { path: "/api/userfields/userentity-second/3", body: { Status: "Second new" } },
  ]);
});

test("Manage retains the list name until custom fields save and retries only unfinished writes", async () => {
  const row = { id: 7, name: "Trip", userfields: { Delivery: "Normal" } };
  const writes: string[] = [];
  let fieldAttempts = 0;
  let nameAttempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/objects/shopping_lists") return Response.json([row]);

      if (path === "/api/objects/userfields")
        return Response.json([
          field(1, "Delivery", "text-single-line", { entity: "shopping_lists" }),
        ]);

      if (path === "/api/userfields/shopping_lists/7" && init?.method === "PUT") {
        writes.push("field");

        if (++fieldAttempts === 1)
          return Response.json({ error_message: "Field save failed" }, { status: 500 });
        Object.assign(row.userfields, JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      if (path === "/api/objects/shopping_lists/7" && init?.method === "PUT") {
        writes.push("name");

        if (++nameAttempts === 1)
          return Response.json({ error_message: "Name save failed" }, { status: 500 });
        Object.assign(row, JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  mount("shopping_lists");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Trip/ }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "New trip");
  await user.clear(screen.getByLabelText("Delivery"));
  await user.type(screen.getByLabelText("Delivery"), "Side");
  await user.click(screen.getByRole("button", { name: "Save shopping list" }));
  await screen.findByText("Field save failed");
  expect(row).toEqual({ id: 7, name: "Trip", userfields: { Delivery: "Normal" } });
  await user.click(screen.getByRole("button", { name: "Save shopping list" }));
  await screen.findByText("Name save failed");
  expect(row).toEqual({ id: 7, name: "Trip", userfields: { Delivery: "Side" } });
  await user.click(screen.getByRole("button", { name: "Save shopping list" }));
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "Edit shopping list" })).toBeNull(),
  );
  expect(row.name).toBe("New trip");
  expect(writes).toEqual(["field", "field", "name", "name"]);
});
