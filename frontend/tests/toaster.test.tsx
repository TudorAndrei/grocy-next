import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { Toaster, useNotify } from "@/components/Toaster";
import { useModalDialog } from "@/hooks/useModalDialog";
import { supportDialogs } from "./fixtures/dialogs";
import { useGenericError, type GenericException } from "@/hooks/useGenericError";

beforeEach(supportDialogs);

function Dialog({ name, children }: { name: string; children: ReactNode }) {
  const dialog = useModalDialog();

  return (
    <dialog ref={dialog} aria-label={name}>
      {children}
    </dialog>
  );
}

function Notifications({ undo }: { undo: () => Promise<void> }) {
  const notify = useNotify();
  const [child, setChild] = useState(false);

  return (
    <Dialog name="Stock entries">
      <button type="button" onClick={() => notify({ message: "Transferred coffee", undo })}>
        Notify transfer
      </button>
      <button type="button" onClick={() => setChild(true)}>
        Open product
      </button>
      {child ? (
        <Dialog name="Product overview">
          <button type="button" onClick={() => setChild(false)}>
            Close product
          </button>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

test("notification actions stay in the active dialog and retain a pending Undo through dialog changes", async () => {
  let finish = () => {};
  let calls = 0;

  const result = new Promise<void>((resolve) => {
    finish = resolve;
  });

  render(
    <Toaster>
      <Notifications
        undo={async () => {
          calls++;
          await result;
        }}
      />
    </Toaster>,
  );
  const parent = screen.getByRole("dialog", { name: "Stock entries" });
  await userEvent.click(within(parent).getByRole("button", { name: "Notify transfer" }));
  await userEvent.click(await within(parent).findByRole("button", { name: "Undo" }));
  expect(calls).toBe(1);
  await userEvent.click(within(parent).getByRole("button", { name: "Open product" }));
  const child = screen.getByRole("dialog", { name: "Product overview" });
  await waitFor(() =>
    expect(
      within(child).getByRole<HTMLButtonElement>("button", { name: "Undoing…" }).disabled,
    ).toBe(true),
  );
  await userEvent.click(within(child).getByRole("button", { name: "Close product" }));
  await waitFor(() =>
    expect(
      within(parent).getByRole<HTMLButtonElement>("button", { name: "Undoing…" }).disabled,
    ).toBe(true),
  );
  expect(calls).toBe(1);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByText("Transferred coffee")).toBeNull());
});

function GenericNotification({ value }: { value: GenericException }) {
  const error = useGenericError();

  return (
    <button type="button" onClick={() => error("Operation failed", value)}>
      Notify generic
    </button>
  );
}

type GenericErrorCase = { value: GenericException; expected: string };

const genericErrors: GenericErrorCase[] = [
  {
    value: { error_message: "<img src=x onerror=alert(1)>bad" },
    expected: "<img src=x onerror=alert(1)>bad",
  },
  { value: { detail: "Bad" }, expected: '{\n    "detail": "Bad"\n}' },
  { value: '{"error_message":"Raw"}', expected: String.raw`"{\"error_message\":\"Raw\"}"` },
  { value: undefined, expected: "undefined" },
  { value: null, expected: "null" },
  { value: ["one", 2], expected: '[\n    "one",\n    2\n]' },
];

test.each(genericErrors)(
  "generic error details preserve native exception text ($expected)",
  async ({ value, expected }) => {
    render(
      <Toaster>
        <Dialog name="Editor">
          <input aria-label="Draft" defaultValue="Keep this draft" />
          <GenericNotification value={value} />
        </Dialog>
      </Toaster>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Notify generic" }));
    const action = screen.getByRole("button", { name: /Click to show technical details/ });
    act(() => action.focus());
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Error details" });
    expect(dialog.querySelector("p")?.textContent).toBe(expected);
    expect(dialog.querySelector("img,script,[onerror]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Click to show technical details/ })).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "OK" }));
    await user.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: "Error details" })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Draft").value).toBe("Keep this draft");
  },
);

function TimedNotifications() {
  const notify = useNotify();

  return (
    <>
      <button type="button" onClick={() => notify({ message: "Timed notice" })}>
        Notify timed
      </button>
      <GenericNotification value="Long-lived details" />
    </>
  );
}

test("notifications use native timeouts, pause during interaction, and never expire an open detail dialog", () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  render(
    <Toaster>
      <TimedNotifications />
    </Toaster>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Notify timed" }));
  act(() => {
    vi.advanceTimersByTime(19999);
  });
  expect(screen.getByText("Timed notice")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByText("Timed notice")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Notify timed" }));
  const toast = screen.getByText("Timed notice").closest(".toast");

  if (!toast) throw new Error("Missing notification.");
  fireEvent.mouseEnter(toast);
  act(() => {
    vi.advanceTimersByTime(30000);
  });
  expect(screen.getByText("Timed notice")).toBeTruthy();
  fireEvent.mouseLeave(toast);
  act(() => {
    vi.advanceTimersByTime(4999);
  });
  expect(screen.getByText("Timed notice")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByText("Timed notice")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Notify generic" }));
  const action = screen.getByRole("button", { name: /Click to show technical details/ });
  act(() => action.focus());
  act(() => {
    vi.advanceTimersByTime(30000);
  });
  expect(action.isConnected).toBe(true);
  fireEvent.click(action);
  const details = screen.getByRole("dialog", { name: "Error details" });
  act(() => {
    vi.advanceTimersByTime(30000);
  });
  expect(details.isConnected).toBe(true);
  fireEvent(details, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog", { name: "Error details" })).toBeNull();
});
