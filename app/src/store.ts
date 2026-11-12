import { useSyncExternalStore } from 'react';
import type { FieldId, Mode, MockInProgress, MockRecord, Progress, TopicState } from './types';
import { groupOf, questionById, questionsOfTopic, topicsOf } from './data';

export const MASTER_STREAK = 3;
export const REVIEW_DAYS = [1, 3, 7] as const;
const MAX_ATTEMPTS = 1500;
const LS_KEY = 'java-silver-progress-v1';
const DAY = 86400000;

export const emptyProgress = (): Progress => ({ v: 2, updatedAt: 0, attempts: [], topics: {}, reviews: {}, mocks: [], mockInProgress: null });

/**
 * v1 → v2 の移行。v1 の裏(b)のうち oc-09・oc-12 以外は、v2 では復習バリエーション(c)になった。
 * 復習は問題 ID 単位から組単位に変わった。
 */
const STRICT_B_V1 = new Set(['oc-09', 'oc-12']);
export function migrate(raw: unknown): Progress {
  const p = { ...emptyProgress(), ...(raw as Partial<Progress>) } as Progress & { v: number };
  if (p.v === 2) return p;
  const remap = (id: string) => (/^oc-\d{2}b$/.test(id) && !STRICT_B_V1.has(id.slice(0, -1)) ? id.slice(0, -1) + 'c' : id);
  const reviews: Progress['reviews'] = {};
  for (const [qid, r] of Object.entries(p.reviews as Record<string, { stage: 0 | 1 | 2; due: number }>)) {
    const g = qid.slice(0, -1);
    const cur = reviews[g];
    if (!cur || r.due < cur.due) reviews[g] = { stage: r.stage, due: r.due, served: [] };
  }
  return {
    ...p,
    v: 2,
    attempts: p.attempts.map(([id, t, ok, m]) => [remap(id), t, ok, m]),
    reviews,
    mocks: p.mocks.map((m) => ({ ...m, items: m.items.map((it) => ({ ...it, id: remap(it.id) })) })),
    mockInProgress: null,
  };
}

export const startOfDay = (t = Date.now()) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const daysFromToday = (n: number) => startOfDay() + n * DAY + 3600000; // 日付の境目をまたぐ誤差を避ける

// ───────── 学習ルール ─────────
export function applyAnswer(p: Progress, qid: string, ok: boolean, mode: Mode, reviewGroup?: string, now = Date.now()): { next: Progress; mastered?: string; lostMastery?: string } {
  const q = questionById.get(qid);
  if (!q) return { next: p };
  const attempts = [...p.attempts, [qid, now, ok ? 1 : 0, mode] as [string, number, 0 | 1, Mode]].slice(-MAX_ATTEMPTS);
  const prev: TopicState = p.topics[q.topicId] ?? { streak: 0, mastered: false, n: 0, ok: 0 };
  // 模擬試験の解答は習熟度を動かさない(間違えた問題は復習にだけ入れる)
  const keepTopic = mode === 'm';
  const t: TopicState = { ...prev, n: prev.n + 1, ok: prev.ok + (ok ? 1 : 0) };
  let mastered: string | undefined;
  let lostMastery: string | undefined;
  if (ok) {
    t.streak = prev.streak + 1;
    if (!prev.mastered && t.streak >= MASTER_STREAK) {
      t.mastered = true;
      t.masteredAt = now;
      mastered = q.topicId;
    }
  } else {
    t.streak = 0;
    if (prev.mastered) {
      t.mastered = false;
      lostMastery = q.topicId;
    }
  }
  // 復習は組単位。復習モードでは出題元の組を進めるか戻し、それ以外のモードでは間違えた問題の組を登録する
  const reviews = { ...p.reviews };
  if (mode === 'r' && reviewGroup && reviews[reviewGroup]) {
    const r = reviews[reviewGroup];
    const served = [...r.served, qid];
    if (!ok) reviews[reviewGroup] = { stage: 0, due: daysFromToday(REVIEW_DAYS[0]), served };
    else if (r.stage >= 2) delete reviews[reviewGroup];
    else {
      const stage = (r.stage + 1) as 1 | 2;
      reviews[reviewGroup] = { stage, due: daysFromToday(REVIEW_DAYS[stage]), served };
    }
  } else if (!ok) {
    const g = groupOf(qid);
    reviews[g] = { stage: 0, due: daysFromToday(REVIEW_DAYS[0]), served: reviews[g]?.served ?? [] };
  }
  if (keepTopic) return { next: { ...p, attempts, reviews } };
  return { next: { ...p, attempts, topics: { ...p.topics, [q.topicId]: t }, reviews }, mastered, lostMastery };
}

export type TopicStatus = 'untouched' | 'learning' | 'mastered';
export const topicStatus = (p: Progress, topicId: string): TopicStatus => {
  const t = p.topics[topicId];
  if (!t || t.n === 0) return 'untouched';
  return t.mastered ? 'mastered' : 'learning';
};
export function fieldSummary(p: Progress, fieldId: FieldId) {
  const ts = topicsOf(fieldId);
  const statuses = ts.map((t) => topicStatus(p, t.id));
  const mastered = statuses.filter((s) => s === 'mastered').length;
  const touched = statuses.some((s) => s !== 'untouched');
  return { total: ts.length, mastered, touched, cleared: ts.length > 0 && mastered === ts.length };
}
/** 期日が来た復習の組 ID */
export const dueReviews = (p: Progress, now = Date.now()) =>
  Object.entries(p.reviews)
    .filter(([g, r]) => r.due <= now && questionById.has(g + 'a'))
    .sort((a, b) => a[1].due - b[1].due)
    .map(([g]) => g);

/**
 * 類題ポリシーに従って、復習で出す問題を選ぶ。
 * 1回目(1日後)はその組の復習バリエーション、2・3回目は同じトピックの別の組のバリエーション(なければ別の組の表)。
 * その組の復習でまだ出していない問題を優先する。
 */
export function reviewQuestionFor(p: Progress, group: string): string {
  const r = p.reviews[group];
  const own = group + 'c';
  const served = new Set(r?.served ?? []);
  const topic = questionById.get(group + 'a')?.topicId;
  const others = topic ? questionsOfTopic(topic).filter((q) => q.pairId !== group) : [];
  const fresh = (ids: string[]) => ids.find((id) => questionById.has(id) && !served.has(id));
  if (!r || r.stage === 0) return questionById.has(own) ? own : group + 'a';
  return (
    fresh(others.filter((q) => q.side === 'c').map((q) => q.id)) ??
    fresh(others.filter((q) => q.side === 'a').map((q) => q.id)) ??
    fresh([own]) ??
    (questionById.has(own) ? own : group + 'a')
  );
}

/** 問題ごとの最新の解答結果 */
export function lastResults(p: Progress): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const [id, , ok] of p.attempts) m.set(id, ok === 1);
  return m;
}

// ───────── 保存(claude.ai の DB があればそこへ、なければこのブラウザへ) ─────────
export type SaveStatus = 'loading' | 'cloud' | 'local' | 'error';

type DocRef = { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(d: Record<string, unknown>): Promise<void> };
type ClaudeHost = { use(name: string): Promise<unknown> };

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

class ProgressStore {
  private state: Progress = emptyProgress();
  private listeners = new Set<() => void>();
  status: SaveStatus = 'loading';
  private ref: DocRef | null = null;
  private writing = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.state = migrate(JSON.parse(raw));
    } catch {
      /* localStorage が使えない環境では空の状態から始める */
    }
    this.initCloud();
  }

  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.listeners.forEach((l) => l());
  }

  update(fn: (p: Progress) => Progress) {
    this.state = { ...fn(this.state), updatedAt: Date.now() };
    this.saveLocal();
    this.scheduleRemote();
    this.emit();
  }

  replaceAll(p: Progress) {
    this.update(() => migrate(p));
  }

  private saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    } catch {
      /* 保存できなくても学習は続けられる */
    }
  }

  private setStatus(s: SaveStatus) {
    this.status = s;
    this.emit();
  }

  private async initCloud() {
    // ホスト(claude.ai)の claude オブジェクトはスクリプト開始後に用意されることがあるので、少し待つ
    let host: ClaudeHost | undefined;
    for (let i = 0; i < 30 && !host?.use; i++) {
      host = (window as unknown as { claude?: ClaudeHost }).claude;
      if (!host?.use) await new Promise((r) => setTimeout(r, 100));
    }
    if (!host?.use) return this.setStatus('local');
    try {
      const [db, user] = await Promise.all([withTimeout(host.use('db'), 10000), withTimeout(host.use('user'), 10000)]);
      if (!db || !user) return this.setStatus('local');
      const id = await (user as { id(): Promise<string | null> }).id();
      if (!id) return this.setStatus('local');
      this.ref = (db as { doc(p: string): DocRef }).doc(`data/users/${id}/progress`);
      const snap = await withTimeout(this.ref.get(), 10000);
      if (!snap) return this.setStatus('local');
      const body = snap.exists ? snap.data() : undefined;
      const remote: Progress | null = body && typeof body.json === 'string' ? migrate(JSON.parse(body.json)) : null;
      if (remote && remote.updatedAt > this.state.updatedAt) {
        this.state = remote;
        this.saveLocal();
      } else if (this.state.updatedAt > (remote?.updatedAt ?? 0)) {
        this.dirty = true;
        await this.flush();
      }
      this.setStatus(this.status === 'error' ? 'error' : 'cloud');
    } catch {
      this.ref = null;
      this.setStatus('local');
    }
  }

  private scheduleRemote() {
    if (!this.ref) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1200);
  }

  private async flush(retry = true): Promise<void> {
    if (!this.ref || this.writing || !this.dirty) return;
    this.writing = true;
    this.dirty = false;
    try {
      await this.ref.set({ v: 2, updatedAt: this.state.updatedAt, json: JSON.stringify(this.state) });
      if (this.status === 'error') this.setStatus('cloud');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'unavailable' && retry) {
        this.dirty = true;
        this.writing = false;
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
        return this.flush(false);
      }
      if (code === 'invalid_argument' || code === 'revoked' || code === 'not_granted') {
        this.ref = null;
        this.setStatus('local');
      } else this.setStatus('error');
    } finally {
      this.writing = false;
    }
    if (this.dirty) await this.flush();
  }
}

export const store = new ProgressStore();

export function useProgress(): Progress {
  return useSyncExternalStore(store.subscribe, store.get);
}
export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(store.subscribe, () => store.status);
}

export function recordAnswer(qid: string, ok: boolean, mode: Mode, reviewGroup?: string) {
  let result: ReturnType<typeof applyAnswer> = { next: store.get() };
  store.update((p) => {
    result = applyAnswer(p, qid, ok, mode, reviewGroup);
    return result.next;
  });
  return result;
}

export const setLastField = (f: FieldId) => store.update((p) => ({ ...p, lastField: f }));
export const setMockInProgress = (m: MockInProgress | null) => store.update((p) => ({ ...p, mockInProgress: m }));
export const pushMock = (r: MockRecord) => store.update((p) => ({ ...p, mocks: [...p.mocks, r].slice(-20), mockInProgress: null }));
