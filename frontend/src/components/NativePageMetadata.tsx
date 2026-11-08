import { useEffect } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { resolveUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** The native authenticated layout supplies a manifest for the current page. */
export function NativePageMetadata() {
  const href = useLocation({ select: (location) => location.href });
  const standaloneApi = useLocation({ select: (location) => location.pathname === "/api" });
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    const previousTitle = document.title;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.crossOrigin = "use-credentials";

    if (!standaloneApi) document.head.append(link);

    const update = () => {
      const title = standaloneApi
        ? t("REST API browser")
        : document.querySelector("#main-content h1")?.textContent?.trim() || "Grocy";

      const url = new URL(router.history.location.href, window.location.origin).href;
      const bytes = new TextEncoder().encode(`${title}#${url}`);
      const data = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
      link.href = `${resolveUrl("/manifest")}?data=${encodeURIComponent(data)}`;
      document.title = `${title} | Grocy`;
    };

    update();
    const main = document.querySelector("#main-content");
    const observer = new MutationObserver(update);

    if (main) observer.observe(main, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      link.remove();
      document.title = previousTitle;
    };
  }, [href, router, standaloneApi, t]);

  return null;
}
