# Java Silver Runner(JDK 17 実行サーバー)

Java Silver 演習アプリで「書き換えたコード」を JDK 17 で実行するためのリモート MCP サーバーです。
claude.ai のカスタムコネクタ「Java Silver Runner」として登録して使います。詳しい手順は [docs/runner-deployment.md](../docs/runner-deployment.md) を見てください。

## 構成

| パス | 内容 |
| --- | --- |
| `sandbox/` | 1回の実行ごとに起動する使い捨てコンテナ(JDK 17・非 root・ネットワークなし) |
| `server/` | リモート MCP サーバー(Node.js)。`run_java` ツールを1つだけ公開 |
| `compose.yaml` | server と Caddy(HTTPS)の起動設定 |
| `Caddyfile` | HTTPS の終端(証明書は自動取得) |
| `.env.example` | 設定の雛形 |

## 最短の手順

```bash
# 1. サンドボックスイメージを作る(JDK 17)
docker build -t java-silver-sandbox:17 ./sandbox

# 2. 設定を作る(ドメインは自分のものに置き換える)
cp .env.example .env
sed -i "s|^RUNNER_DOMAIN=.*|RUNNER_DOMAIN=runner.example.com|" .env
sed -i "s|^RUNNER_OWNER_PASSPHRASE=.*|RUNNER_OWNER_PASSPHRASE=$(openssl rand -base64 18)|" .env
sed -i "s|^RUNNER_TOKENS=.*|RUNNER_TOKENS=$(openssl rand -hex 32)|" .env
sed -i "s|^DOCKER_GID=.*|DOCKER_GID=$(stat -c %g /var/run/docker.sock)|" .env
chmod 600 .env

# 3. 起動
docker compose up -d --build

# 4. 動作確認(すべて OK になること)
docker compose exec -e RUNNER_URL=http://localhost:8080/mcp \
  -e RUNNER_TOKEN="$(grep ^RUNNER_TOKENS= .env | cut -d= -f2 | cut -d, -f1)" server node test/smoke.mjs
```

## 安全のための設定(変更しないこと)

- `/mcp` はすべて Bearer トークン必須(OAuth または固定トークン)。トークンやパスフレーズがないと起動しません
- 実行は `--network none`・読み取り専用・CPU 1・メモリ 256MB・プロセス 64・javac と java 各10秒
- サーバーはホストの Docker を操作するため、このサーバーは実行サーバー専用にしてください
