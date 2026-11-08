FROM ubuntu:24.04 AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
# NSH's release currently provides an x86_64 Linux toolchain.
RUN test "$(uname -m)" = x86_64 \
    && curl -fsSL https://github.com/longbridge/nsh/releases/download/v0.4.0/nsh-linux-x86_64.tar.gz -o /tmp/nsh.tar.gz \
    && echo '8806121aebf40bb51f8fb6aa703722fbb01253f9a435759c18d53beece1ec976  /tmp/nsh.tar.gz' | sha256sum -c - \
    && tar xzf /tmp/nsh.tar.gz -C /opt && rm /tmp/nsh.tar.gz
WORKDIR /app
COPY . .
RUN /opt/nsh/bin/nsh check . && /opt/nsh/bin/nsh package . --target web -o /out

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build ["/out/Grocy Next/", "/usr/share/nginx/html/"]
EXPOSE 80
