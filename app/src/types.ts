export type FieldId = 'basics' | 'types' | 'operators' | 'classes' | 'inheritance' | 'exceptions';

export interface Field {
  id: FieldId;
  no: number;
  prefix: string;
  name: string;
}

export interface Topic {
  id: string;
  fieldId: FieldId;
  name: string;
  keyPoints: string[];
}

export interface Option {
  label: string;
  text?: string;
  code?: string;
}

export interface CompileError {
  option?: string;
  file: string;
  line: number;
  message: string;
}

export type Verify =
  | { kind: 'program' }
  | { kind: 'per-option'; template: string[]; polarity: 'error' | 'ok' }
  | { kind: 'none'; reason: string };

export interface Question {
  id: string;
  pairId: string;
  /** a = 表、b = 即時類題(数値と名前だけ変更)、c = 復習バリエーション(観点をずらしたもの) */
  side: 'a' | 'b' | 'c';
  variationNote?: string;
  fieldId: FieldId;
  topicId: string;
  tags: string[];
  difficulty: 1 | 2 | 3;
  format: 'result' | 'compile' | 'knowledge';
  prompt: string;
  files: { path: string; code: string[] }[];
  command?: string;
  selectCount: number;
  options: Option[];
  answer: string[];
  explanation: {
    point: string;
    detail: string;
    options: Record<string, string>;
    compileErrors?: CompileError[];
  };
  refs: { title: string; url: string }[];
  verify: Verify;
}

export type RunResult =
  | { compile: 'ok'; stdout?: string; stderr?: string; timeout?: boolean; compileOnly?: boolean }
  | { compile: 'error'; javac: string };

export type QuestionRun =
  | { kind: 'program'; run: RunResult }
  | { kind: 'per-option'; options: Record<string, RunResult> };

export interface Bank {
  verifiedWith: string;
  checkedAt: string;
  fields: Field[];
  topics: Topic[];
  questions: Question[];
  runs: Record<string, QuestionRun>;
}

export type Mode = 'p' | 'r' | 'm';

export interface TopicState {
  streak: number;
  mastered: boolean;
  n: number;
  ok: number;
  masteredAt?: number;
}

/** 復習は問題ではなく組(ペア ID)単位。served はその組の復習で出した問題 */
export interface ReviewItem {
  stage: 0 | 1 | 2;
  due: number;
  served: string[];
}

export interface MockRecord {
  at: number;
  total: number;
  correct: number;
  sec: number;
  limitSec: number;
  items: { id: string; ok: boolean; picked: string[] }[];
}

export interface MockInProgress {
  startedAt: number;
  limitSec: number;
  qids: string[];
  answers: Record<string, string[]>;
  flags: string[];
  current: number;
}

export interface Progress {
  v: 2;
  updatedAt: number;
  attempts: [string, number, 0 | 1, Mode][];
  topics: Record<string, TopicState>;
  reviews: Record<string, ReviewItem>;
  mocks: MockRecord[];
  mockInProgress: MockInProgress | null;
  lastField?: FieldId;
}
