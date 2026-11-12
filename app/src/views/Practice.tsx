import { useMemo, useState } from 'react';
import type { FieldId, Question } from '../types';
import { fieldById, groupOf, practiceQuestionsOfTopic, questionById, questionsOfTopic, topicById, topicsOf } from '../data';
import { MASTER_STREAK, store, topicStatus, useProgress } from '../store';
import QuestionPlayer from '../components/QuestionPlayer';
import { StreakDots, StatusChip } from '../components/Bits';

type Props = { fieldId: FieldId; topicIds?: string[]; onExit: () => void; onOpenField: (f: FieldId) => void };
type Log = { id: string; ok: boolean; similar: boolean };

/**
 * 分野の演習セッション。未習得のトピックから順に、表 → 裏の順で出題する。
 * トピックを習得するか、そのトピックの未出題の問題がなくなったら次のトピックへ進む。
 * 不正解のときは同じペアの類題(なければ同じトピックの未出題の問題)をその場で出せる。
 */
export default function Practice({ fieldId, topicIds, onExit, onOpenField }: Props) {
  const progress = useProgress();
  const field = fieldById.get(fieldId)!;
  const [plan] = useState(() => {
    const p = store.get();
    const all = (topicIds ?? topicsOf(fieldId).map((t) => t.id)).filter((id) => questionsOfTopic(id).length > 0);
    const open = all.filter((id) => topicStatus(p, id) !== 'mastered');
    return { topics: open.length ? open : all, reviewAll: open.length === 0 };
  });
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [log, setLog] = useState<Log[]>([]);
  const [current, setCurrent] = useState<{ id: string; similar: boolean } | null>(() => {
    const id = pickNext(plan.topics, new Set(), plan.reviewAll);
    return id ? { id, similar: false } : null;
  });
  const [answered, setAnswered] = useState(false);

  const q = current ? questionById.get(current.id) : undefined;
  const topicIndex = q ? plan.topics.indexOf(q.topicId) : plan.topics.length;

  function pickNext(topics: string[], seenSet: Set<string>, reviewAll: boolean): string | null {
    const p = store.get();
    for (const t of topics) {
      const qs = practiceQuestionsOfTopic(t).filter((x) => !seenSet.has(x.id) && (!reviewAll || x.side === 'a'));
      const mastered = topicStatus(p, t) === 'mastered';
      if (qs.length === 0 || (mastered && !reviewAll)) continue;
      return qs[0].id;
    }
    return null;
  }

  // 即時類題: 同じ組の b(数値と名前だけを変えた問題)。解き済みなら同じトピックの未出題の b
  const similarFor = (qq: Question): Question | undefined => {
    const own = questionById.get(groupOf(qq.id) + 'b');
    if (own && own.id !== qq.id && !seen.has(own.id)) return own;
    return practiceQuestionsOfTopic(qq.topicId).find((x) => x.side === 'b' && x.id !== qq.id && x.id !== current?.id && !seen.has(x.id));
  };

  const goNext = (forced?: Question) => {
    const nextSeen = new Set(seen);
    if (current) nextSeen.add(current.id);
    setSeen(nextSeen);
    setAnswered(false);
    if (forced) return setCurrent({ id: forced.id, similar: true });
    const id = pickNext(plan.topics, nextSeen, plan.reviewAll);
    setCurrent(id ? { id, similar: false } : null);
  };

  const summary = useMemo(() => ({ total: log.length, ok: log.filter((l) => l.ok).length }), [log]);

  if (!q) {
    return (
      <div className="view">
        <button type="button" className="back" onClick={onExit}>
          ← 戻る
        </button>
        <h1>演習おつかれさまでした</h1>
        <p className="lead">
          {field.name}:{summary.total}問中 {summary.ok}問正解
        </p>
        <ul className="topic-list">
          {plan.topics.map((t) => (
            <li key={t} className="topic-row">
              <div>
                <strong>{topicById.get(t)?.name}</strong>
                <StreakDots streak={progress.topics[t]?.streak ?? 0} mastered={topicStatus(progress, t) === 'mastered'} />
              </div>
              <StatusChip status={topicStatus(progress, t)} />
            </li>
          ))}
        </ul>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onOpenField(fieldId)}>
            分野の習熟度を見る
          </button>
          <button type="button" className="btn" onClick={onExit}>
            ホームへ
          </button>
        </div>
      </div>
    );
  }

  const topic = topicById.get(q.topicId)!;
  const tState = progress.topics[q.topicId];
  const similar = similarFor(q);

  return (
    <div className="view">
      <div className="session-bar">
        <button type="button" className="back" onClick={onExit}>
          ← 演習を終える
        </button>
        <span className="muted small">
          {field.name} ・ トピック {Math.min(topicIndex + 1, plan.topics.length)}/{plan.topics.length} ・ この回 {summary.ok}/{summary.total} 正解
        </span>
      </div>
      <div className="topic-strip">
        <strong>{topic.name}</strong>
        <StreakDots streak={tState?.streak ?? 0} mastered={!!tState?.mastered} />
        <span className="muted small">{tState?.mastered ? '習得済み' : `${MASTER_STREAK}問連続正解で習得`}</span>
      </div>
      <QuestionPlayer
        key={q.id + (current?.similar ? '-s' : '')}
        q={q}
        mode="p"
        badge={current?.similar || q.side === 'b' ? '即時類題' : undefined}
        onAnswered={(ok) => {
          setAnswered(true);
          setLog((l) => [...l, { id: q.id, ok, similar: !!current?.similar }]);
        }}
        actions={(ok) =>
          answered && (
            <>
              {!ok && similar && (
                <button type="button" className="btn primary" onClick={() => goNext(similar)}>
                  理解した → 類題に挑戦
                </button>
              )}
              <button type="button" className={`btn ${ok || !similar ? 'primary' : ''}`} onClick={() => goNext()}>
                次の問題へ
              </button>
            </>
          )
        }
      />
    </div>
  );
}
