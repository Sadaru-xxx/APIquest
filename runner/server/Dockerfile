# Java Silver 実行サーバー(リモート MCP)
# ホストの Docker を使ってサンドボックスコンテナを起動するため、docker CLI を同梱する
ARG NODE_IMAGE=node:22-bookworm-slim
ARG DOCKER_CLI_IMAGE=docker:27-cli
FROM ${DOCKER_CLI_IMAGE} AS dockercli

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    DOCKER_CONFIG=/tmp/.docker
WORKDIR /app
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY test ./test
# OAuth のクライアントとトークン(ハッシュ)を保存する場所。名前付きボリュームをここにマウントする
RUN mkdir -p /data && chown 1000:1000 /data
USER 1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
