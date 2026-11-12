import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { Question } from '../types';
import { bank, DIFF_LABEL, FORMAT_LABEL, sameSet, topicById } from '../data';
import { MASTER_STREAK, recordAnswer } from '../store';
import { CodeView } from './CodeView';

const Playground = lazy(() => import('./Playground'));

type Props = {
  q: Question;
  /** p: 演習 / r: 復習 / view: 記録しない(模擬試験の振り返りなど) */
  mode: 'p' | 'r' | 'view';
  presetPicks?: string[];
  badge?: string;
  /** 復習で出題したときの組 ID(正誤でその組の復習段階を進める・戻す) */
  reviewGroup?: string;
  onAnswered?: (ok: boolean) => void;
  actions?: (ok: boolean) => ReactNode;
};

export default function QuestionPlayer({ q, mode, presetPicks, badge, reviewGroup, onAnswered, actions }: Props) {
  const [picked, setPicked] = useState<string[]>(presetPicks ?? []);
  const [answered, setAnswered] = useState(presetPicks !== undefined);
  const [notice, setNotice] = useState<{ kind: 'good' | 'warn'; text: string } | null>(null);
  const [showRun, setShowRun] = useState(false);
  const topic = topicById.get(q.topicId);
  const multi = q.selectCount > 1;
  const ok = sameSet(picked, q.answer);
  const run = bank.runs[q.id];
  const errLines = q.verify.kind === 'program' ? (q.explanation.compileErrors ?? []).map((e) => e.line) : [];

  const toggle = (label: string) => {
    if (answered) return;
    if (!multi) return setPicked([label]);
    setPicked((p) => (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]));
  };

  const submit = () => {
    if (picked.length !== q.selectCount || answered) return;
    setAnswered(true);
    if (mode !== 'view') {
      const r = recordAnswer(q.id, ok, mode, reviewGroup);
      if (r.mastered) setNotice({ kind: 'good', text: `${MASTER_STREAK}問連続正解で「${topicById.get(r.mastered)?.name}」を習得しました` });
      else if (r.lostMastery) setNotice({ kind: 'warn', text: `「${topicById.get(r.lostMastery)?.name}」は演習中に戻りました。もう一度${MASTER_STREAK}問連続正解を目指しましょう` });
      else if (!ok && mode === 'r') setNotice({ kind: 'warn', text: 'この組の復習は1日後からやり直します' });
      else if (!ok) setNotice({ kind: 'warn', text: '復習リストに追加しました(1日後に、観点を変えた問題で再出題)' });
    }
    onAnswered?.(ok);
  };

  return (
    <article className="qcard">
      <header className="qhead">
        {badge && <span className="chip accent">{badge}</span>}
        <span className="chip">{topic?.name}</span>
        <span className={`chip diff d${q.difficulty}`}>{DIFF_LABEL[q.difficulty]}</span>
        <span className="chip">{FORMAT_LABEL[q.format]}</span>
        <span className="qid">{q.id}</span>
      </header>
      <p className="prompt">{q.prompt}</p>
      {q.files.map((f) => (
        <div key={f.path}>
          {q.files.length > 1 && <p className="fname">{f.path}</p>}
          <CodeView lines={f.code} errLines={answered ? errLines : []} />
        </div>
      ))}
      {q.command && (
        <p className="cmd">
          実行コマンド: <code>{q.command}</code>
        </p>
      )}
      <ul className="opts" role={multi ? 'group' : 'radiogroup'} aria-label="選択肢">
        {q.options.map((o) => {
          const isPicked = picked.includes(o.label);
          const isAnswer = q.answer.includes(o.label);
          const optRun = run?.kind === 'per-option' ? run.options[o.label] : undefined;
          const cls = ['opt', isPicked ? 'picked' : '', answered && isAnswer ? 'correct' : '', answered && isPicked && !isAnswer ? 'wrong' : ''].join(' ');
          return (
            <li key={o.label} className={cls}>
              <label>
                <input type={multi ? 'checkbox' : 'radio'} name={`q-${q.id}`} checked={isPicked} disabled={answered} onChange={() => toggle(o.label)} />
                <span className="lbl">{o.label}</span>
                <span className="body">{o.code ? <CodeView lines={o.code.split('\n')} numbered={false} compact /> : o.text}</span>
              </label>
              {answered && (
                <span className="marks">
                  {isAnswer && <span className="mark-ok">正解</span>}
                  {optRun && <span className={`mark-run ${optRun.compile === 'error' ? 'is-err' : ''}`}>{optRun.compile === 'error' ? 'コンパイルエラー' : 'コンパイル成功'}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {!answered ? (
        <div className="submit-row">
          <button type="button" className="btn primary" onClick={submit} disabled={picked.length !== q.selectCount}>
            解答する
          </button>
          <span className="hint">{multi ? `${q.selectCount}つ選択(あと${Math.max(0, q.selectCount - picked.length)}つ)` : '1つ選択'}</span>
        </div>
      ) : (
        <section className="result" aria-live="polite">
          <div className={`verdict ${ok ? 'good' : 'bad'}`}>
            <strong>{ok ? '正解' : '不正解'}</strong>
            {!ok && <span>正解は {q.answer.join('・')}</span>}
          </div>
          {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
          <p className="point">
            <span className="tag">要点</span>
            {q.explanation.point}
          </p>
          {q.variationNote && (
            <p className="point">
              <span className="tag">この問題の観点</span>
              {q.variationNote}
            </p>
          )}
          <div className="result-tools">
            <button type="button" className="btn" onClick={() => setShowRun((s) => !s)} aria-expanded={showRun}>
              {showRun ? 'コード実行を閉じる' : 'コードを実行して確認'}
            </button>
          </div>
          {showRun && (
            <Suspense fallback={<p className="muted">エディタを読み込み中…</p>}>
              <Playground q={q} />
            </Suspense>
          )}
          <details className="fold">
            <summary>詳しい解説</summary>
            <p>{q.explanation.detail}</p>
            <dl className="why">
              {q.options.map((o) => (
                <div key={o.label} className={q.answer.includes(o.label) ? 'is-answer' : ''}>
                  <dt>{o.label}</dt>
                  <dd>{q.explanation.options[o.label]}</dd>
                </div>
              ))}
            </dl>
            {(q.explanation.compileErrors?.length ?? 0) > 0 && (
              <div className="javac">
                <h4>javac(JDK 17)のエラー</h4>
                <ul>
                  {q.explanation.compileErrors!.map((e, i) => (
                    <li key={i}>
                      {e.option ? `選択肢 ${e.option}: ` : `${e.line}行目: `}
                      <code>{e.message}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="refs">
              {q.refs.map((r) => (
                <li key={r.url}>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          {topic && (
            <details className="fold">
              <summary>このトピックの要点</summary>
              <ul>
                {topic.keyPoints.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </details>
          )}
          {actions && <div className="actions">{actions(ok)}</div>}
        </section>
      )}
    </article>
  );
}
