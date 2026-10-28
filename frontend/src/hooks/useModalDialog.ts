import { useEffect, useRef } from "react";

export function useModalDialog() {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const wasFullscreen = document.body.classList.contains("fullscreen-card");
    element?.showModal();
    document.body.style.overflow = "hidden";

    return () => {
      element?.close();

      // An unmounted full-screen card has already restored its own page lock.
      if (!wasFullscreen || document.body.classList.contains("fullscreen-card"))
        document.body.style.overflow = previousOverflow;

      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return dialog;
}
