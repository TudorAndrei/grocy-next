import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NightMode } from "@/components/NightMode";
import { queryKeys } from "@/lib/api";
import { nightModeEnabled } from "@/lib/theme";
import legacy from "./fixtures/legacy-night-mode.json";

afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

test.each(legacy.cases)(
  "legacy night-mode result: $name",
  ({ settings, systemDark, at, enabled }) => {
    expect(nightModeEnabled(settings, systemDark, new Date(at))).toBe(enabled);
  },
);

test.each([
  { mode: "production", interval: 60_000 },
  { mode: "dev", interval: 4_000 },
])(
  "$mode: system mode is checked globally and follows the system before login",
  async ({ mode, interval }) => {
    vi.useFakeTimers();
    let systemDark = false;
    vi.stubGlobal("matchMedia", () => ({ matches: systemDark }));
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    client.setQueryData(queryKeys.userSettings, {
      night_mode: "follow-system",
      night_mode_enabled_internal: false,
    });
    client.setQueryData(queryKeys.systemConfig, { MODE: mode });

    const view = render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <NightMode authenticated />
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(document.documentElement.dataset.theme).toBe("light");
    systemDark = true;
    await act(() => vi.advanceTimersByTimeAsync(interval - 1));
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/user/settings");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      night_mode_enabled_internal: true,
    });
    await act(() => vi.advanceTimersByTimeAsync(interval));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    systemDark = false;
    view.rerender(
      <StrictMode>
        <QueryClientProvider client={client}>
          <NightMode authenticated={false} />
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.unmount();
    client.clear();
    expect(vi.getTimerCount()).toBe(0);
  },
);
