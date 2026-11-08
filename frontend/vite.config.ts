import path from "node:path";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, import.meta.dirname);
  const base = environment.VITE_BASE_PATH?.trim() || "/";
  const apiPrefix = `${base.replace(/\/$/, "")}/api/`;
  const filesPrefix = `${base.replace(/\/$/, "")}/files`;

  const resourcePaths =
    "(?:(?:product|recipe|chore|battery|stockentry)/[^/?]+/grocycode|stockentry/[^/?]+/label|manifest)(?:\\?|$)";

  const escapedBase = base.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const routePrefix = `${escapedBase}/${base.replace(/\/+$/, "").endsWith("/index.php") ? "" : "(?:index\\.php/)?"}`;

  const apiProxy = {
    target: process.env.GROCY_API_PROXY || "http://127.0.0.1:8000",
    changeOrigin: false,
  };

  const loginProxy: ProxyOptions = {
    ...apiProxy,
    bypass(request) {
      return request.method === "GET" || request.method === "HEAD" ? request.url : undefined;
    },
  };

  return {
    base,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
    ],
    server: {
      port: 5173,
      cors: { preflightContinue: true },
      proxy: {
        "/api/": apiProxy,
        [apiPrefix]: apiProxy,
        "/files": apiProxy,
        [filesPrefix]: apiProxy,
        [`^${routePrefix}api/`]: apiProxy,
        [`^${routePrefix}files/`]: apiProxy,
        [`^${routePrefix}${resourcePaths}`]: apiProxy,
        [`^${routePrefix}login(?:\\?|$)`]: loginProxy,
        [`^${routePrefix}logout(?:\\?|$)`]: apiProxy,
      },
    },
  };
});
