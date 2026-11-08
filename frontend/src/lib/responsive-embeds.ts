/** Native responsive embeds are sized by their parent page, not the child viewport. */
export function resizeResponsiveEmbeds() {
  const fullscreen = document.body.classList.contains("fullscreen-card");
  const pageHeight = document.body.getBoundingClientRect().height;

  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.embed-responsive")) {
    try {
      const body = frame.contentDocument?.body;

      if (body) frame.setAttribute("height", `${body.scrollHeight}px`);
    } catch {
      // A cross-origin page cannot expose its document to this host.
    }

    if (fullscreen) frame.setAttribute("height", `${pageHeight}px`);
  }

  const navigationHeight = document.getElementById("mainNav")?.getBoundingClientRect().height ?? 0;

  for (const embed of document.querySelectorAll<HTMLEmbedElement>(
    "embed.embed-responsive:not(.resize-done)",
  )) {
    embed.setAttribute(
      "height",
      `${fullscreen ? pageHeight : pageHeight - navigationHeight - 62}px`,
    );
    embed.classList.add("resize-done");
  }
}
