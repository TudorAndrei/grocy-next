import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  // JSDOM has no layout; expose its configured viewport as the document width.
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    get: () => window.innerWidth,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
