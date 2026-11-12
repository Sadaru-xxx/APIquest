// サンドボックスコンテナでの Java 実行と、同時実行数の制御
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { makeTar } from './tar.mjs';

export const LIMITS = {
  maxFiles: 10,
  maxTotalBytes: 64 * 1024,
  maxArgs: 10,
  maxArgLength: 200,
  outerTimeoutMs: 35_000, // javac 10秒 + java 10秒 + コンテナ起動の余裕。超えたらコンテナごと停止
};

const PATH_RE = /^[A-Za-z_$][\w$]*(\/[A-Za-z_$][\w$]*)*\.java$/;
const MAIN_RE = /^([A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*|[A-Za-z_$][\w$]*(\/[A-Za-z_$][\w$]*)*\.java)$/;

export class InputError extends Error {}
export class BusyError extends Error {}
export class SandboxError extends Error {}

/** zod の型チェックに加えて、パス・サイズ・main クラスを検査して正規化する */
export function normalizeInput({ files, mainClass, args }) {
  if (!Array.isArray(files) || files.length === 0) throw new InputError('files には1つ以上のファイルが必要です');
  if (files.length > LIMITS.maxFiles) throw new InputError(`ファイルは${LIMITS.maxFiles}個までです`);
  const seen = new Set();
  let total = 0;
  for (const f of files) {
    if (!PATH_RE.test(f.path) || Buffer.byteLength(f.path) > 100) throw new InputError(`ファイル名が不正です: ${String(f.path).slice(0, 80)}`);
    if (seen.has(f.path)) throw new InputError(`ファイル名が重複しています: ${f.path}`);
    seen.add(f.path);
    total += Buffer.byteLength(f.content, 'utf8');
  }
  if (total > LIMITS.maxTotalBytes) throw new InputError(`ソースの合計は${LIMITS.maxTotalBytes / 1024}KBまでです`);
  const main = mainClass ?? 'Main';
  if (!MAIN_RE.test(main)) throw new InputError('mainClass が不正です(例: Main、ex4.SampleImpl、Test.java)');
  if (main.endsWith('.java') && !seen.has(main)) throw new InputError(`ソースファイルモードで指定した ${main} が files にありません`);
  const a = args ?? [];
  if (a.length > LIMITS.maxArgs || a.some((x) => typeof x !== 'string' || x.length > LIMITS.maxArgLength || x.includes('\n'))) {
    throw new InputError(`args は改行を含まない${LIMITS.maxArgLength}文字以内の文字列を${LIMITS.maxArgs}個までです`);
  }
  return { files, mainClass: main, args: a };
}

/** 同時実行数と待ち行列の上限 */
export class Limiter {
  constructor(max, queue) {
    this.max = max;
    this.queue = queue;
    this.active = 0;
    this.waiting = [];
  }
  async run(fn) {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.queue) throw new BusyError('実行サーバーが混み合っています。少し待ってから実行してください');
      await new Promise((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/** 1回の実行ごとに、ネットワークなし・読み取り専用・資源制限付きの使い捨てコンテナを起動する */
export function dockerArgs(name, image) {
  return [
    'run', '--rm', '-i', '--name', name,
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/work:rw,noexec,nosuid,nodev,size=32m,uid=10001,gid=10001,mode=0700',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001',
    '--memory', '256m', '--memory-swap', '256m',
    '--cpus', '1',
    '--pids-limit', '64',
    '--ulimit', 'nofile=256:256',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '10001:10001',
    '--log-driver', 'none',
    image,
  ];
}

export function createDockerExecutor({ image, docker = 'docker' }) {
  return async function execute({ files, mainClass, args }) {
    const tar = makeTar([
      ...files.map((f) => ({ name: f.path, data: Buffer.from(f.content, 'utf8') })),
      { name: '.main', data: Buffer.from(mainClass) },
      { name: '.args', data: Buffer.from(args.join('\n')) },
    ]);
    const name = `jsr-${randomUUID()}`;
    const { code, stdout } = await runProcess(docker, dockerArgs(name, image), tar, LIMITS.outerTimeoutMs, () => {
      spawn(docker, ['kill', name], { stdio: 'ignore' }).on('error', () => {});
    });
    const line = stdout.trim().split('\n').pop() ?? '';
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      // コンテナ全体がメモリ上限などで強制終了された
      if (code === 137) return killedResult();
      throw new SandboxError('サンドボックスの応答を読めませんでした');
    }
    if (r.error) throw new InputError(`入力を展開できませんでした(${r.error})`);
    const dec = (s) => Buffer.from(s ?? '', 'base64').toString('utf8');
    return {
      jdk: r.jdk,
      compile: r.compile,
      javac: dec(r.javac),
      run: r.run,
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      stdout: dec(r.stdout),
      stderr: dec(r.stderr),
      truncated: r.truncated,
      durationMs: r.durationMs,
      command: `java ${[mainClass, ...args].join(' ')}`,
    };
  };
}

function killedResult() {
  return {
    jdk: '',
    compile: 'ok',
    javac: '',
    run: 'killed',
    exitCode: 137,
    timedOut: false,
    stdout: '',
    stderr: 'メモリなどの上限を超えたため、実行を強制終了しました。',
    truncated: { javac: false, stdout: false, stderr: false },
    durationMs: 0,
    command: '',
  };
}

function runProcess(cmd, args, input, timeoutMs, onTimeout) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let size = 0;
    const timer = setTimeout(() => {
      onTimeout();
      setTimeout(() => p.kill('SIGKILL'), 3000).unref();
    }, timeoutMs);
    p.stdout.on('data', (d) => {
      size += d.length;
      if (size <= 1024 * 1024) out.push(d); // 1MB を超える分は捨てる(本来は run.sh 側で 64KB に切っている)
    });
    p.stderr.resume();
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(new SandboxError(`docker を起動できませんでした: ${e.message}`));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8') });
    });
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}

/** 起動時に、サンドボックスイメージがあるか確かめる */
export function checkImage(image, docker = 'docker') {
  return new Promise((resolve) => {
    const p = spawn(docker, ['image', 'inspect', image], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}
