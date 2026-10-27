FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build
RUN node -e 'const fs = require("node:fs"); const base = process.env.VITE_BASE_PATH.trim().replace(/\/+$/, "") + "/"; if (!base.startsWith("/")) throw new Error("VITE_BASE_PATH must start with /"); fs.writeFileSync("nginx.conf", fs.readFileSync("nginx.conf", "utf8").replaceAll("__GROCY_WEB_BASE__", base));'

FROM nginx:1.28-alpine
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
