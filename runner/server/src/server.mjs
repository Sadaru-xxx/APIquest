// Java Silver 演習アプリ用の実行サーバー(リモート MCP)
// - /mcp はすべて Bearer トークン必須。トークンがない・違うリクエストは MCP の処理に入る前に 401 で拒否する
//   トークンは2種類: (1) 固定トークン RUNNER_TOKENS(コネクタの「Request headers」と動作確認用)
//                    (2) OAuth で発行したトークン(コネクタの「Sign in」。持ち主のパスフレーズで許可)
// - run_java は、ネットワークなし・読み取り専用・CPU 1 / メモリ 256MB / プロセス 64・javac と java 各10秒の使い捨てコンテナで実行する
import crypto from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { z } from 'zod';
import { BusyError, InputError, Limiter, checkImage, createDockerExecutor, normalizeInput } from './executor.mjs';
import { createOAuthProvider } from './oauth.mjs';

const env = process.env;
const cfg = {
  port: Number(env.PORT ?? 8080),
  publicUrl: env.RUNNER_PUBLIC_URL ?? (env.RUNNER_DOMAIN ? `https://${env.RUNNER_DOMAIN}` : ''),
  tokens: (env.RUNNER_TOKENS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  passphrase: env.RUNNER_OWNER_PASSPHRASE ?? '',
  redirectPrefixes: (env.RUNNER_OAUTH_REDIRECT_PREFIXES ?? 'https://claude.ai/,https://claude.com/').split(',').map((s) => s.trim()).filter(Boolean),
  storeFile: env.RUNNER_STORE ?? '/data/oauth.json',
  image: env.SANDBOX_IMAGE ?? 'java-silver-sandbox:17',
  concurrency: Number(env.RUNNER_CONCURRENCY ?? 4),
  queue: Number(env.RUNNER_QUEUE ?? 16),
  ratePerMin: Number(env.RUNNER_RATE_PER_MIN ?? 120),
};

// ── 起動時チェック: 認証の設定がなければ起動しない ──
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
if (cfg.tokens.length === 0) fail('RUNNER_TOKENS が設定されていません。認証なしでは起動しません(openssl rand -hex 32 で作成してください)');
if (cfg.tokens.some((t) => t.length < 32)) fail('RUNNER_TOKENS の各トークンは32文字以上にしてください');
if (cfg.passphrase.length < 16) fail('RUNNER_OWNER_PASSPHRASE を16文字以上で設定してください(OAuth の許可画面で使います)');
if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cfg.publicUrl)) fail('RUNNER_DOMAIN(または RUNNER_PUBLIC_URL)を設定してください');
if (!(await checkImage(cfg.image))) fail(`サンドボックスイメージ ${cfg.image} が見つかりません。先に docker build してください`);

const mcpUrl = new URL('/mcp', cfg.publicUrl);
const { provider, confirm } = createOAuthProvider({ passphrase: cfg.passphrase, storeFile: cfg.storeFile, allowedRedirectPrefixes: cfg.redirectPrefixes, resource: mcpUrl });

// 固定トークンと OAuth トークンの両方を確かめる
const digest = (s) => crypto.createHash('sha256').update(s).digest();
const staticTokens = cfg.tokens.map((t) => ({ id: 'static-' + digest(t).toString('hex').slice(0, 8), d: digest(t) }));
const verifier = {
  async verifyAccessToken(tk) {
    const d = digest(tk);
    let hit = null;
    for (const t of staticTokens) if (crypto.timingSafeEqual(t.d, d)) hit = t.id;
    if (hit) return { token: tk, clientId: hit, scopes: ['run_java'], expiresAt: Math.floor(Date.now() / 1000) + 3600, resource: mcpUrl };
    try {
      return await provider.verifyAccessToken(tk);
    } catch {
      throw new InvalidTokenError('Invalid or expired token');
    }
  },
};

const limiter = new Limiter(cfg.concurrency, cfg.queue);
const execute = createDockerExecutor({ image: cfg.image });

const resultSchema = z.object({
  jdk: z.string(),
  compile: z.enum(['ok', 'error', 'timeout']),
  javac: z.string(),
  run: z.enum(['done', 'skipped', 'killed']),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.object({ javac: z.boolean(), stdout: z.boolean(), stderr: z.boolean() }),
  durationMs: z.number(),
  command: z.string(),
});

function buildMcp(log) {
  const server = new McpServer({ name: 'java-silver-runner', version: '1.1.0' });
  server.registerTool(
    'run_java',
    {
      title: 'Java を JDK 17 で実行',
      description:
        'Java のソースを JDK 17 でコンパイル(javac)して実行(java)し、javac の出力(日本語)、標準出力、標準エラー、終了コードを返す。' +
        'ネットワークなし・CPU 1・メモリ 256MB・javac と java はそれぞれ10秒で打ち切り。files の path はパッケージに合わせたパス(例: Main.java、ex4/SampleImpl.java)。' +
        'mainClass は実行するクラスの完全修飾名(既定は Main)。Test.java のように .java で終わる値を指定するとソースファイルモード(java Test.java)で実行する。',
      inputSchema: {
        files: z.array(z.object({ path: z.string().max(100), content: z.string() })).min(1).max(10).describe('ソースファイル'),
        mainClass: z.string().max(200).optional().describe('実行するクラス(既定 Main)。Test.java のように指定するとソースファイルモード'),
        args: z.array(z.string().max(200)).max(10).optional().describe('コマンドライン引数'),
      },
      outputSchema: resultSchema.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      log.tool = 'run_java';
      try {
        const norm = normalizeInput(input);
        log.files = norm.files.length;
        const r = await limiter.run(() => execute(norm));
        log.compile = r.compile;
        log.run = r.run;
        return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
      } catch (e) {
        const known = e instanceof InputError || e instanceof BusyError;
        log.error = e.constructor.name;
        if (!known) console.error(e);
        return { isError: true, content: [{ type: 'text', text: known ? e.message : '実行中にサーバー側の問題が発生しました' }] };
      }
    },
  );
  return server;
}

const rpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null });
const app = express();
app.set('trust proxy', 1); // Caddy の後ろで動かす
app.disable('x-powered-by');

// アクセスログ(パスだけ。クエリ文字列・トークン・コードは記録しない)
app.use((req, res, next) => {
  const started = Date.now();
  res.locals.log = { t: new Date().toISOString(), ip: req.ip, method: req.method, path: req.path };
  res.on('finish', () => console.log(JSON.stringify({ ...res.locals.log, status: res.statusCode, ms: Date.now() - started })));
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// OAuth(メタデータ・クライアント登録・認可・トークン・取り消し)
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(cfg.publicUrl),
    resourceServerUrl: mcpUrl,
    resourceName: 'Java Silver Runner',
    scopesSupported: ['run_java'],
  }),
);
app.post(
  '/authorize/confirm',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false }),
  express.urlencoded({ extended: false, limit: '10kb' }),
  confirm,
);

// MCP(認証 → レート制限 → 本文の読み取り → 処理 の順。認証前には本文を読まない)
const auth = requireBearerAuth({ verifier, expectedResource: mcpUrl, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });
const perToken = rateLimit({
  windowMs: 60 * 1000,
  limit: cfg.ratePerMin,
  keyGenerator: (req) => req.auth?.clientId ?? 'unknown',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rpcError(-32002, 'Too many requests'),
});
const markAuth = (req, res, next) => {
  res.locals.log.auth = req.auth?.clientId?.startsWith('static-') ? req.auth.clientId : req.auth ? 'oauth' : 'none';
  next();
};
app.post('/mcp', auth, markAuth, perToken, express.json({ limit: '512kb' }), async (req, res) => {
  const log = res.locals.log;
  const body = req.body;
  log.rpc = Array.isArray(body) ? body.map((m) => m.method).join(',') : body?.method;
  const mcp = buildMcp(log);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close().catch(() => {});
    mcp.close().catch(() => {});
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal error'));
  }
});
app.all('/mcp', auth, (_req, res) => res.status(405).set('Allow', 'POST').json(rpcError(-32000, 'Method not allowed')));
app.use((_req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, _req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json(rpcError(-32600, status === 413 ? 'Request too large' : 'Bad request'));
});

const httpServer = app.listen(cfg.port, () => {
  console.log(
    JSON.stringify({ t: new Date().toISOString(), msg: 'java-silver-runner started', port: cfg.port, mcp: mcpUrl.toString(), image: cfg.image, staticTokens: staticTokens.length, oauth: true, concurrency: cfg.concurrency }),
  );
});
httpServer.requestTimeout = 60_000;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => httpServer.close(() => process.exit(0)));
