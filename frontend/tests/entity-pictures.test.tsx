import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EntityManager } from "@/components/EntityManager";
import type { EntityRow } from "@/lib/entities";
import type { JsonObject } from "@/lib/json";

function mount(entity: string) {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:picture");
      static revokeObjectURL = vi.fn();
    },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EntityManager entity={entity} />
    </QueryClientProvider>,
  );
}

const image = () =>
  new File(
    [
      Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1foAAAAASUVORK5CYII=",
        ),
        (character) => character.charCodeAt(0),
      ),
    ],
    "picture.png",
    { type: "image/png" },
  );

test.each([
  ["products", "product", "productpictures"],
  ["recipes", "recipe", "recipepictures"],
])(
  "%s pictures can be replaced and removed through the editor",
  async (entity, singular, group) => {
    const row: EntityRow = {
      id: 1,
      name: "Item",
      picture_file_name: "old.png",
      location_id: 1,
      qu_id_stock: 1,
      qu_id_purchase: 1,
      base_servings: 1,
      desired_servings: 1,
    };

    const writes: string[] = [];
    const upload = image();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input);

        if (path === "/api/system/config") return Response.json({});

        if (path === `/api/objects/${entity}/1` && init?.method === "PUT") {
          writes.push("record");
          const body: JsonObject = JSON.parse(String(init.body));
          Object.assign(row, body);

          return new Response(null, { status: 204 });
        }

        if (path.startsWith(`/api/files/${group}/`)) {
          expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe("dev-key");

          if (init?.method === "PUT") {
            writes.push("upload");
            expect(init.body).toBe(upload);
            expect(atob(decodeURIComponent(path.split("/").at(-1)!))).toBe(row.picture_file_name);
          } else if (init?.method === "DELETE") {
            expect(atob(decodeURIComponent(path.split("/").at(-1)!))).toBe(row.picture_file_name);
            writes.push("remove");
          } else return new Response(upload, { headers: { "Content-Type": "image/png" } });

          return new Response(null, { status: 204 });
        }

        if (path === `/api/objects/${entity}`) return Response.json([row]);

        if (path === "/api/objects/quantity_units")
          return Response.json([{ id: 1, name: "Piece" }]);

        if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

        return Response.json([]);
      }),
    );
    mount(entity);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Edit.*Item/ }));
    await user.upload(
      screen.getByLabelText(`${singular === "product" ? "Product" : "Recipe"} picture`),
      upload,
    );
    await user.click(screen.getByRole("button", { name: `Save ${singular}` }));
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: `Edit ${singular}` })).toBeNull(),
    );
    expect(writes).toEqual(["record", "upload"]);
    expect(row.picture_file_name).not.toBe("old.png");
    await user.click(screen.getByRole("button", { name: /Edit.*Item/ }));
    await user.click(screen.getByRole("button", { name: "Remove picture" }));
    await user.click(screen.getByRole("button", { name: `Save ${singular}` }));
    await waitFor(() => expect(row.picture_file_name).toBeNull());
    expect(writes).toEqual(["record", "upload", "remove", "record"]);
  },
);

test("a failed picture upload can retry without a second recipe record", async () => {
  const rows: EntityRow[] = [];
  let creates = 0;
  let updates = 0;
  let uploads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/objects/recipes" && init?.method === "POST") {
        creates++;
        rows.push({ ...JSON.parse(String(init.body)), id: 42 });

        return Response.json({ created_object_id: "42" });
      }

      if (path === "/api/objects/recipes/42" && init?.method === "PUT") {
        updates++;
        Object.assign(rows[0]!, JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      if (path.startsWith("/api/files/recipepictures/") && init?.method === "PUT") {
        uploads++;

        return uploads === 1
          ? Response.json({ error_message: "Upload failed." }, { status: 500 })
          : new Response(null, { status: 204 });
      }

      if (path === "/api/objects/recipes") return Response.json(rows);

      return Response.json([]);
    }),
  );
  mount("recipes");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add recipe" }));
  await user.type(screen.getByLabelText("Name"), "Soup");
  await user.upload(screen.getByLabelText("Recipe picture"), image());
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  await screen.findByText("Upload failed.");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.picture_file_name).toEqual(expect.any(String));
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Edit recipe" })).toBeNull());
  expect({ creates, updates, uploads }).toEqual({ creates: 1, updates: 1, uploads: 2 });
});

test("picture removal updates the recipe when file deletion fails", async () => {
  let saved: JsonObject | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/objects/recipes")
        return Response.json([
          {
            id: 1,
            name: "Soup",
            base_servings: 1,
            desired_servings: 1,
            picture_file_name: "saved.png",
          },
        ]);

      if (path === "/api/objects/recipes/1" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body));

        return new Response(null, { status: 204 });
      }

      if (path.startsWith("/api/files/recipepictures/") && init?.method === "DELETE")
        return Response.json({ error_message: "Picture removal failed." }, { status: 500 });

      return Response.json([]);
    }),
  );
  mount("recipes");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Soup/ }));
  await user.click(screen.getByRole("button", { name: "Remove picture" }));
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  await screen.findByText("Picture removal failed.");
  expect(saved?.picture_file_name).toBeNull();
});
