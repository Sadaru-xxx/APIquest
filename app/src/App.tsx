import { useEffect, useState } from 'react';
import type { FieldId } from './types';
import { questionById, SIDE_LABEL } from './data';
import { dueReviews, setLastField, useProgress, useSaveStatus } from './store';
import Home from './views/Home';
import FieldView from './views/FieldView';
import Practice from './views/Practice';
import Review from './views/Review';
import Mock from './views/Mock';
import Search from './views/Search';
import Settings from './views/Settings';
import QuestionPlayer from './components/QuestionPlayer';

type Tab = 'home' | 'review' | 'mock' | 'search';
type View =
  | { name: Tab }
  | { name: 'field'; fieldId: FieldId }
  | { name: 'practice'; fieldId: FieldId; topicIds?: string[]; key: number }
  | { name: 'question'; id: string; from: View }
  | { name: 'settings'; from: View };

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'ホーム' },
  { id: 'review', label: '復習' },
  { id: 'mock', label: '模擬試験' },
  { id: 'search', label: '問題一覧' },
];
const tabFromHash = (): Tab => {
  const h = location.hash.replace('#', '');
  return (TABS.some((t) => t.id === h) ? h : 'home') as Tab;
};

export default function App() {
  const [view, setView] = useState<View>(() => ({ name: tabFromHash() }));
  const p = useProgress();
  const status = useSaveStatus();
  const due = dueReviews(p).length;

  useEffect(() => {
    const onHash = () => setView({ name: tabFromHash() });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view.name, view.name === 'practice' ? view.key : 0, view.name === 'question' ? view.id : '']);

  const go = (v: View) => {
    if (TABS.some((t) => t.id === v.name)) {
      try {
        history.replaceState(null, '', `#${v.name}`);
      } catch {
        /* 一部の表示環境ではアドレスを書き換えられない */
      }
    }
    setView(v);
  };
  const practice = (fieldId: FieldId, topicIds?: string[]) => {
    setLastField(fieldId);
    go({ name: 'practice', fieldId, topicIds, key: Date.now() });
  };
  const openQuestion = (id: string) => go({ name: 'question', id, from: view });
  const activeTab: Tab | null = TABS.some((t) => t.id === view.name) ? (view.name as Tab) : view.name === 'field' || view.name === 'practice' ? 'home' : null;
  const inExam = view.name === 'mock' && !!p.mockInProgress;

  let body;
  switch (view.name) {
    case 'home':
      body = <Home onPractice={practice} onField={(fieldId) => go({ name: 'field', fieldId })} onReview={() => go({ name: 'review' })} onMock={() => go({ name: 'mock' })} />;
      break;
    case 'field':
      body = <FieldView fieldId={view.fieldId} onBack={() => go({ name: 'home' })} onPractice={practice} />;
      break;
    case 'practice':
      body = <Practice key={view.key} fieldId={view.fieldId} topicIds={view.topicIds} onExit={() => go({ name: 'home' })} onOpenField={(fieldId) => go({ name: 'field', fieldId })} />;
      break;
    case 'review':
      body = <Review onOpenQuestion={openQuestion} />;
      break;
    case 'mock':
      body = <Mock onPractice={practice} />;
      break;
    case 'search':
      body = <Search onOpen={openQuestion} />;
      break;
    case 'question': {
      const q = questionById.get(view.id);
      body = (
        <div className="view">
          <button type="button" className="back" onClick={() => go(view.from)}>
            ← 戻る
          </button>
          {q && <QuestionPlayer key={q.id} q={q} mode="p" badge={q.side !== 'a' ? SIDE_LABEL[q.side] : undefined} />}
        </div>
      );
      break;
    }
    case 'settings':
      body = <Settings onBack={() => go(view.from)} />;
      break;
  }

  return (
    <div className={`app ${inExam ? 'in-exam' : ''}`}>
      <header className="topbar">
        <div className="topbar-in">
          <button type="button" className="brand" onClick={() => go({ name: 'home' })} disabled={inExam}>
            <span className="brand-mark">SE17</span>
            <span className="brand-name">Java Silver 演習</span>
          </button>
          <nav className="tabs" aria-label="メインメニュー">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={activeTab === t.id ? 'on' : ''} aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => go({ name: t.id })} disabled={inExam && t.id !== 'mock'}>
                {t.label}
                {t.id === 'review' && due > 0 && <span className="badge">{due}</span>}
              </button>
            ))}
          </nav>
          <button type="button" className={`save s-${status}`} onClick={() => go({ name: 'settings', from: view })} disabled={inExam} title="保存先と設定">
            <span className="dot" />
            <span className="save-text">{status === 'cloud' ? 'クラウド保存' : status === 'loading' ? '確認中' : status === 'error' ? '保存エラー' : 'この端末に保存'}</span>
          </button>
        </div>
      </header>
      <main className="main">{body}</main>
    </div>
  );
}
