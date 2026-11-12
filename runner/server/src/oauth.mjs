// claude.ai のカスタムコネクタ用の最小限の OAuth 2.1 認可サーバー(1人の持ち主向け)
// - クライアント登録(DCR)は claude.ai / claude.com へのリダイレクト URI だけを受け付ける
// - 認可画面で持ち主のパスフレーズを入力したときだけ認可コードを発行する(PKCE 必須。検証は SDK が行う)
// - トークンはハッシュだけを保存する。アクセストークン1時間・リフレッシュトークン30日(使うたびに入れ替え)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const ACCESS_TTL = 60 * 60; // 秒
const REFRESH_TTL = 30 * 24 * 60 * 60;
const CODE_TTL = 5 * 60 * 1000; // ミリ秒
const PENDING_TTL = 10 * 60 * 1000;
const SCOPE = 'run_java';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createOAuthProvider({ passphrase, storeFile, allowedRedirectPrefixes, resource }) {
  const db = load(storeFile);
  const pending = new Map(); // 認可画面の表示中の要求(サーバー側に保持し、フォームには ID だけを渡す)
  const codes = new Map();
  const passDigest = crypto.createHash('sha256').update(passphrase).digest();

  let saveTimer = null;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      purge();
      const tmp = storeFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
      fs.renameSync(tmp, storeFile);
    }, 200);
  };
  const purge = () => {
    const now = Math.floor(Date.now() / 1000);
    for (const k of ['access', 'refresh']) for (const [h, t] of Object.entries(db[k])) if (t.expiresAt < now) delete db[k][h];
  };

  function issueTokens(clientId, scopes, res) {
    const now = Math.floor(Date.now() / 1000);
    const access = token();
    const refresh = token();
    db.access[sha(access)] = { clientId, scopes, resource: res, expiresAt: now + ACCESS_TTL };
    db.refresh[sha(refresh)] = { clientId, scopes, resource: res, expiresAt: now + REFRESH_TTL };
    save();
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: scopes.join(' ') };
  }

  const clientsStore = {
    getClient: (id) => db.clients[id],
    registerClient: (client) => {
      const uris = client.redirect_uris ?? [];
      const bad = uris.filter((u) => !allowedRedirectPrefixes.some((p) => String(u).startsWith(p)));
      if (uris.length === 0 || bad.length) {
        console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'client registration rejected', redirect_uris: uris }));
        throw new InvalidClientMetadataError(`redirect_uri is not allowed: ${bad.join(', ')}`);
      }
      db.clients[client.client_id] = client;
      save();
      console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'client registered', client_id: client.client_id, client_name: client.client_name, redirect_uris: uris }));
      return client;
    },
  };

  const provider = {
    clientsStore,
    async authorize(client, params, res) {
      const id = token();
      pending.set(id, { clientId: client.client_id, params, expires: Date.now() + PENDING_TTL, failures: 0 });
      sendConsent(res, client, id, '');
    },
    async challengeForAuthorizationCode(client, code) {
      const c = codes.get(code);
      if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Invalid authorization code');
      return c.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, res) {
      const c = codes.get(code);
      codes.delete(code); // 一度しか使えない
      if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Invalid authorization code');
      if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri mismatch');
      return issueTokens(client.client_id, [SCOPE], (res ?? c.resource ?? resource).toString());
    },
    async exchangeRefreshToken(client, refreshToken) {
      const h = sha(refreshToken);
      const t = db.refresh[h];
      if (!t || t.clientId !== client.client_id || t.expiresAt < Math.floor(Date.now() / 1000)) throw new InvalidGrantError('Invalid refresh token');
      delete db.refresh[h]; // 使ったリフレッシュトークンは無効にして入れ替える
      return issueTokens(client.client_id, t.scopes, t.resource);
    },
    async verifyAccessToken(accessToken) {
      const t = db.access[sha(accessToken)];
      if (!t || t.expiresAt < Math.floor(Date.now() / 1000)) throw new InvalidTokenError('Invalid or expired token');
      return { token: accessToken, clientId: t.clientId, scopes: t.scopes, expiresAt: t.expiresAt, resource: new URL(t.resource) };
    },
    async revokeToken(client, { token: tk }) {
      const h = sha(tk);
      for (const k of ['access', 'refresh']) if (db[k][h]?.clientId === client.client_id) delete db[k][h];
      save();
    },
  };

  /** 認可画面のフォーム送信(パスフレーズの確認) */
  function confirm(req, res) {
    const id = String(req.body?.request_id ?? '');
    const p = pending.get(id);
    if (!p || p.expires < Date.now()) {
      pending.delete(id);
      return sendPage(res, 400, '<h1>リクエストの有効期限が切れました</h1><p>claude.ai でコネクタの接続をやり直してください。</p>');
    }
    const client = db.clients[p.clientId];
    const given = crypto.createHash('sha256').update(String(req.body?.passphrase ?? '')).digest();
    if (!client || !crypto.timingSafeEqual(given, passDigest)) {
      p.failures++;
      if (p.failures >= 5) {
        pending.delete(id);
        return sendPage(res, 403, '<h1>パスフレーズが5回違いました</h1><p>claude.ai でコネクタの接続をやり直してください。</p>');
      }
      return sendConsent(res, client, id, 'パスフレーズが違います。');
    }
    pending.delete(id);
    const code = token();
    codes.set(code, {
      clientId: client.client_id,
      codeChallenge: p.params.codeChallenge,
      redirectUri: p.params.redirectUri,
      resource: p.params.resource?.toString(),
      expires: Date.now() + CODE_TTL,
    });
    const to = new URL(p.params.redirectUri);
    to.searchParams.set('code', code);
    if (p.params.state) to.searchParams.set('state', p.params.state);
    console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'authorization granted', client_id: client.client_id }));
    res.redirect(302, to.toString());
  }

  return { provider, confirm };
}

function load(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { clients: d.clients ?? {}, access: d.access ?? {}, refresh: d.refresh ?? {} };
  } catch {
    return { clients: {}, access: {}, refresh: {} };
  }
}

function sendPage(res, status, inner) {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    })
    .send(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Java Silver Runner</title>
<style>body{font:16px/1.7 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#17202b}input{font:inherit;width:100%;padding:.5rem;margin:.5rem 0 1rem;box-sizing:border-box}button{font:inherit;padding:.5rem 1.25rem;background:#0b6b66;color:#fff;border:0;border-radius:8px}.err{color:#c4314b}.muted{color:#586473;font-size:14px}</style>
</head><body>${inner}</body></html>`);
}

function sendConsent(res, client, id, error) {
  sendPage(
    res,
    error ? 401 : 200,
    `<h1>Java Silver Runner の利用を許可</h1>
<p><strong>${esc(client?.client_name || 'クライアント')}</strong> が、この実行サーバーで Java のコードを実行する許可を求めています。</p>
<p class="muted">サーバーの持ち主だけが知っているパスフレーズ(RUNNER_OWNER_PASSPHRASE)を入力してください。</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/authorize/confirm">
<input type="hidden" name="request_id" value="${esc(id)}">
<label for="passphrase">パスフレーズ</label>
<input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required autofocus>
<button type="submit">許可する</button>
</form>`,
  );
}
