import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { BookingDateInput } from "@/components/BookingDateInput";
import observed from "./fixtures/legacy-booking-date-keys.json";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 12, 34, 56));
  onTestFinished(() => {
    vi.useRealTimers();
  });
});

function Field({ required = true, advance = false, numeric = true } = {}) {
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
