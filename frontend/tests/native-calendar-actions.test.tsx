import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import { expect, onTestFinished, test, vi } from "vitest";
import { NativeCalendarActions } from "@/components/NativeCalendarActions";
import { queryKeys } from "@/lib/api";
import type { JsonObject } from "@/lib/json";
import type { UserSettings } from "@/lib/types";
import { supportDialogs } from "./fixtures/dialogs";

const shareTitle = "Share/Integrate calendar (iCal)";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountActions(
  options: {
    settings?: UserSettings;
    config?: JsonObject;
    holdWrite?: boolean;
    failWrite?: boolean;
    holdShare?: boolean;
    failShare?: boolean;
  } = {},
) {
  supportDialogs();

  const settings: UserSettings = {
    calendar_color_products: "#007bff",
    calendar_color_tasks: "#28a745",
    calendar_color_chores: "#ffc107",
    calendar_color_batteries: "#17a2b8",
    calendar_color_meal_plan: "#6c757d",
    ...options.settings,
  };

  const config: JsonObject = {
    FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: true,
    FEATURE_FLAG_TASKS: true,
    FEATURE_FLAG_CHORES: true,
    FEATURE_FLAG_BATTERIES: true,
    FEATURE_FLAG_RECIPES_MEALPLAN: true,
    ...options.config,
  };

  const writes: Array<{ key: string; value: string; signal?: AbortSignal | null }> = [];
  const write = deferred();
  const share = deferred();
  const shares: Array<{ signal?: AbortSignal | null }> = [];
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.userSettings, settings);
  client.setQueryData(["stock"], []);
  client.setQueryData(["native-calendar", 0], { events: [] });
  client.setQueryData(["calendar", "events"], []);

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);

    if (url.startsWith("/api/user/settings/")) {
      const key = decodeURIComponent(url.slice("/api/user/settings/".length));
      const value = JSON.parse(String(init?.body)).value;
      writes.push({ key, value, signal: init?.signal });

      if (options.holdWrite && writes.length === 1) await write.promise;

      if (options.failWrite)
        return Response.json({ error_message: "Color rejected" }, { status: 503 });
      settings[key] = value;

      return new Response(null, { status: 204 });
    }

    if (url === "/api/calendar/ical/sharing-link") {
      const index = shares.push({ signal: init?.signal });

      if (options.holdShare && index === 1) await share.promise;

      if (options.failShare)
        return Response.json({ error_message: "Sharing unavailable" }, { status: 503 });

      return Response.json({
        url: `https://grocy.test/house.hold/api/calendar/ical?secret=SECRET-${index}`,
      });
    }

    throw new Error(`Unexpected request ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);

  const app = render(
    <QueryClientProvider client={client}>
      <NativeCalendarActions settings={settings} config={config} onReload={reload} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
    logger.mockRestore();
  });

  return { ...app, writes, write, shares, share, reload, client, logger };
}

async function openColors() {
  await userEvent.click(screen.getByRole("button", { name: "Configure colors" }));

  return screen.getByRole<HTMLDialogElement>("dialog", { name: "Configure colors" });
}

function decodeQr(dialog: HTMLElement) {
  const svg = within(dialog).getByRole("img", { name: "QR-Code" });
  const [, , width = 0, height = 0] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  const pixels = new Uint8ClampedArray(width * height).fill(255);

  for (const rect of svg.querySelectorAll("g rect"))
    pixels[Number(rect.getAttribute("y")) * width + Number(rect.getAttribute("x"))] = 0;

  return new QRCodeReader()
    .decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))))
    .getText();
}

test("native color choices use only their exact feature flags and browser color coercion without writing initial values", async () => {
  const app = mountActions({
    settings: {
      calendar_color_products: null,
      calendar_color_tasks: "red",
      calendar_color_chores: "#ABCDEF",
    },
    config: {
      FEATURE_FLAG_STOCK: false,
      FEATURE_FLAG_BATTERIES: false,
      FEATURE_FLAG_RECIPES_MEALPLAN: "0",
    },
  });

  const dialog = await openColors();
  expect(within(dialog).getByLabelText<HTMLInputElement>("Products").value).toBe("#000000");
  expect(within(dialog).getByLabelText<HTMLInputElement>("Tasks").value).toBe("#000000");
  expect(within(dialog).getByLabelText<HTMLInputElement>("Chores").value).toBe("#abcdef");
  expect(within(dialog).queryByLabelText("Batteries")).toBeNull();
  expect(within(dialog).queryByLabelText("Meal plan")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
  expect(app.writes).toEqual([]);
});

test("color changes dispatch independently and OK reloads without awaiting the held write", async () => {
  const app = mountActions({ holdWrite: true });
  const dialog = await openColors();
  fireEvent.change(within(dialog).getByLabelText("Products"), { target: { value: "#112233" } });
  fireEvent.change(within(dialog).getByLabelText("Tasks"), { target: { value: "#445566" } });
  await waitFor(() =>
    expect(app.writes.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "calendar_color_products", value: "#112233" },
      { key: "calendar_color_tasks", value: "#445566" },
    ]),
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(app.reload).toHaveBeenCalledTimes(1);
  expect(app.writes[0]?.signal?.aborted).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => app.write.release());
  await waitFor(() => expect(app.client.getQueryState(["stock"])?.isInvalidated).toBe(true));
  expect(
    app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.calendar_color_products,
  ).toBe("#112233");
});

test.each(["cancel", "backdrop", "close"])(
  "every native color dismissal reloads once: %s",
  async (method) => {
    const app = mountActions();
    const dialog = await openColors();

    if (method === "close") dialog.close();
    fireEvent(
      dialog,
      new Event(method === "backdrop" ? "click" : method, { bubbles: true, cancelable: true }),
    );
    expect(app.reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

test("failed autosave retains the changed color without a notice and still permits dismissal", async () => {
  const app = mountActions({ failWrite: true });
  const dialog = await openColors();
  const input = within(dialog).getByLabelText<HTMLInputElement>("Products");
  fireEvent.change(input, { target: { value: "#aabbcc" } });
  await waitFor(() => expect(app.logger).toHaveBeenCalledTimes(1));
  expect(input.value).toBe("#aabbcc");
  expect(app.writes).toHaveLength(1);
  expect(screen.queryByRole("alert")).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(app.reload).toHaveBeenCalledTimes(1);
});

test("each share activation reads a fresh URL, selects it on click and renders an independently decodable QR", async () => {
  const app = mountActions();

  for (const index of [1, 2]) {
    await userEvent.click(screen.getByRole("button", { name: shareTitle }));
    const dialog = await screen.findByRole<HTMLDialogElement>("dialog", { name: shareTitle });
    const input = within(dialog).getByRole<HTMLInputElement>("textbox");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "OK" }));
    expect(input.value).toBe(
      `https://grocy.test/house.hold/api/calendar/ical?secret=SECRET-${index}`,
    );
    await userEvent.click(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(decodeQr(dialog)).toBe(input.value);
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog", { name: shareTitle })).toBe(dialog);

    if (index === 1) await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    else {
      dialog.close();
      fireEvent(dialog, new Event("close"));
    }

    expect(screen.queryByRole("dialog")).toBeNull();
  }

  expect(app.shares).toHaveLength(2);
  expect(app.reload).not.toHaveBeenCalled();
});

test("concurrent share responses retain their own alerts in completion order and Escape never reloads", async () => {
  const app = mountActions({ holdShare: true });
  const button = screen.getByRole("button", { name: shareTitle });
  await userEvent.click(button);
  await userEvent.click(button);
  const second = await screen.findByRole<HTMLDialogElement>("dialog", { name: shareTitle });
  expect(within(second).getByRole<HTMLInputElement>("textbox").value).toContain("SECRET-2");
  await act(async () => app.share.release());
  await waitFor(() => expect(screen.getAllByRole("dialog", { name: shareTitle })).toHaveLength(2));
  const dialogs = screen.getAllByRole("dialog", { name: shareTitle });
  expect(
    dialogs.map((dialog) => within(dialog).getByRole<HTMLInputElement>("textbox").value),
  ).toEqual([
    "https://grocy.test/house.hold/api/calendar/ical?secret=SECRET-2",
    "https://grocy.test/house.hold/api/calendar/ical?secret=SECRET-1",
  ]);

  for (const dialog of dialogs) fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.reload).not.toHaveBeenCalled();
});

test("sharing failure is console-only and the next activation retries independently", async () => {
  const app = mountActions({ failShare: true });
  await userEvent.click(screen.getByRole("button", { name: shareTitle }));
  await waitFor(() => expect(app.logger).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: shareTitle }));
  await waitFor(() => expect(app.logger).toHaveBeenCalledTimes(2));
  expect(app.shares).toHaveLength(2);
  expect(app.reload).not.toHaveBeenCalled();
});

test("departure retires a held sharing response and aborts writes while settling committed caches", async () => {
  const app = mountActions({ holdShare: true, holdWrite: true });
  await userEvent.click(screen.getByRole("button", { name: shareTitle }));
  const dialog = await openColors();
  fireEvent.change(within(dialog).getByLabelText("Products"), { target: { value: "#112233" } });
  await waitFor(() => expect(app.writes).toHaveLength(1));
  app.unmount();
  render(<h1>Replacement page</h1>);
  expect(app.shares[0]?.signal?.aborted).toBe(true);
  expect(app.writes[0]?.signal?.aborted).toBe(true);
  await act(async () => {
    app.share.release();
    app.write.release();
  });
  await waitFor(() => expect(app.client.getQueryState(["stock"])?.isInvalidated).toBe(true));
  expect(app.client.getQueryState(["native-calendar", 0])?.isInvalidated).toBe(true);
  expect(app.client.getQueryState(["calendar", "events"])?.isInvalidated).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.reload).not.toHaveBeenCalled();
  expect(app.logger).not.toHaveBeenCalled();
});
