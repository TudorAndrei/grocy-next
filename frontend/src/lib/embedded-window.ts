declare global {
  interface Window {
    IsGrocy?: boolean;
  }
}

/** Native frames belong to the outermost Grocy document, not an embedding host. */
export function getTopmostGrocyWindow(): Window {
  let current: Window = window;
  let topmost: Window = window;

  while (true) {
    try {
      if (current.IsGrocy) topmost = current;

      if (current === current.parent) return topmost;
      current = current.parent;
    } catch {
      // A foreign embedding page cannot host Grocy's same-origin frame messages.
      return topmost;
    }
  }
}

export function registerGrocyWindow() {
  const current = window;
  const previous = current.IsGrocy;
  current.IsGrocy = true;

  return () => {
    if (previous === undefined) delete current.IsGrocy;
    else current.IsGrocy = previous;
  };
}
