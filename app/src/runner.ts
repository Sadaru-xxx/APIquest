// 実行サーバー(claude.ai のカスタムコネクタ「Java Silver Runner」)の呼び出し
// ページからは claude.ai のコネクタ経由でだけ呼ぶ。トークンはページに渡らない(認証はコネクタ側の設定)

export const RUNNER_SERVER = 'Java Silver Runner';
export const RUNNER_TOOL = 'run_java';

export type RunnerResult = {
  jdk: string;
  compile: 'ok' | 'error' | 'timeout';
  javac: string;
  run: 'done' | 'skipped' | 'killed';
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  truncated: { javac: boolean; stdout: boolean; stderr: boolean };
  durationMs: number;
  command: string;
};

export type RunnerFailure =
  | 'unavailable' // このページの表示環境ではコネクタを使えない(claude.ai の外など)
  | 'not_connected' // コネクタが追加されていない
  | 'needs_reauth'
  | 'not_allowed' // このページでの利用が許可されていない
  | 'approval_required'
  | 'server_unavailable'
  | 'tool_error'
  | 'other';

export type RunnerStatus = 'unavailable' | 'not_connected' | 'needs_reauth' | 'ready';

type McpError = { code?: string; message?: string; result?: { content?: { type: string; text?: string }[] } };
type Mcp = {
  listTools(server?: string): Promise<{ servers: { server: string; authStatus: string; tools: { name: string }[] }[] }>;
  callTool(server: string, tool: string, input: unknown): Promise<{ payload?: unknown; structuredContent?: unknown }>;
};
type ClaudeHost = { use(name: string): Promise<unknown> };

let mcpPromise: Promise<Mcp | null> | null = null;
function getMcp(): Promise<Mcp | null> {
  if (!mcpPromise) {
    mcpPromise = (async () => {
      let host: ClaudeHost | undefined;
      for (let i = 0; i < 30 && !host?.use; i++) {
        host = (window as unknown as { claude?: ClaudeHost }).claude;
        if (!host?.use) await new Promise((r) => setTimeout(r, 100));
      }
      if (!host?.use) return null;
      const m = await Promise.race([host.use('mcp'), new Promise<null>((r) => setTimeout(() => r(null), 10000))]).catch(() => null);
      return (m as Mcp | null) ?? null;
    })();
  }
  return mcpPromise;
}

/** 表示用の状態。コネクタをまだ一度も使っていない場合は ready になり、実際の可否は最初の実行で分かる */
export async function runnerStatus(): Promise<RunnerStatus> {
  const mcp = await getMcp();
  if (!mcp) return 'unavailable';
  try {
    const r = await mcp.listTools(RUNNER_SERVER);
    const s = r.servers.find((x) => x.server === RUNNER_SERVER);
    if (!s) return 'not_connected';
    if (s.authStatus === 'needs_reauth') return 'needs_reauth';
    return s.tools.length > 0 || s.authStatus === 'unknown' ? 'ready' : 'not_connected';
  } catch {
    return 'ready';
  }
}

export async function runJava(input: { files: { path: string; content: string }[]; mainClass?: string; args?: string[] }): Promise<{ ok: true; result: RunnerResult } | { ok: false; reason: RunnerFailure; message: string }> {
  const mcp = await getMcp();
  if (!mcp) return { ok: false, reason: 'unavailable', message: '' };
  try {
    const r = await mcp.callTool(RUNNER_SERVER, RUNNER_TOOL, input);
    const result = (r.payload ?? r.structuredContent) as RunnerResult | undefined;
    if (!result || typeof result !== 'object' || !('compile' in result)) return { ok: false, reason: 'other', message: '実行サーバーの応答を読めませんでした' };
    return { ok: true, result };
  } catch (e) {
    const err = e as McpError;
    const text = err.result?.content?.find((c) => c.type === 'text')?.text;
    switch (err.code) {
      case 'server_not_connected':
      case 'selection_required':
      case 'server_not_found':
        return { ok: false, reason: 'not_connected', message: '' };
      case 'needs_reauth':
        return { ok: false, reason: 'needs_reauth', message: '' };
      case 'not_in_manifest':
      case 'blocked_by_policy':
        return { ok: false, reason: 'not_allowed', message: '' };
      case 'approval_required':
        return { ok: false, reason: 'approval_required', message: '' };
      case 'server_unavailable':
      case 'rate_limited':
        return { ok: false, reason: 'server_unavailable', message: '' };
      case 'tool_error':
        return { ok: false, reason: 'tool_error', message: text ?? err.message ?? '' };
      case 'not_granted':
      case 'capability_disabled':
      case 'capability_removed':
        return { ok: false, reason: 'unavailable', message: '' };
      default:
        return { ok: false, reason: 'other', message: err.message ?? '' };
    }
  }
}

export const FAILURE_TEXT: Record<RunnerFailure, string> = {
  unavailable: 'この表示環境では実行サーバーを使えません。claude.ai でこのアプリを開くと、書き換えたコードも実行できます(実行サーバーの設定が必要です)。',
  not_connected: `実行サーバーのコネクタ「${RUNNER_SERVER}」が見つかりません。claude.ai の「カスタマイズ → コネクタ」で、この名前のカスタムコネクタを追加すると、書き換えたコードを JDK 17 で実行できます。`,
  needs_reauth: `コネクタ「${RUNNER_SERVER}」の接続が切れています。claude.ai の「カスタマイズ → コネクタ」で接続し直してください。`,
  not_allowed: `このページからコネクタ「${RUNNER_SERVER}」を使う許可がありません。ページを開き直して、確認が出たら許可してください。`,
  approval_required: '実行サーバーを使うには許可が必要です。もう一度「実行」を押すと確認が表示されます。',
  server_unavailable: '実行サーバーに接続できませんでした。サーバーが止まっていないか確認し、少し待ってからもう一度実行してください。',
  tool_error: '実行サーバーが実行を断りました。',
  other: '実行サーバーでの実行に失敗しました。',
};
