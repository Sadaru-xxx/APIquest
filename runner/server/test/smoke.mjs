// 実行サーバーの動作確認。RUNNER_URL と RUNNER_TOKEN を指定して実行する
//   RUNNER_URL=https://runner.example.com/mcp RUNNER_TOKEN=... node test/smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const URL_ = process.env.RUNNER_URL ?? 'http://localhost:8080/mcp';
const TOKEN = process.env.RUNNER_TOKEN;
if (!TOKEN) throw new Error('RUNNER_TOKEN を指定してください');
let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failed++;
};
const callBody = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_java', arguments: { files: [{ path: 'Main.java', content: 'public class Main { public static void main(String[] a) { System.out.println("x"); } }' }] } } };
const post = (headers) => fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(callBody) });

// 1. 認証なし・誤ったトークンでは run_java を呼べない
let r = await post({});
check('トークンなしの tools/call は 401', r.status === 401, `status=${r.status}`);
r = await post({ Authorization: 'Bearer ' + 'x'.repeat(64) });
check('誤ったトークンの tools/call は 401', r.status === 401, `status=${r.status}`);
r = await post({ Authorization: 'Basic ' + Buffer.from('a:b').toString('base64') });
check('Bearer 以外の認証は 401', r.status === 401, `status=${r.status}`);

// 2. 正しいトークンで MCP として使える
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
const tools = await client.listTools();
check('run_java が公開されている', tools.tools.some((t) => t.name === 'run_java'));

const run = (files, extra = {}) => client.callTool({ name: 'run_java', arguments: { files, ...extra } }).then((x) => x.structuredContent ?? x);
let out = await run([{ path: 'Main.java', content: 'public class Main { public static void main(String[] args) { int x = 3; int y = x++; System.out.println(x + "," + y); } }' }]);
check('実行できる(4,3)', out.compile === 'ok' && out.stdout.trim() === '4,3', `jdk=${out.jdk} ${out.durationMs}ms`);
check('JDK 17 で動いている', /^17\./.test(out.jdk ?? ''), out.jdk);
out = await run([{ path: 'Main.java', content: 'public class Main {\n    public static void main(String[] args) {\n        int x = 10;\n        if (x = 10) {}\n    }\n}' }]);
check('コンパイルエラーを日本語で返す', out.compile === 'error' && /Main\.java:4: エラー: 不適合な型/.test(out.javac), out.javac.split('\n')[0]);
out = await run([{ path: 'ex4/SampleImpl.java', content: 'package ex4;\npublic class SampleImpl { public static void main(String[] args) { System.out.println(args[0] + " " + args[1]); } }' }], { mainClass: 'ex4.SampleImpl', args: ['java', 'one', 'two'] });
check('パッケージとコマンドライン引数', out.stdout.trim() === 'java one', out.command);
out = await run([{ path: 'Main.java', content: 'public class Main { public static void main(String[] a) { System.out.println(10 / 0); } }' }]);
check('例外は標準エラーに出る', out.exitCode === 1 && /ArithmeticException/.test(out.stderr));
out = await run([{ path: 'Main.java', content: 'public class Main { public static void main(String[] a) throws Exception { new java.net.Socket("1.1.1.1", 80); } }' }]);
check('ネットワークに出られない', /Network is unreachable|UnknownHost|ConnectException/.test(out.stderr));
if (process.env.SMOKE_SLOW) {
  out = await run([{ path: 'Main.java', content: 'public class Main { public static void main(String[] a) { while (true) {} } }' }]);
  check('無限ループは10秒で打ち切る', out.timedOut === true, `${out.durationMs}ms`);
}
const bad = await client.callTool({ name: 'run_java', arguments: { files: [{ path: '../etc/passwd.java', content: 'x' }] } });
check('不正なファイル名は拒否する', bad.isError === true, bad.content?.[0]?.text);
await client.close();
console.log(failed ? `\n${failed}件 NG` : '\nすべて OK');
process.exit(failed ? 1 : 0);
