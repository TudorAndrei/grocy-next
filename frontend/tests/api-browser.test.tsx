import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { writeApiConfig } from "@/lib/config";
import { mountNativeEditor } from "./fixtures/native-editor";

function mountBrowser({ hash = "", heldSpec = false, deniedSpec = false } = {}) {
  writeApiConfig({ baseUrl: "", apiKey: "connected-key" });
  const tasks: { id: number; name: string }[] = [];
  const calls: { path: string; method: string; key: string | null }[] = [];
  const signals: (AbortSignal | null | undefined)[] = [];
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let userReads = 0;

  const spec = {
    openapi: "3.0.3",
    info: { title: "Grocy local API", version: "4.5.0" },
    servers: [{ url: "/api" }],
    components: {
      securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "GROCY-API-KEY" } },
      schemas: { Task: { type: "object", properties: { name: { type: "string" } } } },
    },
    paths: {
      "/system/info": {
        get: {
          tags: ["system"],
          summary: "Inspect household API",
          operationId: "inspectSystem",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: "Current system",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/objects/tasks": {
        post: {
          tags: ["tasks"],
          summary: "Create household task",
          operationId: "createTask",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } },
          },
          responses: {
            200: {
              description: "Created task",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
        get: {
          tags: ["tasks"],
          summary: "Read household tasks",
          operationId: "readTasks",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: "Saved tasks",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                },
              },
            },
          },
        },
      },
    },
  };

  const app = mountNativeEditor(`/api${hash}`, async (url, options) => {
    const path = new URL(url, window.location.href).pathname;

    if (path === "/api/user") {
      userReads++;

      return Response.json([{ id: 7, username: "owner" }]);
    }

    if (path === "/api/openapi/specification") {
      signals.push(options?.signal);
      calls.push({
        path,
        method: options?.method ?? "GET",
        key: new Headers(options?.headers).get("GROCY-API-KEY"),
      });

      if (heldSpec) await gate;

      return deniedSpec || new Headers(options?.headers).get("GROCY-API-KEY") !== "connected-key"
        ? Response.json({ error_message: "Specification denied" }, { status: 403 })
        : Response.json(spec);
    }

    if (path === "/api/system/info" || path === "/api/objects/tasks") {
      const key = new Headers(options?.headers).get("GROCY-API-KEY");
      const method = (options?.method ?? "GET").toUpperCase();
      calls.push({ path, method, key });

      if (key !== "typed-key")
        return Response.json(
          { error_message: "Missing explicit Swagger credential" },
          { status: 401 },
        );

      if (path === "/api/system/info") return Response.json({ marker: "executed-with-typed-key" });

      if (method === "POST") {
        const body = JSON.parse(String(options?.body));
        tasks.push({ id: 1, name: body.name });

        return Response.json({ created_object_id: "1" });
      }

      return Response.json(tasks);
    }

    return undefined;
  });

  return { ...app, calls, signals, release, tasks, userReads: () => userReads };
}

async function bootBrowser() {
  const frame = await screen.findByTitle<HTMLIFrameElement>("REST API browser");
  expect(new URL(frame.src).pathname).toBe("/vendor/swagger-ui/index.html");
  const transport = frame.contentWindow!;
  // Replace static-file and browser-message transport only; execute the unchanged runtime.

  const html = readFileSync(resolve("public/vendor/swagger-ui/index.html"), "utf8").replace(
    /<script\b[^>]*src=[^>]*><\/script>/g,
    "",
  );

  const document = new JSDOM(html, {
    url: frame.src,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  const browser = document.window;
  Object.defineProperty(browser, "parent", { configurable: true, value: window });
  Object.assign(browser, {
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    Headers,
    Request,
    Response,
    AbortController,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    scrollTo: () => {},
  });
  vi.spyOn(transport, "postMessage").mockImplementation((data) => {
    browser.dispatchEvent(
      new browser.MessageEvent("message", { data, origin: window.location.origin, source: window }),
    );
  });
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin: window.location.origin, source: transport }),
    );
  });

  for (const file of [
    "swagger-ui-bundle.js",
    "swagger-ui-standalone-preset.js",
    "grocy-initializer.js",
  ])
    browser.eval(readFileSync(resolve(`public/vendor/swagger-ui/${file}`), "utf8"));
  const style = browser.document.createElement("style");
  style.textContent = readFileSync(resolve("public/vendor/swagger-ui/grocy.css"), "utf8");
  browser.document.head.append(style);
  onTestFinished(() => {
    browser.dispatchEvent(new browser.Event("pagehide"));
    browser.close();
  });
  fireEvent.load(frame);

  return { frame, browser, ui: within(browser.document.body) };
}

async function authorize(ui: Awaited<ReturnType<typeof bootBrowser>>["ui"]) {
  await userEvent.click(await ui.findByRole("button", { name: /^Authorize$/ }));

  const modal = (await ui.findByText("Available authorizations")).closest<HTMLElement>(
    ".dialog-ux",
  )!;

  await userEvent.type(within(modal).getByRole("textbox"), "typed-key");
  await userEvent.click(within(modal).getByRole("button", { name: "Apply credentials" }));
  await userEvent.click(within(modal).getByRole("button", { name: "Close" }));
}

test("the native API browser runs the pinned Swagger UI, loads an authenticated spec and executes an explicitly authorized request", async () => {
  const app = mountBrowser();
  const { browser, ui } = await bootBrowser();
  await ui.findByText("Grocy local API");
  expect(
    app.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/system/db-changed-time")),
  ).toBe(false);
  expect(browser.document.querySelector(".topbar")).toBeNull();
  expect(browser.document.querySelector(".models")).toBeNull();
  expect(browser.getComputedStyle(browser.document.querySelector(".servers")!).display).toBe(
    "none",
  );
  await authorize(ui);
  await userEvent.click(ui.getByText("Inspect household API"));
  await userEvent.click(await ui.findByRole("button", { name: "Try it out" }));
  await userEvent.click(await ui.findByRole("button", { name: "Execute" }));
  await ui.findByText(/executed-with-typed-key/);
  expect(app.calls).toContainEqual({
    path: "/api/openapi/specification",
    method: "GET",
    key: "connected-key",
  });
  expect(app.calls).toContainEqual({ path: "/api/system/info", method: "GET", key: "typed-key" });
  await waitFor(() => expect(app.router.history.location.hash).toBe("#/system/inspectSystem"));
  expect(app.fetchMock.mock.calls.some(([url]) => String(url).includes("validator.swagger"))).toBe(
    false,
  );
});

test("a native Swagger deep link executes a JSON mutation and reads the saved result without refetching parent auth", async () => {
  const app = mountBrowser({ hash: "#/tasks/createTask" });
  const { ui } = await bootBrowser();
  await ui.findByText("Grocy local API");
  await authorize(ui);

  const operation = (await ui.findByText("Create household task")).closest<HTMLElement>(
    ".opblock",
  )!;

  await userEvent.click(await within(operation).findByRole("button", { name: "Try it out" }));
  fireEvent.change(within(operation).getByRole("textbox"), {
    target: { value: '{"name":"Swagger task"}' },
  });
  app.client.setQueryData(["tasks", false], []);
  const userReads = app.userReads();
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://foreign.invalid",
        source: screen.getByTitle<HTMLIFrameElement>("REST API browser").contentWindow,
        data: { channel: "grocy-api-browser", kind: "mutation" },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: window,
        data: { channel: "grocy-api-browser", kind: "mutation" },
      }),
    );
  });
  expect(app.client.getQueryState(["tasks", false])?.isInvalidated).toBe(false);
  await userEvent.click(within(operation).getByRole("button", { name: "Execute" }));
  await within(operation).findByText(/created_object_id/);
  expect(app.tasks).toEqual([{ id: 1, name: "Swagger task" }]);
  expect(app.client.getQueryState(["tasks", false])?.isInvalidated).toBe(true);
  expect(app.userReads()).toBe(userReads);
  await userEvent.click(ui.getByText("Read household tasks"));
  const read = ui.getByText("Read household tasks").closest<HTMLElement>(".opblock")!;
  await userEvent.click(await within(read).findByRole("button", { name: "Try it out" }));
  await userEvent.click(await within(read).findByRole("button", { name: "Execute" }));
  await within(read).findByText(/Swagger task/);
});

test("the actual Swagger error view reports a denied specification without exposing operations", async () => {
  mountBrowser({ deniedSpec: true });
  const { ui } = await bootBrowser();
  await ui.findByText(/Failed to load API definition/);
  expect(ui.queryByText("Inspect household API")).toBeNull();
});

test("leaving the Swagger document aborts a held request and marks uncertain cached writes stale", async () => {
  const app = mountBrowser({ heldSpec: true });
  await bootBrowser();
  await waitFor(() => expect(app.calls).toHaveLength(1));
  app.client.setQueryData(["stock", "overview"], []);
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  expect(app.signals[0]?.aborted).toBe(true);
  expect(app.client.getQueryState(["stock", "overview"])?.isInvalidated).toBe(true);
  const callsAtDeparture = [...app.calls];
  await act(async () => app.release());
  expect(app.calls).toEqual(callsAtDeparture);
  expect(document.querySelector('iframe[title="REST API browser"]')).toBeNull();
});
