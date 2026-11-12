#!/usr/bin/env node
// 問題データと検証レポートから、レビュー用の1枚HTMLを生成する。リポジトリのルートで実行する。
//   node tools/render-review.mjs [分野ID ...]   (省略すると questions/ の全分野)
// 出力: reports/review/<分野ID>-review.html
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

const fieldArgs = process.argv.slice(2);
const fieldIds = fieldArgs.length ? fieldArgs : readdirSync('questions').filter((f) => f.endsWith('.json') && f !== 'topics.json').map((f) => f.replace(/\.json$/, ''));
const { fields, topics } = JSON.parse(readFileSync('questions/topics.json', 'utf8'));
const report = JSON.parse(readFileSync('reports/verification-report.json', 'utf8'));
for (const fieldId of fieldIds) renderField(fieldId);

function renderField(fieldId) {
const qFile = `questions/${fieldId}.json`;
const outFile = `reports/review/${fieldId}-review.html`;
const data = JSON.parse(readFileSync(qFile, 'utf8'));
const resById = Object.fromEntries(report.results.map((r) => [r.id, r]));
const field = fields.find((f) => f.id === data.fieldId);
const fieldTopics = topics.filter((t) => t.fieldId === data.fieldId);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ── 簡易 Java ハイライト ──
const KW = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var yield record sealed permits non-sealed true false null'.split(' '));
function highlight(line) {
  const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b\d[\d_]*(?:\.\d+)?[LlFfDd]?\b)|([A-Za-z_$][\w$]*)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index));
    const [t] = m;
    if (m[1]) out += `<span class="t-com">${esc(t)}</span>`;
    else if (m[2] || m[3]) out += `<span class="t-str">${esc(t)}</span>`;
    else if (m[4]) out += `<span class="t-num">${esc(t)}</span>`;
    else if (KW.has(t)) out += `<span class="t-kw">${esc(t)}</span>`;
    else if (/^[A-Z]/.test(t)) out += `<span class="t-type">${esc(t)}</span>`;
    else out += esc(t);
    last = m.index + t.length;
  }
  return out + esc(line.slice(last));
}
const codeBlock = (lines, { numbered = true, errLines = [] } = {}) =>
  `<pre class="code${numbered ? ' numbered' : ''}"><code>${lines
    .map((l, i) => `<span class="row${errLines.includes(i + 1) ? ' err' : ''}">${numbered ? `<span class="ln">${i + 1}</span>` : ''}<span class="src">${highlight(l) || ' '}</span></span>`)
    .join('')}</code></pre>`;

const DIFF = { 1: '易', 2: '中', 3: '難' };
const FORMAT = { result: '実行結果を選ぶ', compile: 'コンパイル可否を選ぶ', knowledge: '知識' };

function actualSummary(q, r) {
  if (!r) return '';
  if (r.actual) {
    const a = r.actual;
    if (a.result === '正常終了') return `正常終了。出力: <code>${esc(a.stdout).replace(/\n/g, ' ⏎ ')}</code>`;
    if (a.result === '例外') return `${esc(a.exception)} がスローされた。それまでの出力: <code>${esc(a.stdout).replace(/\n/g, ' ⏎ ')}</code>`;
    if (a.result === 'コンパイルエラー') return `コンパイルエラー(${[...new Set(a.errors.map((e) => e.line))].join('行目・')}行目)`;
    if (a.result === 'タイムアウト') return 'タイムアウト(無限ループ)';
  }
  if (r.perOption) {
    const err = Object.entries(r.perOption).filter(([, v]) => v.result === 'コンパイルエラー').map(([k]) => k);
    return `選択肢ごとにコンパイルした結果、エラーになったのは ${err.join('・') || 'なし'}`;
  }
  return '';
}

function card(q) {
  const r = resById[q.id];
  const multi = q.selectCount > 1;
  const errs = q.explanation.compileErrors ?? [];
  const progErrLines = q.verify.kind === 'program' ? errs.map((e) => e.line) : [];
  const opts = q.options
    .map((o) => {
      const correct = q.answer.includes(o.label);
      const po = r?.perOption?.[o.label];
      const tag = po ? `<span class="actual ${po.result === 'コンパイルエラー' ? 'is-err' : 'is-ok'}">${po.result}</span>` : '';
      const body = o.code ? codeBlock(o.code.split('\n'), { numbered: false }) : `<span class="txt">${esc(o.text)}</span>`;
      return `<li class="opt${correct ? ' correct' : ''}" data-label="${o.label}">
        <label><input type="${multi ? 'checkbox' : 'radio'}" name="${q.id}" value="${o.label}" id="${q.id}-${o.label}"><span class="lbl">${o.label}</span><span class="body">${body}</span></label>
        <span class="marks"><span class="verdict">正解</span>${tag}</span></li>`;
    })
    .join('');
  const why = q.options.map((o) => `<dt>${o.label}</dt><dd>${esc(q.explanation.options[o.label])}</dd>`).join('');
  const javac = errs.length
    ? `<div class="javac"><h4>javac(JDK 17)が出したエラー</h4><ul>${errs
        .map((e) => `<li>${e.option ? `選択肢 ${e.option}: ` : ''}${q.verify.kind === 'program' ? `${e.line}行目: ` : ''}<code>${esc(e.message)}</code></li>`)
        .join('')}</ul></div>`
    : '';
  const refs = q.refs.map((x) => `<li><a href="${esc(x.url)}">${esc(x.title)}</a></li>`).join('');
  return `<article class="q" id="${q.id}" data-answer="${q.answer.join(',')}">
    <header class="q-head">
      <span class="qid">${q.id}</span>
      <span class="chip side">${{ a: '表', b: '即時類題', c: '復習バリエーション' }[q.side]}</span>
      <span class="chip diff d${q.difficulty}" title="難易度">${DIFF[q.difficulty]}</span>
      <span class="chip">${FORMAT[q.format]}</span>
      <span class="chip">${q.selectCount}つ選択</span>
    </header>
    ${q.variationNote ? `<p class="vnote"><strong>表との違い</strong>${esc(q.variationNote)}</p>` : ''}
    <p class="prompt">${esc(q.prompt)}</p>
    ${q.files.map((f) => `${q.files.length > 1 ? `<p class="fname">${esc(f.path)}</p>` : ''}${codeBlock(f.code, { errLines: progErrLines })}`).join('')}
    ${q.command ? `<p class="cmd">実行コマンド: <code>${esc(q.command)}</code></p>` : ''}
    <ol class="opts">${opts}</ol>
    <div class="solve"><button type="button" class="check">解答する</button><span class="result" aria-live="polite"></span></div>
    <div class="expl">
      <p class="point"><strong>要点</strong>${esc(q.explanation.point)}</p>
      <p class="detail">${esc(q.explanation.detail)}</p>
      <dl class="why">${why}</dl>
      ${javac}
      <div class="foot">
        <p class="verified ${r?.ok ? 'ok' : 'ng'}">${r?.ok ? 'JDK 17 で検証済み' : '検証 NG'}: ${actualSummary(q, r)}</p>
        <ul class="refs">${refs}</ul>
        <p class="tags">${q.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</p>
      </div>
    </div>
  </article>`;
}

const qs = data.questions;
const diffA = [1, 2, 3].map((d) => qs.filter((q) => q.side === 'a' && q.difficulty === d).length);
const nCompile = qs.filter((q) => q.format === 'compile').length;
const nMulti = qs.filter((q) => q.selectCount > 1).length;
const sections = fieldTopics
  .map((t) => {
    const tq = qs.filter((q) => q.topicId === t.id);
    const pairs = [...new Set(tq.map((q) => q.pairId))];
    return `<section class="topic" id="${t.id}">
      <div class="topic-head"><h2>${esc(t.name)}</h2><span class="count">${pairs.length}組・${tq.length}問</span></div>
      <details class="keypoints"><summary>このトピックの要点</summary><ul>${t.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ul></details>
      ${pairs.map((p) => `<div class="pair" aria-label="組 ${p}">${tq.filter((q) => q.pairId === p).sort((x, y) => x.side.localeCompare(y.side)).map(card).join('')}</div>`).join('')}
    </section>`;
  })
  .join('');
const nav = fieldTopics.map((t) => `<a href="#${t.id}">${esc(t.name)}<span>${qs.filter((q) => q.topicId === t.id).length}</span></a>`).join('');
const checked = new Date(report.summary.checkedAt);
const checkedJst = new Date(checked.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>演算子と制御構造 問題レビュー</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root {
  /* 方針: 試験問題集の紙面。表と裏(類題)を左右に並べ、正解・解説・検証結果を同じカードに収める */
  --bg: #eef1f4;
  --surface: #ffffff;
  --ink: #17202b;
  --muted: #586473;
  --line: #d9dfe6;
  --accent: #0b6b66;
  --accent-soft: #e2f0ee;
  --good: #1a7f37;
  --good-soft: #e5f4e9;
  --bad: #c4314b;
  --bad-soft: #fbe9ec;
  --code-bg: #f6f8fa;
  --t-kw: #7b3fe4;
  --t-str: #9a5800;
  --t-num: #0a5cc0;
  --t-type: #0b6b66;
  --font-body: "IBM Plex Sans JP", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  --font-code: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f141a; --surface: #161d25; --ink: #e5eaf0; --muted: #98a4b1; --line: #29333e;
    --accent: #4dbdb3; --accent-soft: #15302e; --good: #50c46f; --good-soft: #15291c; --bad: #ff6f86; --bad-soft: #36161d;
    --code-bg: #10161d; --t-kw: #c29dff; --t-str: #f0b25c; --t-num: #7ab7ff; --t-type: #63d3c8; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0f141a; --surface: #161d25; --ink: #e5eaf0; --muted: #98a4b1; --line: #29333e;
  --accent: #4dbdb3; --accent-soft: #15302e; --good: #50c46f; --good-soft: #15291c; --bad: #ff6f86; --bad-soft: #36161d;
  --code-bg: #10161d; --t-kw: #c29dff; --t-str: #f0b25c; --t-num: #7ab7ff; --t-type: #63d3c8; color-scheme: dark;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 76px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.7 var(--font-body); }
a { color: var(--accent); }
code, pre { font-family: var(--font-code); }
.wrap { max-width: 1640px; margin: 0 auto; padding: 0 20px; }
.top { padding: 28px 0 8px; display: grid; gap: 14px; }
.top h1 { margin: 0; font-size: 26px; line-height: 1.35; text-wrap: balance; }
.top .sub { margin: 0; color: var(--muted); max-width: 70ch; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.stats li { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; font-size: 13px; font-variant-numeric: tabular-nums; }
.stats li b { font-size: 16px; margin-right: 4px; }
.stats li.ok { border-color: var(--good); background: var(--good-soft); }
.bar { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.bar .wrap { display: flex; gap: 12px; align-items: center; padding-top: 10px; padding-bottom: 10px; }
.mode { flex: none; display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); }
.mode button { font: inherit; font-size: 13px; border: 0; background: transparent; color: var(--ink); padding: 6px 12px; cursor: pointer; }
.mode button[aria-pressed="true"] { background: var(--accent); color: #fff; }
nav.topics { display: flex; gap: 6px; font-size: 13px; overflow-x: auto; min-width: 0; padding-bottom: 2px; scrollbar-width: thin; }
nav.topics a { flex: none; white-space: nowrap; text-decoration: none; color: var(--ink); border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 3px 10px; }
nav.topics a span { color: var(--muted); margin-left: 6px; font-variant-numeric: tabular-nums; }
nav.topics a:hover { border-color: var(--accent); }
.topic { padding: 28px 0 8px; }
.topic-head { display: flex; align-items: baseline; gap: 12px; }
.topic-head h2 { margin: 0; font-size: 20px; }
.topic-head .count { color: var(--muted); font-size: 13px; }
.keypoints { margin: 8px 0 16px; font-size: 14px; color: var(--muted); }
.keypoints summary { cursor: pointer; color: var(--accent); }
.keypoints ul { margin: 6px 0 0; padding-left: 20px; }
.pair { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 16px; margin-bottom: 26px; align-items: start; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.vnote { margin: 0; font-size: 13.5px; background: var(--accent-soft); border-radius: 6px; padding: 4px 10px; }
.vnote strong { color: var(--accent); margin-right: 8px; font-size: 12px; }
.q { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: grid; gap: 10px; min-width: 0; }
.q-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.qid { font-family: var(--font-code); font-weight: 600; margin-right: 4px; }
.chip { font-size: 12px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
.chip.side { color: var(--accent); border-color: var(--accent); }
.chip.diff.d1 { color: var(--good); border-color: var(--good); }
.chip.diff.d2 { color: var(--t-num); border-color: var(--t-num); }
.chip.diff.d3 { color: var(--bad); border-color: var(--bad); }
.prompt { margin: 0; font-weight: 500; }
.fname, .cmd { margin: 0; font-size: 13px; color: var(--muted); }
pre.code { margin: 0; background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 0; overflow-x: auto; font-size: 13px; line-height: 1.6; }
pre.code code { display: grid; min-width: max-content; }
pre.code .row { display: flex; padding: 0 14px 0 0; }
pre.code .row.err { background: var(--bad-soft); }
pre.code .ln { width: 3.2em; flex: none; text-align: right; padding-right: 12px; color: var(--muted); user-select: none; font-variant-numeric: tabular-nums; }
pre.code:not(.numbered) .row { padding-left: 12px; }
pre.code .src { white-space: pre; }
.t-kw { color: var(--t-kw); font-weight: 600; }
.t-str { color: var(--t-str); }
.t-num { color: var(--t-num); }
.t-type { color: var(--t-type); }
.t-com { color: var(--muted); font-style: italic; }
.opts { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.opt { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
.opt label { display: flex; gap: 10px; align-items: flex-start; flex: 1; min-width: 0; cursor: default; }
.opt .lbl { font-family: var(--font-code); font-weight: 600; min-width: 1.2em; padding-top: 1px; }
.opt .body { min-width: 0; flex: 1; }
.opt .body pre.code { padding: 4px 0; font-size: 12.5px; }
.opt input { display: none; margin-top: 6px; }
.marks { display: flex; gap: 6px; flex: none; align-items: center; padding-top: 2px; }
.verdict { display: none; font-size: 12px; font-weight: 700; color: #fff; background: var(--good); border-radius: 4px; padding: 0 6px; }
.actual { font-size: 11.5px; border-radius: 4px; padding: 0 6px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.actual.is-err { color: var(--bad); border-color: var(--bad); }
.solve { display: none; gap: 12px; align-items: center; }
.solve button { font: inherit; font-size: 14px; background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 6px 16px; cursor: pointer; }
.solve button:disabled { opacity: .5; cursor: default; }
.solve .result { font-weight: 700; }
.solve .result.good { color: var(--good); }
.solve .result.bad { color: var(--bad); }
.expl { border-top: 1px dashed var(--line); padding-top: 10px; display: grid; gap: 8px; font-size: 14px; }
.expl p { margin: 0; }
.point strong { display: inline-block; background: var(--accent-soft); color: var(--accent); border-radius: 4px; padding: 0 6px; margin-right: 8px; font-size: 12px; }
.detail { color: var(--ink); }
.why { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
.why dt { font-family: var(--font-code); font-weight: 600; }
.why dd { margin: 0; color: var(--muted); }
.javac h4 { margin: 0 0 2px; font-size: 13px; }
.javac ul { margin: 0; padding-left: 18px; }
.javac code { font-size: 12.5px; color: var(--bad); }
.foot { display: grid; gap: 4px; font-size: 12.5px; color: var(--muted); }
.verified.ok::before { content: "✓ "; color: var(--good); font-weight: 700; }
.verified code { color: var(--ink); }
.refs { margin: 0; padding-left: 18px; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; }
/* レビューモード: 正解と解説をすべて表示 */
body.review .opt.correct { border-color: var(--good); background: var(--good-soft); }
body.review .opt.correct .verdict { display: inline-block; }
/* 演習モード: 解答するまで正解と解説を隠す */
body.practice .opt input { display: inline-block; }
body.practice .opt label { cursor: pointer; }
body.practice .actual { display: none; }
body.practice .solve { display: flex; }
body.practice .q:not(.answered) .expl { display: none; }
body.practice .q:not(.answered) pre.code .row.err { background: none; }
body.practice .q.answered .opt.correct { border-color: var(--good); background: var(--good-soft); }
body.practice .q.answered .opt.correct .verdict { display: inline-block; }
body.practice .q.answered .opt.picked:not(.correct) { border-color: var(--bad); background: var(--bad-soft); }
body.practice .q.answered .actual { display: inline-block; }
button:focus-visible, a:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
footer { padding: 32px 0 48px; color: var(--muted); font-size: 13px; }
@media (max-width: 420px) { .wrap { padding: 0 14px; } .q { padding: 14px; } .top h1 { font-size: 22px; } }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>
</head>
<body class="review">
<div class="wrap top">
  <h1>Java Silver SE 17「${esc(field.name)}」問題レビュー</h1>
  <p class="sub">分野${field.no}の25組です。1組は「表」「即時類題(数値と名前だけを変えたもの。演習で間違えた直後に出す)」「復習バリエーション(観点をずらしたもの。1日後・3日後・7日後の復習で出す)」の3問。すべてのコードを JDK 17 で実際にコンパイル・実行し、正解の選択肢だけが実行結果と一致すること、即時類題が表と同じ構造であることを確かめています。</p>
  <ul class="stats">
    <li><b>${qs.length}</b>問</li>
    <li><b>${fieldTopics.length}</b>トピック</li>
    <li>表の難易度 易<b>${diffA[0]}</b>中<b>${diffA[1]}</b>難<b>${diffA[2]}</b></li>
    <li>構造チェック <b>${report.summary.structure?.groups ?? 0}</b>組で問題 <b>${report.summary.structure?.issues.length ?? 0}</b>件</li>
    <li>コンパイル可否を選ぶ問題 <b>${nCompile}</b></li>
    <li>複数選択 <b>${nMulti}</b></li>
    <li class="ok">検証 <b>${report.summary.passed}/${report.summary.total}</b> 一致(${esc(report.summary.jdk.replace('openjdk version ', 'OpenJDK ').replace(/"/g, ''))}、${checkedJst} JST)</li>
  </ul>
</div>
<div class="bar">
  <div class="wrap">
    <div class="mode" role="group" aria-label="表示モード">
      <button type="button" id="mode-review" aria-pressed="true">正解と解説を表示</button>
      <button type="button" id="mode-practice" aria-pressed="false">自分で解く</button>
    </div>
    <nav class="topics" aria-label="トピック">${nav}</nav>
  </div>
</div>
<main class="wrap">${sections}</main>
<footer class="wrap">ID の末尾 a が表、b が即時類題、c が復習バリエーションです。気になる問題は ID を添えてフィードバックしてください。</footer>
<script>
(function () {
  var body = document.body;
  var btnR = document.getElementById('mode-review');
  var btnP = document.getElementById('mode-practice');
  function setMode(m) {
    body.classList.toggle('review', m === 'review');
    body.classList.toggle('practice', m === 'practice');
    btnR.setAttribute('aria-pressed', String(m === 'review'));
    btnP.setAttribute('aria-pressed', String(m === 'practice'));
  }
  btnR.addEventListener('click', function () { setMode('review'); });
  btnP.addEventListener('click', function () { setMode('practice'); });
  document.querySelectorAll('.q').forEach(function (card) {
    var answer = card.dataset.answer.split(',');
    var btn = card.querySelector('.check');
    var out = card.querySelector('.result');
    var need = answer.length;
    btn.addEventListener('click', function () {
      var picked = Array.prototype.map.call(card.querySelectorAll('input:checked'), function (i) { return i.value; });
      if (picked.length !== need) { out.textContent = need + 'つ選んでください'; out.className = 'result'; return; }
      card.querySelectorAll('.opt').forEach(function (li) { li.classList.toggle('picked', picked.indexOf(li.dataset.label) >= 0); });
      var ok = picked.slice().sort().join() === answer.slice().sort().join();
      out.textContent = ok ? '正解' : '不正解(正解は ' + answer.join('・') + ')';
      out.className = 'result ' + (ok ? 'good' : 'bad');
      card.classList.add('answered');
      btn.disabled = true;
      card.querySelectorAll('input').forEach(function (i) { i.disabled = true; });
    });
  });
})();
</script>
</body>
</html>
`;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
}
