import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ScreenOn } from "@/components/ScreenOn";
import { queryKeys } from "@/lib/api";
import type { UserSettings } from "@/lib/types";

afterEach(() => document.body.classList.remove("fullscreen-card"));

function mount(settings: UserSettings) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  client.setQueryData(queryKeys.userSettings, settings);

  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ScreenOn />
      </QueryClientProvider>
    </StrictMode>,
  );

  return { ...view, client };
}

function sentinel() {
  return {
    released: false,
    release: vi.fn(async function (this: { released: boolean }) {
      this.released = true;
    }),
  };
}

test("a rejected native request can retry on the next user action", async () => {
  const lock = sentinel();

  const request = vi
    .fn()
    .mockRejectedValueOnce(new DOMException("Unavailable", "NotAllowedError"))
    .mockResolvedValue(lock);

  vi.stubGlobal("navigator", { wakeLock: { request }, userActivation: { hasBeenActive: false } });
  const view = mount({ keep_screen_on: true });
  await act(async () => fireEvent.click(document.body));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(document.body));
  expect(request).toHaveBeenCalledTimes(2);
  expect(lock.released).toBe(false);
  view.unmount();
  expect(lock.released).toBe(true);
  view.client.clear();
});

test("always-on waits for interaction, overrides card mode, and follows visibility and saved settings", async () => {
  const acquired: ReturnType<typeof sentinel>[] = [];

  const request = vi.fn(async () => {
    const lock = sentinel();
    acquired.push(lock);

    return lock;
  });

  vi.stubGlobal("navigator", { wakeLock: { request }, userActivation: { hasBeenActive: false } });
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const view = mount({ keep_screen_on: true, keep_screen_on_when_fullscreen_card: true });
  expect(request).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(document.body));
  expect(request).toHaveBeenCalledWith("screen");
  await act(async () => {
    document.body.classList.add("fullscreen-card");
  });
  await act(async () => {
    document.body.classList.remove("fullscreen-card");
  });
  expect(acquired[0]?.released).toBe(false);
  visibility = "hidden";
  await act(async () => fireEvent(document, new Event("visibilitychange")));
  expect(acquired[0]?.released).toBe(true);
  visibility = "visible";
  await act(async () => fireEvent(document, new Event("visibilitychange")));
  expect(acquired).toHaveLength(2);
  await act(async () =>
    view.client.setQueryData(queryKeys.userSettings, {
      keep_screen_on: false,
      keep_screen_on_when_fullscreen_card: false,
    }),
  );
  await waitFor(() => expect(acquired[1]?.released).toBe(true));
  view.unmount();
  await act(async () => fireEvent.click(document.body));
  expect(request).toHaveBeenCalledTimes(2);
  view.client.clear();
});

test.each(["close", "unmount"])("a late native lock is released after %s", async (action) => {
  const lock = sentinel();
  let resolve!: (value: ReturnType<typeof sentinel>) => void;

  const request = vi.fn(
    () =>
      new Promise<ReturnType<typeof sentinel>>((done) => {
        resolve = done;
      }),
  );

  vi.stubGlobal("navigator", { wakeLock: { request }, userActivation: { hasBeenActive: false } });
  const view = mount({ keep_screen_on_when_fullscreen_card: true });
  await act(async () => fireEvent.click(document.body));
  expect(request).not.toHaveBeenCalled();
  await act(async () => {
    document.body.classList.add("fullscreen-card");
  });
  expect(request).toHaveBeenCalledTimes(1);
  // Another click must not start a second request while the first one is pending.
  await act(async () => fireEvent.click(document.body));
  expect(request).toHaveBeenCalledTimes(1);

  if (action === "close")
    await act(async () => {
      document.body.classList.remove("fullscreen-card");
    });
  else view.unmount();
  await act(async () => resolve(lock));
  expect(lock.released).toBe(true);
  view.unmount();
  view.client.clear();
});

test("the legacy video fallback stops after closing, including a late play result", async () => {
  vi.stubGlobal("navigator", {
    userActivation: { hasBeenActive: false },
    userAgent: "Test browser",
  });
  let finish!: () => void;
  const videos: HTMLMediaElement[] = [];

  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    videos.push(this);

    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });

  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const view = mount({ keep_screen_on_when_fullscreen_card: true });
  await act(async () => fireEvent.click(document.body));
  await act(async () => {
    document.body.classList.add("fullscreen-card");
  });
  expect(play).toHaveBeenCalledTimes(1);
  expect(videos[0]?.querySelectorAll("source")).toHaveLength(2);
  await act(async () => {
    document.body.classList.remove("fullscreen-card");
  });
  expect(pause).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(pause).toHaveBeenCalledTimes(2);
  view.unmount();
  const calls = play.mock.calls.length;
  await act(async () => {
    document.body.classList.add("fullscreen-card");
    fireEvent.click(document.body);
  });
  expect(play).toHaveBeenCalledTimes(calls);
  view.client.clear();
});
