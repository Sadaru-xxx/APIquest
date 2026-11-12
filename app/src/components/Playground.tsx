import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { java } from '@codemirror/lang-java';
import { tags as t } from '@lezer/highlight';
import type { Question, RunResult } from '../types';
import { bank, embedOption } from '../data';
import { FAILURE_TEXT, runJava, runnerStatus, type RunnerFailure, type RunnerResult, type RunnerStatus } from '../runner';

// ───────── エディタの設定 ─────────
const setErrLines = StateEffect.define<number[]>();
const errField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrLines)) {
        const lines = e.value.filter((n) => n >= 1 && n <= tr.state.doc.lines).sort((a, b) => a - b);
        deco = Decoration.set(lines.map((n) => Decoration.line({ class: 'cm-errline' }).range(tr.state.doc.line(n).from)));
      }
    }
    if (tr.docChanged) deco = Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const hl = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.definitionKeyword, t.operatorKeyword, t.bool, t.null], color: 'var(--t-kw)', fontWeight: '600' },
  { tag: [t.string, t.character], color: 'var(--t-str)' },
  { tag: [t.number], color: 'var(--t-num)' },
  { tag: [t.typeName, t.className], color: 'var(--t-type)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--muted)', fontStyle: 'italic' },
]);
const theme = EditorView.theme({
  '&': { fontSize: '13.5px', backgroundColor: 'var(--code-bg)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: '8px' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-content': { fontFamily: 'var(--font-code)', caretColor: 'var(--ink)', padding: '8px 0' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-errline': { backgroundColor: 'var(--bad-soft)' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)' },
});
const baseExtensions = (onChange: () => void): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  java(),
  syntaxHighlighting(hl),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  EditorState.tabSize.of(4),
  errField,
  theme,
  EditorView.updateListener.of((u) => u.docChanged && onChange()),
];

// 空白の違いだけかどうかを判定するための簡易トークン列
const TOKENS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/[^\n]*|[A-Za-z_$0-9.]+|\+\+|--|&&|\|\||->|<<=?|>>>?=?|[<>=!+\-*/%&|^]=|\S/g;
const tokens = (s: string) => (s.match(TOKENS) ?? []).join('\u0001');

type Variant = { key: string; label: string; code: string; run: RunResult; command: string };
type Output =
  | { kind: 'result'; whitespaceOnly: boolean }
  | { kind: 'running' }
  | { kind: 'live'; r: RunnerResult }
  | { kind: 'failed'; reason: RunnerFailure; message: string; whitespaceOnly: boolean }
  | null;

/** 実行サーバーの結果を、検証済み結果と同じ形に直す */
function liveToRun(r: RunnerResult): RunResult {
  if (r.compile === 'error') return { compile: 'error', javac: r.javac };
  if (r.compile === 'timeout') return { compile: 'error', javac: r.javac + '(コンパイルが10秒以内に終わらなかったため打ち切りました)\n' };
  return { compile: 'ok', stdout: r.stdout, stderr: r.stderr, timeout: r.timedOut };
}
const parseCommand = (cmd: string) => {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  return parts[0] === 'java' && parts[1] ? { mainClass: parts[1], args: parts.slice(2) } : { mainClass: 'Main', args: [] as string[] };
};

export default function Playground({ q }: { q: Question }) {
  const variants: Variant[] = useMemo(() => {
    const r = bank.runs[q.id];
    if (r?.kind === 'per-option') {
      return q.options.map((o) => ({ key: o.label, label: `選択肢 ${o.label}`, code: embedOption(q, o.label).join('\n'), run: r.options[o.label], command: '' }));
    }
    const file = q.files[0];
    return file && r?.kind === 'program' ? [{ key: 'main', label: file.path, code: file.code.join('\n'), run: r.run, command: q.command ?? `java ${file.path.replace(/\.java$/, '').replace(/\//g, '.')}` }] : [];
  }, [q]);
  const [active, setActive] = useState(variants[0]?.key ?? '');
  const [output, setOutput] = useState<Output>(null);
  const [edited, setEdited] = useState(false);
  const [fmtMsg, setFmtMsg] = useState('');
  const [runner, setRunner] = useState<RunnerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    runnerStatus().then((s) => alive && setRunner(s));
    return () => {
      alive = false;
    };
  }, []);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const variant = variants.find((v) => v.key === active) ?? variants[0];

  useEffect(() => {
    if (!host.current || !variant) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: variant.code,
        extensions: baseExtensions(() => {
          setEdited(v.state.doc.toString() !== variant.code);
          setOutput(null);
        }),
      }),
    });
    view.current = v;
    setEdited(false);
    setOutput(null);
    setFmtMsg('');
    return () => v.destroy();
  }, [variant]);

  if (!variant) return <p className="muted">この問題には実行できるコードがありません。</p>;

  const errorLines = (r: RunResult) => (r.compile === 'error' ? [...r.javac.matchAll(/^\S+\.java:(\d+):/gm)].map((m) => Number(m[1])) : []);

  const runCode = async () => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc.toString();
    // 元のコードは、JDK 17 で検証済みの結果をすぐに表示する
    if (doc === variant.code) {
      setOutput({ kind: 'result', whitespaceOnly: false });
      v.dispatch({ effects: setErrLines.of(errorLines(variant.run)) });
      return;
    }
    // 書き換えたコードは実行サーバーで実行する
    const whitespaceOnly = tokens(doc) === tokens(variant.code);
    setOutput({ kind: 'running' });
    const { mainClass, args } = parseCommand(variant.command || 'java Main');
    const path = q.files[0]?.path ?? 'Main.java';
    const res = await runJava({ files: [{ path, content: doc }], mainClass, args });
    if (view.current !== v) return;
    if (res.ok) {
      setOutput({ kind: 'live', r: res.result });
      if (v.state.doc.toString() === doc) v.dispatch({ effects: setErrLines.of(errorLines(liveToRun(res.result))) });
    } else setOutput({ kind: 'failed', reason: res.reason, message: res.message, whitespaceOnly });
  };
  const reset = () => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: variant.code } });
    setEdited(false);
    setOutput(null);
    setFmtMsg('');
  };
  const format = async () => {
    const v = view.current;
    if (!v) return;
    setFmtMsg('整形中…');
    try {
      const [prettier, javaPlugin] = await Promise.all([import('prettier/standalone'), import('prettier-plugin-java')]);
      const formatted = (await prettier.format(v.state.doc.toString(), { parser: 'java', plugins: [javaPlugin.default ?? javaPlugin], tabWidth: 4, printWidth: 100 })).replace(/\n$/, '');
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: formatted } });
      setFmtMsg('整形しました');
    } catch {
      setFmtMsg('構文エラーがあるため整形できません');
    }
  };
  const gotoLine = (n: number) => {
    const v = view.current;
    if (!v || n < 1 || n > v.state.doc.lines) return;
    const line = v.state.doc.line(n);
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    v.focus();
  };

  return (
    <section className="playground" aria-label="コードの実行">
      {variants.length > 1 && (
        <div className="pg-tabs" role="tablist" aria-label="実行するコード">
          {variants.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={v.key === variant.key} className={v.key === variant.key ? 'on' : ''} onClick={() => setActive(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="pg-toolbar">
        <button type="button" className="btn primary small" onClick={runCode}>
          実行
        </button>
        <button type="button" className="btn small" onClick={reset} disabled={!edited}>
          リセット
        </button>
        <button type="button" className="btn small" onClick={format}>
          フォーマット
        </button>
        <span className="muted small">{fmtMsg || (edited ? '書き換え中' : `${variant.label} を表示中`)}</span>
        <span className={`runner-pill ${runner === 'ready' ? 'on' : ''}`} title="書き換えたコードの実行">
          {runner === null ? '実行サーバー確認中' : runner === 'ready' ? '書き換えも実行できます' : '書き換えは実行できません'}
        </span>
      </div>
      <div ref={host} className="pg-editor" />
      {output?.kind === 'running' && <p className="muted small">実行サーバーで実行しています…(最大で約20秒)</p>}
      {output?.kind === 'failed' && (
        <div className="pg-note">
          {FAILURE_TEXT[output.reason]}
          {output.message && <> {output.message}</>}
          {output.whitespaceOnly ? ' 空白や改行だけの違いなので、下に元のコードの検証済み結果を表示します。' : ' 元のコードの結果は「リセット」してから実行すると表示できます。'}
        </div>
      )}
      {output?.kind === 'failed' && output.whitespaceOnly && (
        <div className="console" role="log">
          <div className="console-head">
            <span>{bank.verifiedWith} での実行結果(元のコード)</span>
            <span className="warn-text">行番号は元のコードのものです</span>
          </div>
          <ConsoleBody variant={variant} onGoto={gotoLine} />
        </div>
      )}
      {output?.kind === 'live' && (
        <div className="console" role="log">
          <div className="console-head">
            <span>
              実行サーバー(OpenJDK {output.r.jdk || '17'})での実行結果 ・ {output.r.durationMs}ms
            </span>
            {output.r.run === 'killed' && <span className="warn-text">上限を超えたため強制終了</span>}
            {(output.r.truncated.stdout || output.r.truncated.stderr || output.r.truncated.javac) && <span className="warn-text">出力が長いため 64KB で切っています</span>}
          </div>
          <ConsoleBody variant={{ ...variant, run: liveToRun(output.r), command: output.r.command || variant.command || 'java Main' }} onGoto={gotoLine} />
        </div>
      )}
      {output?.kind === 'result' && (
        <div className="console" role="log">
          <div className="console-head">
            <span>{bank.verifiedWith} での実行結果</span>
            {output.whitespaceOnly && <span className="warn-text">空白や改行だけを変えたコードです。行番号は元のコードのものです</span>}
          </div>
          <ConsoleBody variant={variant} onGoto={gotoLine} />
        </div>
      )}
    </section>
  );
}

function ConsoleBody({ variant, onGoto }: { variant: Variant; onGoto: (n: number) => void }) {
  const r = variant.run;
  return (
    <pre className="console-body">
      <span className="prompt-line">$ javac Main.java</span>
      {'\n'}
      {r.compile === 'error'
        ? r.javac
            .replace(/\n+$/, '')
            .split('\n')
            .map((line, i) => {
              const m = /^(\S+\.java):(\d+):(.*)$/.exec(line);
              return (
                <span key={i} className="err-text">
                  {m ? (
                    <>
                      <button type="button" className="loc" onClick={() => onGoto(Number(m[2]))} title={`${m[2]}行目へ移動`}>
                        {m[1]}:{m[2]}
                      </button>
                      :{m[3]}
                    </>
                  ) : (
                    line
                  )}
                  {'\n'}
                </span>
              );
            })
        : null}
      {r.compile === 'ok' && r.compileOnly && <span className="muted">(コンパイル成功。この問題はコンパイルできるかどうかを確かめます)</span>}
      {r.compile === 'ok' && !r.compileOnly && (
        <>
          <span className="prompt-line">$ {variant.command}</span>
          {'\n'}
          {r.stdout}
          {r.stderr && <span className="err-text">{r.stderr}</span>}
          {r.timeout && <span className="err-text">(10秒以内に終わらなかったため打ち切りました)</span>}
          {!r.stdout && !r.stderr && !r.timeout && <span className="muted">(出力なし)</span>}
        </>
      )}
    </pre>
  );
}
