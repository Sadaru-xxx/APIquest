import bankJson from './data/bank.json';
import type { Bank, FieldId, Question, Topic } from './types';

export const bank = bankJson as unknown as Bank;

export const questionById = new Map(bank.questions.map((q) => [q.id, q]));
export const topicById = new Map(bank.topics.map((t) => [t.id, t]));
export const fieldById = new Map(bank.fields.map((f) => [f.id, f]));

export const topicsOf = (fieldId: FieldId): Topic[] => bank.topics.filter((t) => t.fieldId === fieldId);
export const questionsOf = (fieldId: FieldId): Question[] => bank.questions.filter((q) => q.fieldId === fieldId);
export const questionsOfTopic = (topicId: string): Question[] =>
  bank.questions.filter((q) => q.topicId === topicId).sort((a, b) => (a.side === b.side ? a.pairId.localeCompare(b.pairId) : a.side === 'a' ? -1 : 1));
export const hasQuestions = (fieldId: FieldId): boolean => bank.questions.some((q) => q.fieldId === fieldId);

export const groupOf = (qid: string) => qid.slice(0, -1);
export const sideOf = (qid: string) => qid.slice(-1) as Question['side'];
export const SIDE_LABEL: Record<Question['side'], string> = { a: '表', b: '即時類題', c: '復習バリエーション' };
/** 演習で使う問題(表と即時類題)。復習バリエーションは復習と模擬試験でだけ出す */
export const practiceQuestionsOfTopic = (topicId: string) => questionsOfTopic(topicId).filter((q) => q.side !== 'c');

/** コンパイル可否を選ぶ問題で、選択肢のコードを雛形に埋め込んだ全文 */
export function embedOption(q: Question, label: string): string[] {
  if (q.verify.kind !== 'per-option') return q.files[0]?.code ?? [];
  const code = q.options.find((o) => o.label === label)?.code ?? '';
  return q.verify.template.flatMap((line) => {
    const i = line.indexOf('{{OPTION}}');
    if (i < 0) return [line];
    const indent = line.slice(0, i);
    return code.split('\n').map((l) => indent + l);
  });
}

export const DIFF_LABEL: Record<number, string> = { 1: '易', 2: '中', 3: '難' };
export const FORMAT_LABEL: Record<string, string> = { result: '実行結果', compile: 'コンパイル可否', knowledge: '知識' };

export const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
