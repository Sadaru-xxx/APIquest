// 問題データ・トピック・JDK 17 の検証レポートを、アプリが読み込む1つの JSON(src/data/bank.json)にまとめる。
// npm run dev / npm run build の前に自動で実行される。引数でリポジトリのルートを変えられる。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? join(APP, '..');
const read = (p) => JSON.parse(readFileSync(join(SRC, p), 'utf8'));
const { fields, topics } = read('questions/topics.json');
const questions = readdirSync(join(SRC, 'questions'))
  .filter((f) => f.endsWith('.json') && f !== 'topics.json')
  .flatMap((f) => read(join('questions', f)).questions);
const report = read('reports/verification-report.json');

const runs = {};
for (const r of report.results) {
  if (!r.ok) throw new Error(`${r.id} は検証 NG のため収録できません`);
  if (r.console) runs[r.id] = { kind: 'program', run: r.console };
  else if (r.perOption) {
    runs[r.id] = {
      kind: 'per-option',
      options: Object.fromEntries(Object.entries(r.perOption).map(([k, v]) => [k, v.result === 'コンパイルエラー' ? { compile: 'error', javac: v.javac } : { compile: 'ok', compileOnly: true }])),
    };
  }
}
for (const q of questions) if (!runs[q.id] && q.verify.kind !== 'none') throw new Error(`${q.id} の検証結果がありません`);

const bank = { verifiedWith: report.summary.jdk.replace(/^openjdk version "([^"]+)".*/, 'OpenJDK $1'), checkedAt: report.summary.checkedAt, fields, topics, questions, runs };
mkdirSync(join(APP, 'src/data'), { recursive: true });
writeFileSync(join(APP, 'src/data/bank.json'), JSON.stringify(bank));
console.log(`bank.json: ${questions.length}問 / ${topics.length}トピック / ${bank.verifiedWith}`);
