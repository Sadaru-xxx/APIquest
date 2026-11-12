// OAuth の一連の流れを確かめる(クライアント登録 → 認可画面 → パスフレーズ → トークン → run_java → リフレッシュ)
//   RUNNER_BASE=https://runner.example.com RUNNER_PASSPHRASE=... node test/oauth-flow.mjs
//   サーバー内で RUNNER_BASE=http://localhost:8080 として実行した場合も、メタデータが示す公開 URL の
//   パスを RUNNER_BASE 宛てに読み替えて確認する(DNS や HTTPS の準備前でも試せる)
import crypto from 'node:crypto';
const BASE = (process.env.RUNNER_BASE ?? 'http://localhost:8080').replace(/\/$/, '');
const PASS = process.env.RUNNER_PASSPHRASE;
if (!PASS) throw new Error('RUNNER_PASSPHRASE を指定してください');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
let failed = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'OK ' : 'NG '} ${n}${x ? '  ' + x : ''}`); if (!c) failed++; };
const j = (r) => r.json();

const pr = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`).then(j);
check('保護リソースのメタデータ', Array.isArray(pr.authorization_servers) && pr.resource?.endsWith('/mcp'), pr.authorization_servers?.[0]);
const as = await fetch(`${BASE}/.well-known/oauth-authorization-server`).then(j);
const local = (u) => { const x = new URL(u); const b = new URL(BASE); x.protocol = b.protocol; x.host = b.host; return x.toString(); };
for (const k of ['registration_endpoint', 'authorization_endpoint', 'token_endpoint', 'revocation_endpoint']) if (as[k]) as[k] = local(as[k]);
check('認可サーバーのメタデータ(PKCE S256)', as.code_challenge_methods_supported?.includes('S256') && !!as.registration_endpoint);
const unauth = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('未認証の 401 に resource_metadata が付く', unauth.status === 401 && /resource_metadata=/.test(unauth.headers.get('www-authenticate') ?? ''));

let r = await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'evil', redirect_uris: ['https://evil.example/cb'], token_endpoint_auth_method: 'none' }) });
check('claude.ai 以外へのリダイレクトは登録できない', r.status === 400, `status=${r.status}`);
const client = await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) }).then(j);
check('クライアント登録', !!client.client_id);

const verifierStr = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifierStr).digest('base64url');
const authUrl = new URL(as.authorization_endpoint);
for (const [k, v] of Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st123', resource: pr.resource, scope: 'run_java' })) authUrl.searchParams.set(k, v);
const page = await fetch(authUrl, { redirect: 'manual' }).then((x) => x.text());
const reqId = /name="request_id" value="([^"]+)"/.exec(page)?.[1];
check('認可画面が表示される', !!reqId && page.includes('パスフレーズ'));
const post = (pass) => fetch(`${BASE}/authorize/confirm`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: reqId, passphrase: pass }) });
r = await post('wrong-passphrase-xxxx');
check('違うパスフレーズでは許可されない', r.status === 401 && !r.headers.get('location'), `status=${r.status}`);
r = await post(PASS);
const loc = r.headers.get('location') ?? '';
const code = new URL(loc, BASE).searchParams.get('code');
check('正しいパスフレーズで claude.ai へリダイレクト', r.status === 302 && loc.startsWith(REDIRECT) && new URL(loc).searchParams.get('state') === 'st123');

const tokenReq = (params) => fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
r = await tokenReq({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: 'x'.repeat(43), resource: pr.resource });
check('PKCE の検証値が違うとトークンを出さない', r.status === 400, `status=${r.status}`);
// 認可コードは1回で無効になるため、もう一度認可からやり直す
const page2 = await fetch(authUrl, { redirect: 'manual' }).then((x) => x.text());
const reqId2 = /name="request_id" value="([^"]+)"/.exec(page2)?.[1];
r = await fetch(`${BASE}/authorize/confirm`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: reqId2, passphrase: PASS }) });
const code2 = new URL(r.headers.get('location'), BASE).searchParams.get('code');
const tok = await tokenReq({ grant_type: 'authorization_code', code: code2, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifierStr, resource: pr.resource }).then(j);
check('アクセストークンを取得', !!tok.access_token && !!tok.refresh_token, `expires_in=${tok.expires_in}`);

const call = (t) => fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_java', arguments: { files: [{ path: 'Main.java', content: 'public class Main { public static void main(String[] a) { System.out.println(6 * 7); } }' }] } } }) });
r = await call(tok.access_token);
const out = r.status === 200 ? (await r.json()).result?.structuredContent : null;
check('OAuth のトークンで run_java を実行', out?.stdout?.trim() === '42', `status=${r.status}`);

const tok2 = await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id }).then(j);
check('リフレッシュトークンで更新', !!tok2.access_token && tok2.refresh_token !== tok.refresh_token);
r = await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id });
check('使ったリフレッシュトークンは再利用できない', r.status === 400, `status=${r.status}`);
console.log(failed ? `\n${failed}件 NG` : '\nすべて OK');
process.exit(failed ? 1 : 0);
