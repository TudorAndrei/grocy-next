import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { BookingDateInput } from "@/components/BookingDateInput";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocalizationProvider } from "@/lib/i18n";
import observed from "./fixtures/legacy-booking-date-keys.json";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 12, 34, 56));
  onTestFinished(() => {
    vi.useRealTimers();
  });
});

function Field({
  required = true,
  advance = false,
  numeric = true,
  firstDayOfWeek = "",
  weekNumbers = true,
} = {}) {
  const [value, setValue] = useState("");
  const next = useRef<HTMLInputElement>(null);

  return (
    <form>
      <label htmlFor="due">Due date</label>
      <BookingDateInput
        id="due"
        label="Due date"
        value={value}
        onChange={setValue}
        required={required}
        numeric={numeric}
        firstDayOfWeek={firstDayOfWeek}
        weekNumbers={weekNumbers}
        readOnly={value === "2999-12-31"}
        onShortcut={advance ? () => next.current?.focus() : undefined}
      />
      <label htmlFor="price">Price</label>
      <input ref={next} id="price" />
    </form>
  );
}

test.each(observed.cases)(
  "native date keyboard result: $name",
  async ({ initial, stroke, expected }) => {
    render(<Field />);
    const input = screen.getByLabelText<HTMLInputElement>("Due date");
    input.focus();

    for (const value of ["2032-01-01", initial]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyUp(input, { key: "End" });
    }

    if (stroke.startsWith("Shift+"))
      await userEvent.keyboard(`{Shift>}{${stroke.slice(6)}}{/Shift}`);
    else await userEvent.keyboard(stroke.startsWith("Arrow") ? `{${stroke}}` : stroke);

    expect({
      value: input.value,
      valid: input.checkValidity(),
      readOnly: input.readOnly,
      focus: document.activeElement === input ? "self" : document.activeElement?.id,
    }).toEqual(expected);
  },
);

test("invalid shorthand restores the last calendar value when the next field gets focus", async () => {
  render(<Field advance />);
  const input = screen.getByLabelText<HTMLInputElement>("Due date");
  await userEvent.type(input, "20310714");
  expect(document.activeElement).toBe(screen.getByLabelText("Price"));
  expect(input.value).toBe("2031-07-14");
  await userEvent.clear(input);
  await userEvent.type(input, "20320230");
  expect(document.activeElement).toBe(screen.getByLabelText("Price"));
  expect(input.value).toBe("2031-07-14");
  expect(input.checkValidity()).toBe(true);
});

test("native custom validity remains set after required is removed until a valid date is entered", () => {
  const view = render(<Field />);
  const input = screen.getByLabelText<HTMLInputElement>("Due date");
  fireEvent.keyUp(input, { key: "End" });
  expect(input.validationMessage).toBe("error");
  view.rerender(<Field required={false} numeric={false} />);
  fireEvent.keyUp(input, { key: "End" });
  expect(input.checkValidity()).toBe(false);
  expect(input.inputMode).toBe("");
  fireEvent.change(input, { target: { value: "2032-01-01" } });
  fireEvent.keyUp(input, { key: "End" });
  expect(input.checkValidity()).toBe(true);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.keyUp(input, { key: "End" });
  expect(input.checkValidity()).toBe(true);
});

test("the native calendar navigates through decades and selects an adjacent-month day", async () => {
  render(<Field />);
  const input = screen.getByLabelText<HTMLInputElement>("Due date");
  await userEvent.type(input, "20320229");
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  expect(screen.getByText("February 2032")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Next Month" }));
  expect(screen.getByText("March 2032")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Previous Month" }));
  await userEvent.click(screen.getByRole("button", { name: "Select Month" }));
  await userEvent.click(screen.getByRole("button", { name: "Select Year" }));
  expect(screen.getByText("2030-2039")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Select Decade" }));
  expect(screen.getByText("2000-2090")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "1990" }));
  expect(screen.getByText("2000-2009")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "2008" }));
  await userEvent.click(screen.getByRole("button", { name: "Feb" }));
  expect(input.value).toBe("2032-02-29");
  await userEvent.click(screen.getByRole("button", { name: "January 27, 2008" }));
  expect(input.value).toBe("2008-01-27");
  expect(screen.queryByRole("dialog", { name: "Due date: Calendar" })).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

test("Today retains the open native calendar and Close completes date validation", async () => {
  render(<Field />);
  const input = screen.getByLabelText<HTMLInputElement>("Due date");
  fireEvent.keyUp(input, { key: "End" });
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  expect(input.value).toBe("");
  expect(screen.getByText("October 2026")).toBeTruthy();

  for (const week of ["40", "41", "42", "43", "44", "45"])
    expect(screen.getByText(week)).toBeTruthy();
  expect(screen.getByRole("button", { name: "September 27, 2026" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "November 7, 2026" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Go to today" }));
  expect(input.value).toBe("2026-10-30");
  expect(input.checkValidity()).toBe(false);
  expect(screen.getByRole("dialog", { name: "Due date: Calendar" })).toBeTruthy();
  expect(screen.getByText("Today")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Close the picker" }));
  expect(input.checkValidity()).toBe(true);
  expect(document.activeElement).toBe(document.body);
});

test("the calendar retains its view after close and typing dismisses it with native focus", async () => {
  render(<Field />);
  const input = screen.getByLabelText<HTMLInputElement>("Due date");
  await userEvent.type(input, "20320229");
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  await userEvent.click(screen.getByRole("button", { name: "Select Month" }));
  await userEvent.click(screen.getByRole("button", { name: "Close the picker" }));
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  expect(screen.getByRole("button", { name: "Select Year" }).textContent).toBe("2032");
  await userEvent.click(screen.getByRole("button", { name: "Feb" }));
  await userEvent.keyboard("{ArrowRight}");
  expect(input.value).toBe("2032-03-07");
  expect(screen.queryByRole("dialog", { name: "Due date: Calendar" })).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

test("the calendar enforces the native last month and retains the Never focus rule", async () => {
  render(<Field advance />);
  const input = screen.getByLabelText<HTMLInputElement>("Due date");
  await userEvent.click(input);
  await userEvent.paste("2999-12-30");
  fireEvent.keyUp(input, { key: "Control" });
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next Month" }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "January 1, 3000" }).disabled).toBe(
    true,
  );
  await userEvent.click(screen.getByRole("button", { name: "December 31, 2999" }));
  expect(input.value).toBe("2999-12-31");
  expect(input.readOnly).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText("Price"));
});

test("calendar settings change the week start and week-number column", async () => {
  const view = render(<Field firstDayOfWeek="1" weekNumbers={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Mo",
    "Tu",
    "We",
    "Th",
    "Fr",
    "Sa",
    "Su",
  ]);
  expect(screen.getByRole("button", { name: "September 28, 2026" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "November 8, 2026" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Close the picker" }));
  await userEvent.type(screen.getByLabelText("Due date"), "20270101");
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  view.rerender(<Field firstDayOfWeek="1" weekNumbers />);
  expect(screen.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
  ]);
});

test("the German calendar retains locale week numbers, month names, and date help", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;

    if (path.endsWith("/api/system/config")) return Response.json({ LOCALE: "de" });

    if (path.endsWith("/api/v2/localization"))
      return Response.json({
        locale: "de",
        direction: "ltr",
        languages: ["de"],
        catalog: {
          domain: "grocy/strings",
          "plural-forms": null,
          messages: { "": { moment_locale: ["de"] } },
        },
      });
    throw new Error(`Unexpected date localization request: ${path}`);
  });
  onTestFinished(() => {
    client.clear();
    vi.unstubAllGlobals();
  });
  render(
    <QueryClientProvider client={client}>
      <LocalizationProvider>
        <Field />
      </LocalizationProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.documentElement.lang).toBe("de"));
  await userEvent.type(screen.getByLabelText("Due date"), "20270101");
  expect(screen.getByText("in 2 Monaten")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  expect(screen.getByText("Januar 2027")).toBeTruthy();
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "#",
    "Mo",
    "Di",
    "Mi",
    "Do",
    "Fr",
    "Sa",
    "So",
  ]);
  expect(screen.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
    "53",
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  expect(screen.getByRole("button", { name: "28. Dezember 2026" })).toBeTruthy();
});
