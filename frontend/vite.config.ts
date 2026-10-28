import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, import.meta.dirname);
  const base = environment.VITE_BASE_PATH?.trim() || "/";
  const apiPrefix = `${base.replace(/\/$/, "")}/api`;
  const filesPrefix = `${base.replace(/\/$/, "")}/files`;

  const resourcePaths =
    "(?:(?:product|recipe|chore|battery|stockentry)/[^/?]+/grocycode|stockentry/[^/?]+/label)(?:\\?|$)";

  const escapedBase = base.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const apiProxy = {
    target: process.env.GROCY_API_PROXY || "http://127.0.0.1:8000",
    changeOrigin: true,
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
      proxy: {
        "/api": apiProxy,
        [apiPrefix]: apiProxy,
        "/files": apiProxy,
        [filesPrefix]: apiProxy,
        [`^${escapedBase}/${resourcePaths}`]: apiProxy,
      },
    },
  };
});
