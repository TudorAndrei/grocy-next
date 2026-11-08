import { resolveUrl } from "./api";
import { readApiConfig } from "./config";

export function apiBrowserDocument() {
  return `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/vendor/swagger-ui/index.html`;
}

export function configureApiBrowser(frame: HTMLIFrameElement, title: string, hash: string) {
  frame.contentWindow?.postMessage(
    {
      channel: "grocy-api-browser",
      kind: "configure",
      specUrl: new URL(resolveUrl("/api/openapi/specification"), window.location.href).href,
      apiKey: readApiConfig().apiKey,
      title,
      hash,
    },
    window.location.origin,
  );
}
