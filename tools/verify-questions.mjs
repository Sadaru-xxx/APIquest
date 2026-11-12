#!/usr/bin/env node
// 問題データの全コードを JDK 17 で実行し、正解・選択肢の主張(claim)と一致するかを検証する。
//   node tools/verify-questions.mjs [--java-home /path/to/jdk17] [--write] [--report reports/verification-report.json] [questions/*.json]
// リポジトリのルートで実行する(npm run questions:verify)。ファイルを省略すると questions/ の全分野を検証する。
// --write を付けると、javac の実際のエラーメッセージを explanation.compileErrors に書き戻す。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const javaHome = opt('--java-home') ?? process.env.JAVA_HOME;
const reportPath = opt('--report');
const write = flag('--write');
const files = args.length ? args : readdirSync('questions').filter((f) => f.endsWith('.json') && f !== 'topics.json').map((f) => join('questions', f));
if (!javaHome) {
  console.error('JDK 17 の場所を --java-home か JAVA_HOME で指定してください');
  process.exit(2);
}
const bin = (n) => join(javaHome, 'bin', n);
const env = { ...process.env };
delete env.JAVA_TOOL_OPTIONS; // "Picked up ..." が出力に混ざるのを防ぐ

const ver = spawnSync(bin('java'), ['-version'], { env, encoding: 'utf8' });
const versionLine = (ver.stderr || '').split('\n')[0];
if (!/version "17[."]/.test(versionLine)) {
  console.error('JDK 17 ではありません: ' + versionLine);
  process.exit(2);
}

// ── 実行 ──
function compileAndRun(srcFiles, mainClass = 'Main', progArgs = [], { run = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jsv-'));
  try {
    const src = join(dir, 'src');
    const out = join(dir, 'out');
    mkdirSync(out, { recursive: true });
    const paths = [];
    for (const f of srcFiles) {
      const p = join(src, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.code.join('\n') + '\n');
      paths.push(p);
    }
    const c = spawnSync(bin('javac'), ['-J-Duser.language=ja', '-J-Dfile.encoding=UTF-8', '-encoding', 'UTF-8', '-d', out, ...paths], { env, encoding: 'utf8', timeout: 30000 });
    const diag = (c.stdout || '') + (c.stderr || '');
    const errors = [];
    const re = /^(.+?\.java):(\d+): エラー: (.*)$/gm;
    let m;
    while ((m = re.exec(diag))) errors.push({ file: m[1].slice(src.length + 1), line: Number(m[2]), message: m[3].replace(/:\s*$/, '') });
    const javac = diag.split(src + '/').join('').replace(/^Picked up .*\n/gm, '');
    if (c.status !== 0) return { compile: 'error', errors, javac };
    if (!run) return { compile: 'ok' };
    const r = spawnSync(bin('java'), ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', out, mainClass, ...progArgs], { env, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' });
    const timeout = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL';
    const ex = /^Exception in thread "main" ([\w.$]+)/m.exec(r.stderr || '');
    return { compile: 'ok', stdout: r.stdout || '', stderr: (r.stderr || '').replace(/^Picked up .*\n/gm, ''), exception: ex ? ex[1] : null, timeout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const norm = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

function claimMatches(claim, r) {
  if ('compileError' in claim) {
    if (r.compile !== 'error') return false;
    const want = claim.compileError.lines;
    if (!want) return true;
    const file = claim.compileError.file ?? 'Main.java';
    const got = [...new Set(r.errors.filter((e) => e.file === file).map((e) => e.line))];
    return sameSet(got, want);
  }
  if (r.compile !== 'ok') return false;
  if (claim.timeout) return !!r.timeout;
  if (r.timeout) return false;
  if ('exception' in claim) {
    if (r.exception !== claim.exception) return false;
    return claim.stdout === undefined || norm(r.stdout) === norm(claim.stdout);
  }
  return !r.exception && norm(r.stdout) === norm(claim.stdout);
}

function summarize(r) {
  if (r.compile === 'error') return { result: 'コンパイルエラー', errors: r.errors };
  if (r.compile === 'ok' && r.stdout === undefined) return { result: 'コンパイル成功' };
  if (r.timeout) return { result: 'タイムアウト', stdout: norm(r.stdout) };
  if (r.exception) return { result: '例外', exception: r.exception, stdout: norm(r.stdout) };
  return { result: '正常終了', stdout: norm(r.stdout) };
}

function verifyQuestion(q) {
  const v = q.verify;
  if (v.kind === 'none') return { id: q.id, ok: true, skipped: v.reason };
  if (v.kind === 'program') {
    const mainClass = q.command ? q.command.split(/\s+/)[1] : 'Main';
    const progArgs = q.command ? q.command.split(/\s+/).slice(2) : [];
    const r = compileAndRun(q.files, mainClass, progArgs);
    const matched = q.options.filter((o) => claimMatches(o.claim, r)).map((o) => o.label);
    const ok = sameSet(matched, q.answer);
    const consoleOut = r.compile === 'error' ? { compile: 'error', javac: r.javac } : { compile: 'ok', stdout: r.stdout, stderr: r.stderr, timeout: !!r.timeout };
    return { id: q.id, ok, matched, answer: q.answer, actual: summarize(r), compileErrors: r.errors ?? [], console: consoleOut };
  }
  if (v.kind === 'per-option') {
    const perOption = {};
    const compileErrors = [];
    for (const o of q.options) {
      const code = v.template.flatMap((line) => {
        const i = line.indexOf('{{OPTION}}');
        if (i < 0) return [line];
        const indent = line.slice(0, i);
        return o.code.split('\n').map((l) => indent + l);
      });
      const r = compileAndRun([{ path: 'Main.java', code }], 'Main', [], { run: false });
      perOption[o.label] = r.compile === 'error' ? { result: 'コンパイルエラー', errors: r.errors, javac: r.javac } : { result: 'コンパイル成功' };
      for (const e of r.errors ?? []) compileErrors.push({ option: o.label, ...e });
    }
    const matched = q.options.filter((o) => (v.polarity === 'error') === (perOption[o.label].result === 'コンパイルエラー')).map((o) => o.label);
    const ok = sameSet(matched, q.answer);
    return { id: q.id, ok, matched, answer: q.answer, perOption, compileErrors };
  }
  return { id: q.id, ok: false, error: 'unknown verify kind' };
}


// ── 類題ポリシーの構造チェック ──
// 即時類題(b)は表(a)と同じ構造(識別子・リテラルだけが違う)、復習バリエーション(c)は表と違う構造であること
const JAVA_KW = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var yield record sealed permits'.split(' '));
const SHAPE_TOKEN = /\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[LlFfDd]?\b|[A-Za-z_$][\w$]*|>>>=|<<=|>>=|>>>|->|::|\+\+|--|&&|\|\||[+\-*/%&|^!=<>]=|<<|>>|\S/g;
function shape(code) {
  return (code.match(SHAPE_TOKEN) ?? [])
    .filter((t) => !t.startsWith('//'))
    .map((t) => {
      if (t[0] === '"') return 'STR';
      if (t[0] === "'") return 'CHR';
      if (/^\d/.test(t)) return 'NUM';
      if (t === 'true' || t === 'false') return 'BOOL';
      if (t === 'null') return 'NULL';
      if (/^[A-Za-z_$]/.test(t)) return JAVA_KW.has(t) ? t : 'ID';
      return t;
    })
    .join(' ');
}
function shapeKey(q) {
  if (q.verify.kind === 'per-option') return 'T:' + shape(q.verify.template.join('\n')) + '|O:' + q.options.map((o) => shape(o.code)).sort().join('||');
  return 'P:' + q.files.map((f) => shape(f.code.join('\n'))).join('|');
}
function checkStructure(all) {
  const groups = new Map();
  for (const q of all) {
    if (!groups.has(q.pairId)) groups.set(q.pairId, {});
    groups.get(q.pairId)[q.side] = q;
  }
  const issues = [];
  const warnings = [];
  for (const [id, g] of groups) {
    if (g.a && g.b) {
      if (shapeKey(g.a) !== shapeKey(g.b)) issues.push(`${id}: 即時類題(b)のコード構造が表(a)と違う(数値・名前以外も変わっている)`);
      if (g.a.options.length !== g.b.options.length || g.a.selectCount !== g.b.selectCount) issues.push(`${id}: 即時類題(b)の選択肢の構成が表(a)と違う`);
      if (g.a.answer.join() === g.b.answer.join()) warnings.push(`${id}: 即時類題(b)の正解の記号が表(a)と同じ(${g.a.answer.join()})`);
    }
    if (g.a && g.c && shapeKey(g.a) === shapeKey(g.c)) issues.push(`${id}: 復習バリエーション(c)が表(a)と同じ構造で、観点がずれていない`);
  }
  return { groups: groups.size, issues, warnings };
}

// ── 本体 ──
const results = [];
let failed = 0;
const allQuestions = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).questions);
const structure = checkStructure(allQuestions);
for (const m of structure.issues) console.log('NG 構造 ' + m);
for (const m of structure.warnings) console.log('注意 ' + m);
failed += structure.issues.length;
for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const q of data.questions) {
    const res = verifyQuestion(q);
    results.push(res);
    if (!res.ok) failed++;
    const mark = res.ok ? 'OK ' : 'NG ';
    const detail = res.ok ? '' : `  正解=${res.answer} / 実際に当てはまる選択肢=${res.matched}`;
    console.log(`${mark}${q.id}${detail}`);
    if (write && res.ok && res.compileErrors?.length) {
      q.explanation.compileErrors = res.compileErrors.map((e) => ({ ...(e.option ? { option: e.option } : {}), file: e.file, line: e.line, message: e.message }));
    } else if (write && res.ok) {
      delete q.explanation.compileErrors;
    }
  }
  if (write) writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
const runFailed = results.filter((r) => !r.ok).length;
const summary = { jdk: versionLine, checkedAt: new Date().toISOString(), total: results.length, passed: results.length - runFailed, failed: runFailed, structure: { groups: structure.groups, issues: structure.issues, warnings: structure.warnings } };
console.log(`\n${summary.passed}/${summary.total} 問が一致(${versionLine})・構造チェック ${structure.groups}組で問題 ${structure.issues.length}件`);
if (reportPath) writeFileSync(reportPath, JSON.stringify({ summary, results }, null, 2) + '\n');
process.exit(failed ? 1 : 0);
