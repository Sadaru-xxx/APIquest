#!/usr/bin/env node
// 執筆用ソース(authoring/<分野ID>.src.mjs)から questions/*.json を生成し、構造をチェックする。
//   node authoring/build-questions.mjs [出力先ディレクトリ(既定: questions)]
// 生成した JSON には javac のエラーメッセージ(explanation.compileErrors)が入っていないので、
// 続けて tools/verify-questions.mjs --write を実行して書き戻す(npm run questions がまとめて行う)。
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? join(HERE, '..', 'questions'));

// 試験の6分野。prefix は問題 ID・トピック ID の接頭辞
const fields = [
  { id: 'basics', no: 1, prefix: 'bs', name: 'Javaの概要と簡単なJavaプログラムの作成' },
  { id: 'types', no: 2, prefix: 'ty', name: 'Javaの基本データ型と文字列の操作' },
  { id: 'operators', no: 3, prefix: 'oc', name: '演算子と制御構造' },
  { id: 'classes', no: 4, prefix: 'cl', name: 'クラスの定義とインスタンスの使用' },
  { id: 'inheritance', no: 5, prefix: 'ih', name: '継承とインターフェイスの使用' },
  { id: 'exceptions', no: 6, prefix: 'ex', name: '例外処理' },
];

const sources = readdirSync(HERE).filter((f) => f.endsWith('.src.mjs'));
const problems = [];
const outputs = [];
const allTopics = [];

for (const field of fields) {
  const file = `${field.id}.src.mjs`;
  if (!sources.includes(file)) continue;
  const { questions, topics } = await import(pathToFileURL(join(HERE, file)).href);
  const idRe = new RegExp(`^${field.prefix}-\\d{2}[abc]$`);
  const topicIds = new Set(topics.map((t) => t.id));
  const byPair = new Map();

  for (const t of topics) {
    if (t.fieldId !== field.id) problems.push(`${t.id}: トピックの fieldId が ${field.id} ではない`);
    if (!t.id.startsWith(field.prefix + '-')) problems.push(`${t.id}: トピック ID の接頭辞が ${field.prefix}- ではない`);
  }
  for (const q of questions) {
    const p = (m) => problems.push(`${q.id}: ${m}`);
    if (!idRe.test(q.id)) p(`id の形式が不正(${field.prefix}-NNa / b / c)`);
    if (q.fieldId !== field.id) p(`fieldId が ${field.id} ではない`);
    if (q.side === 'c' && !q.variationNote) p('復習バリエーションに「表との違い」(variationNote)がない');
    if (!topicIds.has(q.topicId)) p('未定義のトピック ' + q.topicId);
    if (q.options.length < 4 || q.options.length > 9) p('選択肢は4〜9個');
    if (q.selectCount !== q.answer.length) p('selectCount と answer の数が不一致');
    const labels = q.options.map((o) => o.label);
    for (const a of q.answer) if (!labels.includes(a)) p('answer に存在しない選択肢 ' + a);
    for (const l of labels) if (!q.explanation.options[l]) p('選択肢解説が欠けている ' + l);
    if (q.verify.kind === 'program') {
      if (!q.files.length) p('program 検証なのにコードがない');
      for (const o of q.options) if (!o.claim) p('claim がない選択肢 ' + o.label);
    }
    if (q.verify.kind === 'per-option') {
      for (const o of q.options) if (!o.code) p('code がない選択肢 ' + o.label);
      if (!q.verify.template.some((l) => l.includes('{{OPTION}}'))) p('template に {{OPTION}} がない');
    }
    if (!byPair.has(q.pairId)) byPair.set(q.pairId, []);
    byPair.get(q.pairId).push(q);
  }
  for (const [pid, qs] of byPair) {
    const a = qs.find((q) => q.side === 'a'), b = qs.find((q) => q.side === 'b'), c = qs.find((q) => q.side === 'c');
    if (qs.length !== 3 || !a || !b || !c) { problems.push(`${pid}: 表(a)・即時類題(b)・復習バリエーション(c)がそろっていない`); continue; }
    for (const k of ['topicId', 'difficulty', 'format', 'selectCount']) if (a[k] !== b[k]) problems.push(`${pid}: 表と即時類題で ${k} が違う`);
    for (const k of ['topicId', 'difficulty']) if (a[k] !== c[k]) problems.push(`${pid}: 表と復習バリエーションで ${k} が違う`);
    if (a.options.length !== b.options.length) problems.push(`${pid}: 表と即時類題で選択肢の数が違う`);
  }
  const diff = { 1: 0, 2: 0, 3: 0 };
  for (const q of questions.filter((q) => q.side === 'a')) diff[q.difficulty]++;

  allTopics.push(...topics);
  const sorted = [...questions].sort((x, y) => x.id.localeCompare(y.id));
  outputs.push({ file: `${field.id}.json`, body: { fieldId: field.id, questions: sorted } });
  console.log(`${field.id}: ${questions.length}問 / ${byPair.size}組 / 表の難易度 易${diff[1]}:中${diff[2]}:難${diff[3]}`);
}

for (const s of sources) if (!fields.some((f) => `${f.id}.src.mjs` === s)) problems.push(`${s}: 分野 ID と一致しないファイル名(${fields.map((f) => f.id).join(' / ')})`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
writeFileSync(join(OUT, 'topics.json'), JSON.stringify({ fields, topics: allTopics }, null, 2) + '\n');
for (const o of outputs) writeFileSync(join(OUT, o.file), JSON.stringify(o.body, null, 2) + '\n');
console.log(`OK: ${outputs.length}分野を ${OUT} に書き出しました`);
