import { useEffect, useState } from 'react';
import { RUNNER_SERVER, runnerStatus, type RunnerStatus } from '../runner';
import { bank } from '../data';
import { emptyProgress, store, useProgress, useSaveStatus } from '../store';
import type { Progress } from '../types';

const STATUS_TEXT = {
  loading: '保存先を確認しています…',
  cloud: 'claude.ai のアカウントに保存しています。別の端末で開いても続きから学習できます。',
  local: 'このブラウザに保存しています。別の端末とは共有されません。',
  error: 'クラウドへの保存に失敗しました。このブラウザには保存されています。',
};

export default function Settings({ onBack }: { onBack: () => void }) {
  const p = useProgress();
  const status = useSaveStatus();
  const [msg, setMsg] = useState('');
  const [importText, setImportText] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [runner, setRunner] = useState<RunnerStatus | null>(null);
  useEffect(() => {
    runnerStatus().then(setRunner);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(p));
      setMsg('学習データをクリップボードにコピーしました');
    } catch {
      setMsg('コピーできませんでした。ブラウザの設定を確認してください');
    }
  };
  const doImport = () => {
    try {
      const data = JSON.parse(importText) as Progress;
      if (((data as { v: number }).v !== 1 && data.v !== 2) || !Array.isArray(data.attempts)) throw new Error();
      store.replaceAll(data);
      setImportText('');
      setMsg('学習データを読み込みました');
    } catch {
      setMsg('読み込めませんでした。書き出したデータをそのまま貼り付けてください');
    }
  };

  return (
    <div className="view">
      <button type="button" className="back" onClick={onBack}>
        ← 戻る
      </button>
      <h1>設定とデータ</h1>
      <section className="panel">
        <h2>保存先</h2>
        <p>{STATUS_TEXT[status]}</p>
      </section>
      <section className="panel">
        <h2>コードの実行サーバー</h2>
        <p>
          {runner === null
            ? '確認しています…'
            : runner === 'ready'
              ? `コネクタ「${RUNNER_SERVER}」を使って、書き換えたコードを JDK 17 で実行します。初めて実行するときに、claude.ai がこのページでの利用を許可するか確認します。`
              : runner === 'needs_reauth'
                ? `コネクタ「${RUNNER_SERVER}」の接続が切れています。claude.ai の「カスタマイズ → コネクタ」で接続し直してください。`
                : runner === 'not_connected'
                  ? `コネクタ「${RUNNER_SERVER}」が追加されていません。追加すると、書き換えたコードを JDK 17 で実行できます。`
                  : 'この表示環境ではコネクタを使えません。claude.ai でこのアプリを開いてください。'}
        </p>
        <p className="muted small">問題のコードそのものは、実行サーバーがなくても JDK 17 で検証済みの結果を表示します。</p>
      </section>
      <section className="panel">
        <h2>学習データの書き出し・読み込み</h2>
        <p className="muted small">解答 {p.attempts.length}回 ・ 復習待ち {Object.keys(p.reviews).length}問 ・ 模擬試験 {p.mocks.length}回</p>
        <div className="actions">
          <button type="button" className="btn" onClick={copy}>
            コピーして書き出す
          </button>
        </div>
        <label htmlFor="import-text" className="small">
          書き出したデータを貼り付けて読み込む
        </label>
        <textarea id="import-text" rows={3} value={importText} onChange={(e) => setImportText(e.target.value)} />
        <div className="actions">
          <button type="button" className="btn" onClick={doImport} disabled={!importText.trim()}>
            読み込む
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>学習データのリセット</h2>
        {!confirmReset ? (
          <button type="button" className="btn danger" onClick={() => setConfirmReset(true)}>
            すべての学習データを消す
          </button>
        ) : (
          <div className="confirm">
            <p>解答履歴・習熟度・復習予定・模擬試験の結果をすべて消します。元に戻せません。</p>
            <div className="actions">
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  store.replaceAll(emptyProgress());
                  setConfirmReset(false);
                  setMsg('学習データを消しました');
                }}
              >
                消す
              </button>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                やめる
              </button>
            </div>
          </div>
        )}
      </section>
      {msg && (
        <p className="notice good" role="status">
          {msg}
        </p>
      )}
      <section className="panel">
        <h2>このアプリについて</h2>
        <p className="small">
          Oracle Certified Java Programmer, Silver SE 17(1Z0-825-JPN)向けの演習アプリです。問題のコードはすべて {bank.verifiedWith} で実際にコンパイル・実行し、正解の選択肢だけが実行結果と一致することを確かめています。書き換えたコードは、実行サーバーのコネクタを追加すると実行できます。
        </p>
      </section>
    </div>
  );
}
