import { supportProductOptions } from "./fixtures/product-options";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { EntityManager } from "@/components/EntityManager";
import { writeApiConfig } from "@/lib/config";
import type { EntityRow } from "@/lib/entities";
import type { JsonObject } from "@/lib/json";

type Entity = "products" | "recipes" | "equipment";

function mount(entity: Entity, { documentFailure = false, saveFailure = false } = {}) {
  writeApiConfig({ baseUrl: "/house", apiKey: "description-key" });

  const row: EntityRow = {
    id: 7,
    name: "Coffee",
    description: "<p>Saved <strong>text</strong></p>",
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    base_servings: 1,
    desired_servings: 1,
  };

  const writes: JsonObject[] = [];
  const documents: string[] = [];
  let documentAttempts = 0;
  let saveAttempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://test.invalid").pathname.replace(/^\/house/, "");

      if (path === `/api/v2/content/${entity}/editor`) {
        expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe("description-key");
        const body = JSON.parse(String(init?.body));
        documents.push(body.html);

        if (documentFailure && ++documentAttempts === 1)
          return new Response("Unavailable", { status: 503, statusText: "Editor unavailable" });

        return new Response("<!doctype html><html><body>Editor document</body></html>");
      }

      if (path === `/api/objects/${entity}/7` && init?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(init.body));
        writes.push(body);

        if (saveFailure && ++saveAttempts === 1)
          return Response.json({ error_message: "Record save failed" }, { status: 503 });
        Object.assign(row, body);

        return new Response(null, { status: 204 });
      }

      if (path === `/api/objects/${entity}`) return Response.json([{ ...row }]);

      if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

      if (path === "/api/objects/quantity_units") return Response.json([{ id: 1, name: "Piece" }]);

      if (path === `/api/v2/content/${entity}`)
        return Response.json([{ id: 7, html: row.description }]);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/user/settings") return Response.json({});

      return Response.json([]);
    }),
  );
  supportProductOptions();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const app = render(
    <QueryClientProvider client={client}>
      <EntityManager entity={entity} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return { row, writes, documents };
}

function message(
  frame: HTMLIFrameElement,
  kind: "ready" | "change" | "resize",
  html: string,
  origin = "null",
  source: MessageEventSource | null = frame.contentWindow,
) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        origin,
        data: {
          channel: "grocy-description",
          kind,
          html,
          empty: false,
          height: 420,
          fullscreen: false,
        },
      }),
    );
  });
}

async function edit() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  const frame = await screen.findByTitle<HTMLIFrameElement>("Description");

  return { user, frame };
}

const entities = ["products", "recipes", "equipment"] as const;
const singular = { products: "product", recipes: "recipe", equipment: "equipment item" };

test.each(entities)(
  "%s waits for its own editor and preserves untouched stored HTML",
  async (entity) => {
    const { row, writes, documents } = mount(entity);
    const original = row.description;
    expect(await screen.findByText("text", { selector: "strong" })).toBeTruthy();
    const { user, frame } = await edit();

    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: `Save ${singular[entity]}`,
    });

    expect(save.disabled).toBe(true);
    message(frame, "ready", "Foreign", "null", window);
    message(frame, "ready", "Foreign", "http://test.invalid");
    expect(save.disabled).toBe(true);
    message(frame, "ready", "<p>Editor normalization</p>");
    await waitFor(() => expect(save.disabled).toBe(false));
    message(frame, "resize", "<p>Unclosed source draft</p>");
    await user.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.description).toBe(original);
    expect(row.description).toBe(original);
    expect(documents).toEqual([original]);
  },
);

test("description document and record failures retain the draft for retry and reload the saved value", async () => {
  const { row, writes, documents } = mount("products", {
    documentFailure: true,
    saveFailure: true,
  });

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  await screen.findByText("Editor unavailable");
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save product" });
  expect(save.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  const frame = await screen.findByTitle<HTMLIFrameElement>("Description");
  message(frame, "ready", "");
  await waitFor(() => expect(save.disabled).toBe(false));
  const draft = '<p><a href="https://example.com">Draft</a></p>';
  message(frame, "change", draft);
  expect(row.description).toBe("<p>Saved <strong>text</strong></p>");
  await user.click(save);
  await screen.findByText("Record save failed");
  expect(screen.getByTitle("Description")).toBe(frame);
  await user.click(save);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes.map((body) => body.description)).toEqual([draft, draft]);
  expect(row.description).toBe(draft);
  await user.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  const nextFrame = await screen.findByTitle<HTMLIFrameElement>("Description");
  expect(nextFrame).not.toBe(frame);
  message(frame, "change", "Stale frame");
  message(nextFrame, "ready", "Normalized");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save product" }).disabled).toBe(
      false,
    ),
  );
  message(nextFrame, "change", "");
  await user.click(screen.getByRole("button", { name: "Save product" }));
  await waitFor(() => expect(writes).toHaveLength(3));
  expect(writes[2]?.description).toBe("");
  expect(documents).toEqual([
    "<p>Saved <strong>text</strong></p>",
    "<p>Saved <strong>text</strong></p>",
    draft,
  ]);
});
