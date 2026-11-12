import { useMemo, useState } from 'react';
import { bank, DIFF_LABEL, FORMAT_LABEL, hasQuestions, SIDE_LABEL, topicById } from '../data';
import { lastResults, useProgress } from '../store';

type Filters = { kw: string; field: string; topic: string; diff: string; format: string; side: string; state: string };
const EMPTY: Filters = { kw: '', field: '', topic: '', diff: '', format: '', side: '', state: '' };

export default function Search({ onOpen }: { onOpen: (id: string) => void }) {
  const p = useProgress();
  const [f, setF] = useState<Filters>(EMPTY);
  const last = useMemo(() => lastResults(p), [p]);
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'field' ? { topic: '' } : {}) }));

  const results = useMemo(() => {
    const kws = f.kw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return bank.questions.filter((q) => {
      if (f.field && q.fieldId !== f.field) return false;
      if (f.topic && q.topicId !== f.topic) return false;
      if (f.diff && String(q.difficulty) !== f.diff) return false;
      if (f.format && q.format !== f.format) return false;
      if (f.side && q.side !== f.side) return false;
      if (f.state === 'new' && last.has(q.id)) return false;
      if (f.state === 'ok' && last.get(q.id) !== true) return false;
      if (f.state === 'ng' && last.get(q.id) !== false) return false;
      if (kws.length) {
        const hay = [q.id, q.prompt, topicById.get(q.topicId)?.name ?? '', ...q.tags, ...q.files.flatMap((x) => x.code), ...q.options.map((o) => o.text ?? o.code ?? ''), q.explanation.point].join('\n').toLowerCase();
        if (!kws.every((k) => hay.includes(k.replace(/^#/, '')))) return false;
      }
      return true;
    });
  }, [f, last]);

  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const q of bank.questions) for (const t of q.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([t]) => t);
  }, []);

  return (
    <div className="view">
      <h1>問題一覧</h1>
      <div className="filters">
        <label className="kw">
          <span className="sr">キーワード</span>
          <input id="search-kw" type="search" placeholder="キーワード・タグ・ID(例: yield、短絡評価、oc-12)" value={f.kw} onChange={set('kw')} />
        </label>
        <select id="search-field" aria-label="分野" value={f.field} onChange={set('field')}>
          <option value="">すべての分野</option>
          {bank.fields.map((x) => (
            <option key={x.id} value={x.id} disabled={!hasQuestions(x.id)}>
              {x.no}. {x.name}
              {hasQuestions(x.id) ? '' : '(準備中)'}
            </option>
          ))}
        </select>
        <select id="search-topic" aria-label="トピック" value={f.topic} onChange={set('topic')}>
          <option value="">すべてのトピック</option>
          {bank.topics
            .filter((t) => !f.field || t.fieldId === f.field)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
        <select id="search-diff" aria-label="難易度" value={f.diff} onChange={set('diff')}>
          <option value="">難易度</option>
          <option value="1">易</option>
          <option value="2">中</option>
          <option value="3">難</option>
        </select>
        <select id="search-format" aria-label="形式" value={f.format} onChange={set('format')}>
          <option value="">形式</option>
          <option value="result">実行結果を選ぶ</option>
          <option value="compile">コンパイル可否を選ぶ</option>
        </select>
        <select id="search-side" aria-label="表と類題" value={f.side} onChange={set('side')}>
          <option value="">表・類題すべて</option>
          <option value="a">表</option>
          <option value="b">即時類題</option>
          <option value="c">復習バリエーション</option>
        </select>
        <select id="search-state" aria-label="解答状況" value={f.state} onChange={set('state')}>
          <option value="">解答状況</option>
          <option value="new">未回答</option>
          <option value="ok">前回正解</option>
          <option value="ng">前回不正解</option>
        </select>
      </div>
      <div className="tagcloud" aria-label="よく使うタグ">
        {tags.map((t) => (
          <button key={t} type="button" className={`tagbtn ${f.kw === t ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, kw: x.kw === t ? '' : t }))}>
            #{t}
          </button>
        ))}
      </div>
      <p className="muted small">
        {results.length}問
        {JSON.stringify(f) !== JSON.stringify(EMPTY) && (
          <button type="button" className="linkbtn" onClick={() => setF(EMPTY)}>
            条件をクリア
          </button>
        )}
      </p>
      <ul className="qlist">
        {results.map((q) => {
          const r = last.get(q.id);
          return (
            <li key={q.id}>
              <button type="button" className="qlink rich" onClick={() => onOpen(q.id)}>
                <span className="qline">
                  <span className="qid">{q.id}</span>
                  <span className="chip">{topicById.get(q.topicId)?.name}</span>
                  <span className={`chip diff d${q.difficulty}`}>{DIFF_LABEL[q.difficulty]}</span>
                  <span className="chip">{FORMAT_LABEL[q.format]}</span>
                  {q.side !== 'a' && <span className="chip">{SIDE_LABEL[q.side]}</span>}
                  {r !== undefined && <span className={r ? 'good-text small' : 'bad-text small'}>{r ? '前回○' : '前回×'}</span>}
                </span>
                <span className="qprev">{q.explanation.point}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
