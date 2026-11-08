import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { UserPicker } from "@/components/UserPicker";

const users = [
  { id: 1, username: "first", display_name: "xAlpha" },
  { id: 2, username: "second", display_name: "ALpine" },
  { id: 3, username: "third", display_name: "xalpha" },
  { id: 4, username: "fourth", display_name: "Albatross" },
];

function mount(choices = users, initialValue = "") {
  const changed = vi.fn();

  function Harness() {
    const [value, setValue] = useState(initialValue);

    return (
      <>
        <UserPicker
          label="Assigned to"
          users={choices}
          value={value}
          onChange={(id) => {
            setValue(id);
            changed(id);
          }}
        />
        <button type="button">Other control</button>
      </>
    );
  }

  render(<Harness />);

  return changed;
}

test("display-name search uses native prefix, exact-case substring, and folded substring ranking", async () => {
  const changed = mount();
  const user = userEvent.setup();
  const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Assigned to" });
  await user.click(input);
  expect(input.getAttribute("aria-expanded")).toBe("false");
  await user.type(input, "Al");

  const choices = within(screen.getByRole("listbox", { name: "Assigned to" })).getAllByRole(
    "option",
  );

  expect(choices.map((option) => option.textContent)).toEqual([
    "ALpine",
    "Albatross",
    "xAlpha",
    "xalpha",
  ]);
  expect(choices[0]?.getAttribute("aria-selected")).toBe("true");
  await user.click(choices[0]!);
  expect(input.value).toBe("ALpine");
  expect(changed).toHaveBeenLastCalledWith("2");
});

test.each(["[", "("])("search and highlighting treat %s as literal text", async (query) => {
  mount([{ id: 1, username: "helper", display_name: "Helper [A] (B)" }]);
  const user = userEvent.setup();
  const input = screen.getByRole("combobox", { name: "Assigned to" });
  // Keyboard descriptors reserve '['; paste exercises the literal text input.
  await user.click(input);
  await user.paste(query);
  const option = await screen.findByRole("option", { name: "Helper [A] (B)" });
  expect(within(option).getByText(query, { selector: "strong" })).toBeTruthy();
  await user.click(option);
  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("Helper [A] (B)");
});

test("username metadata does not extend the pinned display-text matcher", async () => {
  const changed = mount([{ id: 1, username: "login-only", display_name: "Visible name" }]);
  const user = userEvent.setup();
  const input = screen.getByRole("combobox", { name: "Assigned to" });
  await user.type(input, "login-only");
  expect(screen.queryByRole("listbox")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Other control" }));
  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
  await user.type(input, "visible");
  await user.keyboard("{Enter}");
  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("Visible name");
  expect(changed).toHaveBeenLastCalledWith("1");
});

test.each(["ALpine", "No such person"])(
  "blur clears an uncommitted draft even when its text is %s",
  async (draft) => {
    const changed = mount(users, "1");
    const user = userEvent.setup();
    const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Assigned to" });
    expect(input.value).toBe("xAlpha");
    await user.clear(input);
    await user.type(input, draft);
    expect(changed).toHaveBeenLastCalledWith("");
    await user.click(screen.getByRole("button", { name: "Other control" }));
    expect(input.value).toBe("");
    await waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("false"));
  },
);

test("arrow keys wrap, Tab commits without advancing focus, and Escape preserves the draft until blur", async () => {
  const changed = mount();
  const user = userEvent.setup();
  const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Assigned to" });
  await user.click(input);
  await user.keyboard("{ArrowDown}{ArrowUp}");
  expect(screen.getByRole("option", { name: "Albatross" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  await user.keyboard("{ArrowDown}{ArrowDown}{Tab}");
  expect(input.value).toBe("ALpine");
  expect(changed).toHaveBeenLastCalledWith("2");
  expect(document.activeElement).toBe(input);
  // Native ArrowDown first clears a selected value; the second opens all choices.
  await user.keyboard("{ArrowDown}");
  expect(input.value).toBe("");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  await user.type(input, "Al");
  await user.keyboard("{Escape}");
  expect(input.value).toBe("Al");
  expect(screen.queryByRole("listbox")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Other control" }));
  expect(input.value).toBe("");
});

test("mouse choices keep native duplicate-name ID mapping while ID prefills stay exact", async () => {
  const changed = mount(
    [
      { id: 1, username: "first", display_name: "Same name" },
      { id: 2, username: "second", display_name: "Same name" },
    ],
    "1",
  );

  const user = userEvent.setup();
  const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Assigned to" });
  expect(input.value).toBe("Same name");
  expect(changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Assigned to: Clear" }));
  expect(input.value).toBe("");
  await user.click(screen.getByRole("button", { name: "Assigned to: Show options" }));
  const first = screen.getAllByRole("option", { name: "Same name" })[0]!;
  await user.hover(first);
  await user.click(first);
  expect(changed).toHaveBeenLastCalledWith("2");
  expect(input.value).toBe("Same name");
  await user.click(screen.getByRole("button", { name: "Assigned to: Clear" }));
  expect(changed).toHaveBeenLastCalledWith("");
  expect(document.activeElement).toBe(input);
});

test("missing or differently spelled IDs clear rather than selecting an approximate ID", () => {
  const changed = vi.fn();

  const app = render(
    <UserPicker label="Assigned to" users={users} value="01" onChange={changed} />,
  );

  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
  expect(changed).toHaveBeenLastCalledWith("");
  app.rerender(<UserPicker label="Assigned to" users={users} value="2" onChange={changed} />);
  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("ALpine");
  app.rerender(
    <UserPicker
      label="Assigned to"
      users={[{ id: 5, username: "Raw.USER", display_name: null }]}
      value="5"
      onChange={changed}
    />,
  );
  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("Raw.USER");
});

test("disabled user controls cannot open or change a selection", async () => {
  const changed = vi.fn();
  render(<UserPicker label="Assigned to" users={users} value="1" disabled onChange={changed} />);
  const user = userEvent.setup();
  const input = screen.getByRole<HTMLInputElement>("combobox");
  expect(input.disabled).toBe(true);
  const clear = screen.getByRole<HTMLButtonElement>("button", { name: "Assigned to: Clear" });
  expect(clear.disabled).toBe(true);
  await user.click(clear);
  expect(input.value).toBe("xAlpha");
  expect(changed).not.toHaveBeenCalled();
});
