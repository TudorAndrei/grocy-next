import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { FullscreenCard, FullscreenToggle } from "@/components/FullscreenCard";

afterEach(() => window.history.replaceState(null, "", "/"));

test("full-screen reading preserves input, traps focus, and restores the page on Escape", async () => {
  const user = userEvent.setup();

  const view = render(
    <StrictMode>
      <button>Outside</button>
      <main>
        <FullscreenCard label="Soup" hash>
          <FullscreenToggle />
          <input aria-label="Servings" defaultValue="2" />
          <a href="#ingredients">Ingredients</a>
        </FullscreenCard>
        <button>Editor</button>
      </main>
    </StrictMode>,
  );

  const toggle = screen.getByRole("button", { name: "Expand to fullscreen" });
  const servings = screen.getByLabelText("Servings");
  await user.clear(servings);
  await user.type(servings, "4");
  await user.click(toggle);
  const dialog = screen.getByRole("dialog", { name: "Soup" });
  expect(document.activeElement).toBe(dialog);
  expect(window.location.hash).toBe("#fullscreen");
  expect(screen.getByRole("button", { name: "Outside" }).inert).toBe(true);
  expect(screen.getByRole("button", { name: "Editor" }).inert).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  await user.tab();
  expect(document.activeElement).toBe(toggle);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Ingredients" }));
  await user.tab();
  expect(document.activeElement).toBe(toggle);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(toggle);
  expect(screen.getByRole("button", { name: "Outside" }).inert).toBeFalsy();
  expect(document.body.style.overflow).toBe("");
  expect(window.location.hash).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Servings").value).toBe("4");

  await user.click(toggle);
  view.unmount();
  expect(document.body.classList.contains("fullscreen-card")).toBe(false);
  expect(document.body.style.overflow).toBe("");
});

test("a direct legacy full-screen link opens the card and follows hash changes", () => {
  window.history.replaceState(null, "", "/recipes/2#fullscreen");
  render(
    <FullscreenCard label="Direct recipe" hash>
      <FullscreenToggle />
    </FullscreenCard>,
  );
  expect(screen.getByRole("dialog", { name: "Direct recipe" })).toBeTruthy();
  window.history.replaceState(null, "", "/recipes/2");
  fireEvent(window, new HashChangeEvent("hashchange"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
