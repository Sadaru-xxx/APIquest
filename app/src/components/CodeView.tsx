import { Fragment, type ReactNode } from 'react';

const KW = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var yield record sealed permits true false null'.split(' '),
);
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b\d[\d_]*(?:\.\d+)?[LlFfDd]?\b)|([A-Za-z_$][\w$]*)/g;

export function highlightLine(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  let k = 0;
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const t = m[0];
    const cls = m[1] ? 't-com' : m[2] || m[3] ? 't-str' : m[4] ? 't-num' : KW.has(t) ? 't-kw' : /^[A-Z]/.test(t) ? 't-type' : '';
    out.push(cls ? (
      <span key={k++} className={cls}>
        {t}
      </span>
    ) : (
      t
    ));
    last = m.index + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function CodeView({ lines, numbered = true, errLines = [], compact = false }: { lines: string[]; numbered?: boolean; errLines?: number[]; compact?: boolean }) {
  return (
    <pre className={`code${numbered ? ' numbered' : ''}${compact ? ' compact' : ''}`}>
      <code>
        {lines.map((l, i) => (
          <span key={i} className={`row${errLines.includes(i + 1) ? ' err' : ''}`}>
            {numbered && <span className="ln">{i + 1}</span>}
            <span className="src">{l === '' ? ' ' : highlightLine(l).map((n, j) => <Fragment key={j}>{n}</Fragment>)}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}
