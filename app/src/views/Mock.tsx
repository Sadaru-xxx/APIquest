import { useEffect, useState } from 'react';
import type { FieldId, MockInProgress, MockRecord } from '../types';
import { bank, DIFF_LABEL, hasQuestions, questionById, sameSet, topicById } from '../data';
import { pushMock, recordAnswer, setMockInProgress, store, useProgress } from '../store';
import { CodeView } from '../components/CodeView';
import QuestionPlayer from '../components/QuestionPlayer';
import { Bar, fmtDate } from '../components/Bits';

const FULL_COUNT = 60;
const FULL_SEC = 90 * 60;
const PASS_RATE = 0.65;

function plan() {
  const fields = bank.fields.filter((f) => hasQuestions(f.id));
  const full = fields.length === bank.fields.length;
  const perField = full ? FULL_COUNT / bank.fields.length : FULL_COUNT;
  const pairs: string[] = [];
  for (const f of fields) {
    const ids = [...new Set(bank.questions.filter((q) => q.fieldId === f.id).map((q) => q.pairId))];
    pairs.push(...shuffle(ids).slice(0, perField));
  }
  const n = Math.min(FULL_COUNT, pairs.length);
  return { full, fields, pairs: pairs.slice(0, n), n, limitSec: Math.round((FULL_SEC * n) / FULL_COUNT) };
}
function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const passLine = (n: number) => Math.ceil(n * PASS_RATE);

type Props = { onPractice: (f: FieldId, topicIds?: string[]) => void };

export default function Mock({ onPractice }: Props) {
  const p = useProgress();
  const [resultIdx, setResultIdx] = useState<number | null>(null);

  if (p.mockInProgress) return <Exam m={p.mockInProgress} onDone={(idx) => setResultIdx(idx)} />;
  if (resultIdx !== null && p.mocks[resultIdx]) return <Result r={p.mocks[resultIdx]} onBack={() => setResultIdx(null)} onPractice={onPractice} />;

  const pl = plan();
  const start = () => {
    // 各組から表か復習バリエーションのどちらか1問(表とほぼ同じ即時類題は使わない)
    const qids = shuffle(pl.pairs.map((pid) => (Math.random() < 0.5 || !questionById.has(pid + 'c') ? pid + 'a' : pid + 'c')));
    const m: MockInProgress = { startedAt: Date.now(), limitSec: pl.limitSec, qids, answers: {}, flags: [], current: 0 };
    setMockInProgress(m);
  };

  return (
    <div className="view">
      <h1>模擬試験</h1>
      <p className="lead">本試験と同じく、解答中は正誤を表示しません。時間切れになると自動で採点します。</p>
      <section className="hero">
        <dl className="spec">
          <div>
            <dt>問題数</dt>
            <dd>{pl.n}問</dd>
          </div>
          <div>
            <dt>制限時間</dt>
            <dd>{mmss(pl.limitSec)}</dd>
          </div>
          <div>
            <dt>合格ライン</dt>
            <dd>
              {passLine(pl.n)}問(65%)
            </dd>
          </div>
        </dl>
        {!pl.full && (
          <p className="banner warn">
            いまは問題がそろっている分野({pl.fields.map((f) => f.name).join('、')})だけで出題します。全6分野がそろうと、本試験と同じ60問・90分になります。時間は問題数に合わせて短くしています。
          </p>
        )}
        <button type="button" className="btn primary big" onClick={start} disabled={pl.n === 0}>
          模擬試験を始める
        </button>
      </section>
      {p.mocks.length > 0 && (
        <section>
          <h2 className="section-title">これまでの結果</h2>
          <ul className="qlist">
            {p.mocks
              .map((r, i) => ({ r, i }))
              .reverse()
              .map(({ r, i }) => (
                <li key={r.at}>
                  <button type="button" className="qlink" onClick={() => setResultIdx(i)}>
                    <span>{fmtDate(r.at)}</span>
                    <strong>
                      {r.correct}/{r.total}問
                    </strong>
                    <span className={r.correct >= passLine(r.total) ? 'good-text' : 'bad-text'}>{r.correct >= passLine(r.total) ? '合格ライン到達' : '合格ライン未満'}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Exam({ m, onDone }: { m: MockInProgress; onDone: (idx: number) => void }) {
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState(false);
  const remaining = Math.max(0, m.limitSec - (now - m.startedAt) / 1000);
  const id = m.qids[m.current];
  const q = questionById.get(id)!;
  const picked = m.answers[id] ?? [];
  const multi = q.selectCount > 1;
  const unanswered = m.qids.filter((x) => (m.answers[x]?.length ?? 0) !== questionById.get(x)!.selectCount).length;

  const grade = () => {
    const cur = store.get().mockInProgress;
    if (!cur) return;
    const items = cur.qids.map((qid) => {
      const pk = cur.answers[qid] ?? [];
      return { id: qid, picked: pk, ok: sameSet(pk, questionById.get(qid)!.answer) };
    });
    for (const it of items) if (it.picked.length) recordAnswer(it.id, it.ok, 'm'); // 未回答は記録しない(採点では不正解)
    const sec = Math.min(cur.limitSec, Math.round((Date.now() - cur.startedAt) / 1000));
    pushMock({ at: cur.startedAt, total: items.length, correct: items.filter((i) => i.ok).length, sec, limitSec: cur.limitSec, items });
    onDone(store.get().mocks.length - 1);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (remaining <= 0) grade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0]);

  const update = (patch: Partial<MockInProgress>) => setMockInProgress({ ...m, ...patch });
  const choose = (label: string) => {
    const next = multi ? (picked.includes(label) ? picked.filter((x) => x !== label) : [...picked, label]) : [label];
    update({ answers: { ...m.answers, [id]: next } });
  };
  const toggleFlag = () => update({ flags: m.flags.includes(id) ? m.flags.filter((x) => x !== id) : [...m.flags, id] });

  return (
    <div className="view exam">
      <div className="exam-bar">
        <span className={`timer ${remaining < 300 ? 'low' : ''}`} aria-live="off">
          残り {mmss(remaining)}
        </span>
        <span className="muted small">
          {m.current + 1}/{m.qids.length}問 ・ 未回答 {unanswered}
        </span>
        <button type="button" className="btn small" onClick={() => setConfirming(true)}>
          採点する
        </button>
      </div>
      {confirming && (
        <div className="confirm" role="dialog" aria-label="採点の確認">
          <p>
            未回答が {unanswered}問、見直しチェックが {m.flags.length}問あります。採点すると解答を変更できません。
          </p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={grade}>
              採点する
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              解答に戻る
            </button>
          </div>
        </div>
      )}
      <article className="qcard">
        <header className="qhead">
          <span className="chip accent">問{m.current + 1}</span>
          <span className={`chip diff d${q.difficulty}`}>{DIFF_LABEL[q.difficulty]}</span>
          {m.flags.includes(id) && <span className="chip warn">見直し</span>}
        </header>
        <p className="prompt">{q.prompt}</p>
        {q.files.map((f) => (
          <CodeView key={f.path} lines={f.code} />
        ))}
        {q.command && (
          <p className="cmd">
            実行コマンド: <code>{q.command}</code>
          </p>
        )}
        <ul className="opts" role={multi ? 'group' : 'radiogroup'} aria-label="選択肢">
          {q.options.map((o) => (
            <li key={o.label} className={`opt ${picked.includes(o.label) ? 'picked' : ''}`}>
              <label>
                <input type={multi ? 'checkbox' : 'radio'} name={`m-${id}`} checked={picked.includes(o.label)} onChange={() => choose(o.label)} />
                <span className="lbl">{o.label}</span>
                <span className="body">{o.code ? <CodeView lines={o.code.split('\n')} numbered={false} compact /> : o.text}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="exam-nav">
          <button type="button" className="btn" disabled={m.current === 0} onClick={() => update({ current: m.current - 1 })}>
            ← 前へ
          </button>
          <button type="button" className={`btn ${m.flags.includes(id) ? 'warn' : ''}`} onClick={toggleFlag} aria-pressed={m.flags.includes(id)}>
            見直し
          </button>
          {m.current + 1 < m.qids.length ? (
            <button type="button" className="btn primary" onClick={() => update({ current: m.current + 1 })}>
              次へ →
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => setConfirming(true)}>
              採点へ
            </button>
          )}
        </div>
      </article>
      <nav className="navgrid" aria-label="問題一覧">
        {m.qids.map((x, i) => {
          const done = (m.answers[x]?.length ?? 0) === questionById.get(x)!.selectCount;
          return (
            <button
              key={x}
              type="button"
              className={`${done ? 'done' : ''} ${m.flags.includes(x) ? 'flag' : ''} ${i === m.current ? 'cur' : ''}`}
              onClick={() => update({ current: i })}
              aria-label={`問${i + 1}${done ? ' 回答済み' : ''}${m.flags.includes(x) ? ' 見直し' : ''}`}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Result({ r, onBack, onPractice }: { r: MockRecord; onBack: () => void; onPractice: Props['onPractice'] }) {
  const [open, setOpen] = useState<string | null>(null);
  const pass = r.correct >= passLine(r.total);
  const byField = bank.fields.map((f) => {
    const its = r.items.filter((i) => questionById.get(i.id)?.fieldId === f.id);
    return { f, total: its.length, ok: its.filter((i) => i.ok).length };
  });
  const topicMap = new Map<string, { ok: number; total: number }>();
  for (const it of r.items) {
    const t = questionById.get(it.id)!.topicId;
    const cur = topicMap.get(t) ?? { ok: 0, total: 0 };
    topicMap.set(t, { ok: cur.ok + (it.ok ? 1 : 0), total: cur.total + 1 });
  }
  const byTopic = [...topicMap.entries()].map(([t, v]) => ({ t, ...v, rate: v.ok / v.total })).sort((a, b) => a.rate - b.rate);
  const weakField = byField.filter((x) => x.total > 0).sort((a, b) => a.ok / a.total - b.ok / b.total)[0];
  const weakTopics = byTopic.filter((x) => x.rate < PASS_RATE && topicById.get(x.t)?.fieldId === weakField?.f.id).map((x) => x.t);

  return (
    <div className="view">
      <button type="button" className="back" onClick={onBack}>
        ← 模擬試験
      </button>
      <h1>模擬試験の結果</h1>
      <section className={`score ${pass ? 'good' : 'bad'}`}>
        <span className="score-num">
          {r.correct}
          <small>/{r.total}</small>
        </span>
        <div>
          <strong>{pass ? '合格ライン到達' : '合格ライン未満'}</strong>
          <p className="muted small">
            正答率 {Math.round((r.correct / r.total) * 100)}%(合格ライン {passLine(r.total)}問)・ 解答時間 {mmss(r.sec)} / {mmss(r.limitSec)}
          </p>
        </div>
      </section>
      {weakField && (
        <div className="actions">
          <button type="button" className="btn primary big" onClick={() => onPractice(weakField.f.id, weakTopics.length ? weakTopics : undefined)}>
            弱点分野の演習に戻る({weakField.f.name})
          </button>
        </div>
      )}
      <h2 className="section-title">分野別</h2>
      <table className="breakdown">
        <thead>
          <tr>
            <th scope="col">分野</th>
            <th scope="col">正解</th>
            <th scope="col">正答率</th>
          </tr>
        </thead>
        <tbody>
          {byField.map((x) => (
            <tr key={x.f.id} className={x.total ? '' : 'off'}>
              <td>
                {x.f.no}. {x.f.name}
              </td>
              <td className="num">{x.total ? `${x.ok}/${x.total}` : '出題なし'}</td>
              <td>{x.total > 0 && <Bar value={x.ok} max={x.total} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="section-title">トピック別(正答率の低い順)</h2>
      <table className="breakdown">
        <tbody>
          {byTopic.map((x) => (
            <tr key={x.t}>
              <td>{topicById.get(x.t)?.name}</td>
              <td className="num">
                {x.ok}/{x.total}
              </td>
              <td>
                <Bar value={x.ok} max={x.total} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="section-title">問題ごとの結果</h2>
      <ul className="qlist">
        {r.items.map((it, i) => {
          const q = questionById.get(it.id)!;
          return (
            <li key={it.id}>
              <button type="button" className="qlink" onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}>
                <span className={it.ok ? 'good-text' : 'bad-text'}>{it.ok ? '○' : '×'}</span>
                <span>問{i + 1}</span>
                <span className="qid">{it.id}</span>
                <span className="muted small">{topicById.get(q.topicId)?.name}</span>
              </button>
              {open === it.id && (
                <div className="inline-q">
                  <QuestionPlayer q={q} mode="view" presetPicks={it.picked.length ? it.picked : []} />
                  <p className="muted small">同じ組の問題({q.pairId}a・{q.pairId}b・{q.pairId}c)は問題一覧から解けます。</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
