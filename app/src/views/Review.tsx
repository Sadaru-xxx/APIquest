import { useState } from 'react';
import { questionById, SIDE_LABEL, sideOf, topicById } from '../data';
import { dueReviews, REVIEW_DAYS, reviewQuestionFor, startOfDay, store, useProgress } from '../store';
import QuestionPlayer from '../components/QuestionPlayer';
import { fmtDate } from '../components/Bits';

const DAY = 86400000;

export default function Review({ onOpenQuestion }: { onOpenQuestion: (id: string) => void }) {
  const p = useProgress();
  const [session, setSession] = useState<{ items: { group: string; qid: string; stage: number }[]; i: number; ok: number; answered: boolean } | null>(null);

  if (session) {
    const item = session.items[session.i];
    const q = item ? questionById.get(item.qid) : undefined;
    if (!q) {
      return (
        <div className="view">
          <h1>今日の復習が終わりました</h1>
          <p className="lead">
            {session.items.length}問中 {session.ok}問正解。正解した組は次の間隔(3日後・7日後)に進み、間違えた組は1日後にもう一度出ます。
          </p>
          <button type="button" className="btn primary" onClick={() => setSession(null)}>
            復習リストに戻る
          </button>
        </div>
      );
    }
    return (
      <div className="view">
        <div className="session-bar">
          <button type="button" className="back" onClick={() => setSession(null)}>
            ← 復習を中断
          </button>
          <span className="muted small">
            復習 {session.i + 1}/{session.items.length}
          </span>
        </div>
        <QuestionPlayer
          key={q.id}
          q={q}
          mode="r"
          badge={`復習(${REVIEW_DAYS[item.stage]}日後の回)`}
          reviewGroup={item.group}
          onAnswered={(ok) => setSession((s) => s && { ...s, ok: s.ok + (ok ? 1 : 0), answered: true })}
          actions={() => (
            <button type="button" className="btn primary" onClick={() => setSession((s) => s && { ...s, i: s.i + 1, answered: false })}>
              {session.i + 1 < session.items.length ? '次の復習へ' : '結果を見る'}
            </button>
          )}
        />
      </div>
    );
  }

  const due = dueReviews(p);
  const today = startOfDay();
  const upcoming = Object.entries(p.reviews)
    .filter(([g, r]) => r.due > Date.now() && questionById.has(g + 'a'))
    .sort((a, b) => a[1].due - b[1].due);
  const groups = [
    { label: '明日', items: upcoming.filter(([, r]) => r.due < today + 2 * DAY) },
    { label: '3日以内', items: upcoming.filter(([, r]) => r.due >= today + 2 * DAY && r.due < today + 4 * DAY) },
    { label: 'それ以降', items: upcoming.filter(([, r]) => r.due >= today + 4 * DAY) },
  ];

  return (
    <div className="view">
      <h1>復習</h1>
      <p className="lead">間違えた問題の組を 1日後 → 3日後 → 7日後 に出し直します。同じ問題ではなく、観点を変えた復習バリエーションで出題します。7日後の回も正解すると卒業です。</p>
      <section className={`hero ${due.length ? '' : 'quiet'}`}>
        <h2>{due.length ? `今日の復習は ${due.length}問` : '今日の復習はありません'}</h2>
        {due.length > 0 ? (
          <button
            type="button"
            className="btn primary big"
            onClick={() => {
              const p0 = store.get();
              setSession({ items: due.map((g) => ({ group: g, qid: reviewQuestionFor(p0, g), stage: p0.reviews[g]?.stage ?? 0 })), i: 0, ok: 0, answered: false });
            }}
          >
            復習を始める
          </button>
        ) : (
          <p className="muted">{upcoming.length ? `次の復習は ${fmtDate(upcoming[0][1].due)} です。` : '演習で間違えた問題がここに入ります。'}</p>
        )}
      </section>
      {upcoming.length > 0 && (
        <section>
          <h2 className="section-title">この先の予定</h2>
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <div key={g.label} className="review-group">
                <h3>
                  {g.label}
                  <span className="muted small">{g.items.length}問</span>
                </h3>
                <ul className="qlist">
                  {g.items.map(([group, r]) => {
                    const q = questionById.get(group + 'a')!;
                    const next = reviewQuestionFor(p, group);
                    return (
                      <li key={group}>
                        <button type="button" className="qlink" onClick={() => onOpenQuestion(group + 'a')}>
                          <span className="qid">{group}</span>
                          <span>{topicById.get(q.topicId)?.name}</span>
                          <span className="muted small">
                            {fmtDate(r.due)} ・ {REVIEW_DAYS[r.stage]}日後の回 ・ 出題予定 {next}({SIDE_LABEL[sideOf(next)]})
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
