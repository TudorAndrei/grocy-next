import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { notifyManager } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { queryKeys } from "@/lib/api";
import { mountNativeEditor } from "./fixtures/native-editor";
import { nativeProductContext } from "./fixtures/native-product";
import { supportDescriptionEditors } from "./fixtures/editor";
import { pictureBytes } from "./fixtures/picture";

const A = "2026-11-07 10:00:00";
const B = "2026-11-07 11:00:00";
const C = "2026-11-07 11:30:00";
const stamp = (changed_time: string) => Response.json({ changed_time });

function held() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mount(
  options: {
    auto?: string;
    userId?: number;
    replies?: (Response | Promise<Response>)[];
    path?: string;
  } = {},
) {
  // Keep RTL/user-event timeouts real while controlling the native counters.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:native-db-picture";
      static revokeObjectURL = () => {};
    },
  );
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const replies = options.replies?.slice() ?? [];
  const requests: { signal: AbortSignal | null | undefined }[] = [];
  const contexts: string[] = [];
  const metadata = { settings: 0, config: 0 };
  const writes: string[] = [];
  let currentTime = A;
  let name = "Coffee";

  const settings = {
    auto_reload_on_db_change: options.auto ?? "1",
    stock_decimal_places_amounts: 2,
  };

  const config = {
    FEATURE_FLAG_STOCK: true,
    FEATURE_FLAG_SHOPPINGLIST: false,
    FEATURE_FLAG_LABEL_PRINTER: false,
  };

  const references = {
    locations: [{ id: 1, name: "Shelf" }],
    quantity_units: [{ id: 1, name: "Piece" }],
    shopping_locations: [],
    product_groups: [],
    products: [],
  };

  const fields = [
    {
      id: 1,
      entity: "products",
      name: "notes",
      caption: "Notes",
      type: "text-multi-line",
      input_required: 0,
      default_value: null,
      config: null,
    },
  ];

  const app = mountNativeEditor(
    options.path ?? "/product/07?embedded&keep=%26value&flag#tail",
    (url, init) => {
      if (url === "/api/user")
        return Response.json([{ id: options.userId ?? 7, username: "owner" }]);

      if (url === "/api/system/db-changed-time") {
        requests.push({ signal: init?.signal });

        return replies.shift() ?? stamp(currentTime);
      }

      if (url.startsWith("/api/v2/products/native-editor?")) {
        const row = new URL(url, window.location.origin).searchParams.get("row");
        contexts.push(row ?? "");

        return Response.json(
          nativeProductContext({
            product: {
              id: Number(row),
              name: row === "8" ? "Other coffee" : name,
              active: 1,
              description: "",
              userfields: { notes: "Saved note" },
              location_id: 1,
              qu_id_stock: 1,
              qu_id_purchase: 1,
              qu_id_consume: 1,
              qu_id_price: 1,
              min_stock_amount: 0,
              picture_file_name: null,
              default_stock_label_type: 0,
            },
            references,
            fields,
            user_settings: settings,
            config,
          }),
        );
      }

      if (url === "/api/user/settings") {
        metadata.settings++;

        return Response.json(settings);
      }

      if (url === "/api/system/config") {
        metadata.config++;

        return Response.json(config);
      }

      if (url.includes("/grocycode"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

      if (url === "/api/v2/custom-data/fields") return Response.json(fields);

      if (/^\/api\/objects\/products\/\d+$/.test(url) && init?.method === "PUT") {
        writes.push(url);

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    config,
  );

  supportDescriptionEditors();

  return {
    ...app,
    requests,
    contexts,
    metadata,
    writes,
    errors,
    change: (time: string, nextName = "Fresh coffee") => {
      currentTime = time;
      name = nextName;
    },
    enable: async () => {
      settings.auto_reload_on_db_change = "on";
      await act(async () => {
        await app.client.refetchQueries({ queryKey: queryKeys.userSettings, type: "active" });
        // Fetch completion precedes observer notification. Commit the live setting
        // before advancing the separately faked minute and idle counters.
        await new Promise<void>((resolve) => notifyManager.schedule(resolve));
      });
    },
  };
}

async function ready() {
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save & continue" }).disabled,
    ).toBe(false),
  );

  return name;
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function release(gate: ReturnType<typeof held>, response: Response) {
  await act(async () => {
    gate.release(response);
  });
}

async function fresh() {
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Fresh coffee"),
  );
}

test("native polling waits sixty seconds, ignores visibility, and reloads the same raw URL at fifty idle ticks", async () => {
  const poll = held();
  const app = mount({ replies: [stamp(A), poll.promise] });
  const name = await ready();
  await waitFor(() => expect(app.requests).toHaveLength(1));
  const metadata = { ...app.metadata };
  await advance(5000);
  await act(async () => {
    fireEvent(document, new Event("visibilitychange"));
  });
  expect(app.requests).toHaveLength(1);
  expect(app.metadata).toEqual(metadata);
  expect(app.contexts).toEqual(["07"]);
  await advance(5000);
  fireEvent.mouseMove(window);
  await advance(49_999);
  expect(app.requests).toHaveLength(1);
  app.change(B);
  await advance(1);
  expect(app.requests).toHaveLength(2);
  await release(poll, stamp(B));
  await fresh();
  expect(name.isConnected).toBe(false);
  expect(app.contexts).toEqual(["07", "07"]);
  expect(app.router.history.location.href).toBe("/product/07?embedded&keep=%26value&flag#tail");
  expect(app.writes).toEqual([]);
});

test.each(["activity", "preference"])(
  "a newer timestamp blocked by %s is consumed, equal and older replies do not replay it",
  async (reason) => {
    const poll = held();

    const app = mount({
      auto: reason === "preference" ? "false" : "1",
      replies: [stamp(A), poll.promise, stamp(B), stamp(A), stamp(B), stamp(C)],
    });

    const name = await ready();

    if (reason === "activity") {
      await advance(11_000);
      window.dispatchEvent(new CustomEvent("grocy-native-activity"));
      await advance(49_000);
    } else await advance(60_000);
    expect(app.requests).toHaveLength(2);
    await release(poll, stamp(B));
    expect(app.contexts).toHaveLength(1);
    expect(name.isConnected).toBe(true);

    if (reason === "preference") await app.enable();

    for (let index = 0; index < 3; index++) {
      await advance(60_000);
      expect(app.contexts).toHaveLength(1);
    }

    app.change(C);
    await advance(60_000);
    await fresh();
    expect(app.contexts).toHaveLength(2);
  },
);

test.each(["restored input", "select click", "textarea paste"])(
  "native %s keeps its form dirty and blocks database reloads",
  async (action) => {
    const app = mount();
    const name = await ready();

    if (action === "restored input") {
      await userEvent.type(name, " draft");
      await userEvent.clear(name);
      await userEvent.type(name, "Coffee");
    } else if (action === "select click")
      await userEvent.click(screen.getByLabelText("Stock unit"));
    else fireEvent.paste(screen.getByLabelText("Notes"));
    const form = name.closest("form")!;
    expect(form.classList.contains("is-dirty")).toBe(true);
    expect(name.value).toBe("Coffee");
    app.change(B);
    await advance(60_000);
    app.change(C);
    await advance(60_000);
    expect(app.requests).toHaveLength(3);
    expect(app.contexts).toHaveLength(1);
    expect(name.isConnected).toBe(true);
  },
);

test("fullscreen blocks a change once and leaving fullscreen does not replay its consumed timestamp", async () => {
  const app = mount();
  await ready();
  const editor = await screen.findByTitle<HTMLIFrameElement>("Description");
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: editor.contentWindow,
        origin: "null",
        data: {
          channel: "grocy-description",
          kind: "resize",
          html: "",
          empty: true,
          height: 390,
          fullscreen: true,
        },
      }),
    );
  });
  expect(document.body.classList.contains("fullscreen-card")).toBe(true);
  app.change(B);
  await advance(60_000);
  expect(app.contexts).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Leave fullscreen" }));
  await advance(60_000);
  expect(app.contexts).toHaveLength(1);
  app.change(C);
  await advance(60_000);
  await fresh();
});

test("user minus one skips only the initial read and still polls when automatic reload is disabled", async () => {
  const app = mount({ userId: -1, auto: "false" });
  await ready();
  expect(app.requests).toHaveLength(0);
  await advance(60_000);
  expect(app.requests).toHaveLength(1);
  expect(app.contexts).toHaveLength(1);
});

test("initial and polling errors are console-only, and an absent baseline compares against the current moment", async () => {
  const failed = () => Response.json({ error_message: "Timestamp unavailable" }, { status: 503 });

  const app = mount({
    replies: [failed(), failed(), stamp("2000-01-01 00:00:00"), stamp("2099-01-01 00:00:00")],
  });

  await ready();
  await waitFor(() => expect(app.errors).toHaveBeenCalledTimes(1));
  await advance(60_000);
  expect(app.errors).toHaveBeenCalledTimes(2);
  await advance(60_000);
  expect(app.contexts).toHaveLength(1);
  expect(screen.queryByText("Timestamp unavailable")).toBeNull();
  app.change("2099-01-01 00:00:00");
  await advance(60_000);
  await fresh();
});

test("polls overlap, periodic replies do not rewind time, but a late initial reply assigns its baseline unconditionally", async () => {
  const initial = held();
  const first = held();
  const second = held();
  const future = "2099-01-01 00:00:00";

  const app = mount({
    auto: "false",
    replies: [initial.promise, first.promise, second.promise, stamp(future), stamp(future)],
  });

  await ready();
  await advance(120_000);
  expect(app.requests).toHaveLength(3);
  await release(second, stamp(future));
  await release(first, stamp("2098-01-01 00:00:00"));
  await app.enable();
  await advance(60_000);
  expect(app.contexts).toHaveLength(1);
  await release(initial, stamp(A));
  app.change(future);
  await advance(60_000);
  await fresh();
});

test("a held poll from a retired native document cannot reload its replacement", async () => {
  const oldPoll = held();
  const app = mount({ replies: [stamp(A), oldPoll.promise, stamp(B)] });
  await ready();
  await advance(60_000);
  expect(app.requests).toHaveLength(2);
  await act(async () => {
    await app.router.navigate({
      to: "/product/$productId",
      params: { productId: "8" },
      search: {},
    });
  });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Other coffee"),
  );
  await waitFor(() => expect(app.requests).toHaveLength(3));
  expect(app.requests[1]?.signal?.aborted).toBe(true);
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  await release(oldPoll, stamp(B));
  expect(app.contexts).toEqual(["07", "8"]);
  expect(screen.getByLabelText("Name")).toBe(name);
});

test("selecting the native picture outside the form does not block an otherwise eligible reload", async () => {
  const app = mount();
  await ready();
  const picture = screen.getByLabelText<HTMLInputElement>("Product picture");
  expect(picture.closest("form")).toBeNull();
  await userEvent.upload(picture, new File([pictureBytes], "draft.png", { type: "image/png" }));
  expect(picture.classList.contains("is-dirty")).toBe(true);
  expect(document.querySelector("form.is-dirty")).toBeNull();
  app.change(B);
  await advance(60_000);
  await fresh();
  expect(app.writes).toEqual([]);
});
