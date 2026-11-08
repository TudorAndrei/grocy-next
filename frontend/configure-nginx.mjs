import fs from "node:fs";

const base = (process.env.VITE_BASE_PATH ?? "/").trim().replace(/\/+$/, "") + "/";

if (!base.startsWith("/")) throw new Error("VITE_BASE_PATH must start with /");

const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const routePrefix = `${escapedBase}${base.endsWith("/index.php/") ? "" : "(?:index\\.php/)?"}`;

fs.writeFileSync(
  "nginx.conf",
  fs
    .readFileSync("nginx.conf", "utf8")
    .replaceAll("__GROCY_WEB_BASE__", base)
    .replaceAll("__GROCY_WEB_ROUTE_REGEX__", routePrefix),
);
