import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HeaderClock } from "@/components/HeaderClock";
import { contextualDateText, headerClockText } from "@/lib/header-clock";
import legacy from "./fixtures/legacy-header-clock.json";
import stockDates from "./fixtures/legacy-stock-dates.json";

afterEach(() => vi.useRealTimers());

test.each(legacy.cases)(
  "legacy clock formats: $locale, $at",
  ({ at, momentLocale, small, big }) => {
    expect(headerClockText(new Date(at), momentLocale)).toEqual({ small, big });
  },
);

test.each(stockDates.cases)(
  "legacy relative date: $locale, $timestamp",
  ({ locale, timestamp, date, relative }) => {
    expect(contextualDateText(timestamp, new Date(stockDates.now), locale, (text) => text)).toEqual(
      { date, relative },
    );
  },
);

test("the mounted clock updates each second and releases its interval on close", async () => {
  vi.useFakeTimers();
  const start = new Date("2026-10-28T21:05:06");
  vi.setSystemTime(start);

  const view = render(
    <StrictMode>
      <HeaderClock />
    </StrictMode>,
  );

  const time = view.container.querySelector("time");
  expect(time?.dateTime).toBe(start.toISOString());
  expect(screen.getByText("Wednesday, October 28, 2026 9:05 PM")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(time?.dateTime).toBe(new Date(start.getTime() + 1_000).toISOString());
  await act(() => vi.advanceTimersByTimeAsync(59_000));
  expect(screen.getByText("Wednesday, October 28, 2026 9:06 PM")).toBeTruthy();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
