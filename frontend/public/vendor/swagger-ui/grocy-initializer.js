(() => {
  const origin = window.location.origin;
  const owner = new AbortController();
  let configured = false;
  let disposed = false;

  const send = (kind, data = {}) => {
    if (!disposed)
      window.parent.postMessage({ channel: "grocy-api-browser", kind, ...data }, origin);
  };

  const dispose = () => {
    disposed = true;
    owner.abort();
  };

  window.addEventListener("pagehide", dispose);
  window.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLScriptElement) send("error");
    },
    true,
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== origin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.channel !== "grocy-api-browser") return;
    if (data.kind === "dispose") {
      dispose();
      return;
    }
    if (disposed) return;
    if (data.kind === "navigate" && typeof data.hash === "string" && window.ui) {
      if (window.location.hash !== data.hash) {
        window.location.hash = data.hash;
        window.ui.layoutActions.parseDeepLinkHash(data.hash);
      }
      return;
    }
    if (
      data.kind !== "configure" ||
      configured ||
      typeof data.specUrl !== "string" ||
      typeof data.apiKey !== "string"
    )
      return;
    configured = true;
    try {
      const specUrl = new URL(data.specUrl, window.location.href).href;
      if (typeof data.title === "string") document.title = `${data.title} | Grocy`;
      if (typeof data.hash === "string") window.location.hash = data.hash;

      function HideTopbarPlugin() {
        return { components: { Topbar: () => null } };
      }

      function ParentNavigationPlugin() {
        return {
          statePlugins: {
            layout: {
              wrapActions: {
                show:
                  (original) =>
                  (...args) => {
                    const result = original(...args);
                    send("hash", { hash: window.location.hash });
                    return result;
                  },
              },
            },
          },
        };
      }

      window.ui = SwaggerUIBundle({
        url: specUrl,
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl, HideTopbarPlugin, ParentNavigationPlugin],
        layout: "StandaloneLayout",
        docExpansion: "list",
        defaultModelsExpandDepth: -1,
        validatorUrl: false,
        requestInterceptor: (request) => {
          owner.signal.throwIfAborted();
          if (new URL(request.url, window.location.href).href === specUrl && data.apiKey)
            request.headers["GROCY-API-KEY"] = data.apiKey;
          request.userFetch = async (url, options) => {
            owner.signal.throwIfAborted();
            const mutation = !["GET", "HEAD", "OPTIONS"].includes(
              (options.method || "GET").toUpperCase(),
            );
            try {
              const signal = options.signal
                ? AbortSignal.any([owner.signal, options.signal])
                : owner.signal;
              return await window.fetch(url, { ...options, signal });
            } finally {
              if (mutation) send("mutation");
            }
          };
          return request;
        },
      });
    } catch (error) {
      console.error(error);
      send("error");
    }
  });
})();
