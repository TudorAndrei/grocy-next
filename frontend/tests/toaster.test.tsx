import { useState, type ReactNode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { Toaster, useNotify } from "@/components/Toaster";
import { useModalDialog } from "@/hooks/useModalDialog";
import { supportDialogs } from "./fixtures/dialogs";

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
