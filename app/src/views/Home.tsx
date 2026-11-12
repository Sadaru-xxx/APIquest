import type { FieldId } from '../types';
import { bank, hasQuestions, topicsOf } from '../data';
import { dueReviews, fieldSummary, topicStatus, useProgress } from '../store';
import { Bar } from '../components/Bits';

type Props = {
  onPractice: (f: FieldId) => void;
  onField: (f: FieldId) => void;
  onReview: () => void;
  onMock: () => void;
};

export default function Home({ onPractice, onField, onReview, onMock }: Props) {
  const p = useProgress();
  const available = bank.fields.filter((f) => hasQuestions(f.id));
  const resume = (p.lastField && hasQuestions(p.lastField) ? p.lastField : available[0]?.id) as FieldId | undefined;
  const resumeField = bank.fields.find((f) => f.id === resume);
  const due = dueReviews(p).length;
  const allTopics = bank.topics.filter((t) => hasQuestions(t.fieldId));
  const masteredAll = allTopics.filter((t) => topicStatus(p, t.id) === 'mastered').length;
  const answered = p.attempts.length;
  const correct = p.attempts.filter((a) => a[2] === 1).length;
  const allCleared = bank.fields.every((f) => fieldSummary(p, f.id).cleared);

  return (
    <div className="view">
      {resumeField && (
        <section className="hero">
          <p className="eyebrow">分野{resumeField.no}</p>
          <h1>{resumeField.name}</h1>
          <p className="muted">
            習得 {fieldSummary(p, resumeField.id).mastered}/{topicsOf(resumeField.id).length} トピック
          </p>
          <div className="actions">
            <button type="button" className="btn primary big" onClick={() => onPractice(resumeField.id)}>
              {fieldSummary(p, resumeField.id).touched ? '演習を続ける' : '演習を始める'}
            </button>
            <button type="button" className="btn" onClick={() => onField(resumeField.id)}>
              トピックの習熟度
            </button>
          </div>
        </section>
      )}

      <section className="tiles" aria-label="学習の状況">
        <button type="button" className={`tile ${due ? 'attn' : ''}`} onClick={onReview}>
          <span className="tile-num">{due}</span>
          <span className="tile-label">今日の復習</span>
        </button>
        <div className="tile">
          <span className="tile-num">
            {masteredAll}
            <small>/{allTopics.length}</small>
          </span>
          <span className="tile-label">習得トピック</span>
        </div>
        <div className="tile">
          <span className="tile-num">{answered ? Math.round((correct / answered) * 100) : 0}%</span>
          <span className="tile-label">正答率({answered}回)</span>
        </div>
      </section>

      <section>
        <h2 className="section-title">6つの分野</h2>
        <ul className="fields">
          {bank.fields.map((f) => {
            const s = fieldSummary(p, f.id);
            const ready = hasQuestions(f.id);
            const state = !ready ? '問題準備中' : s.cleared ? 'クリア' : s.touched ? '演習中' : '未学習';
            return (
              <li key={f.id} className={`field ${ready ? '' : 'off'} ${s.cleared ? 'cleared' : ''}`}>
                <div className="field-main">
                  <span className="field-no">{f.no}</span>
                  <div>
                    <strong>{f.name}</strong>
                    {ready ? (
                      <div className="field-meta">
                        <Bar value={s.mastered} max={s.total} label={`${f.name}の習得トピック`} />
                        <span className="muted small">
                          習得 {s.mastered}/{s.total}
                        </span>
                      </div>
                    ) : (
                      <p className="muted small">この分野の問題は現在作成中です</p>
                    )}
                  </div>
                </div>
                <div className="field-side">
                  <span className={`state ${s.cleared ? 'good' : ''}`}>{state}</span>
                  {ready && (
                    <div className="field-btns">
                      <button type="button" className="btn small primary" onClick={() => onPractice(f.id)}>
                        演習
                      </button>
                      <button type="button" className="btn small" onClick={() => onField(f.id)}>
                        詳細
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={`mock-cta ${allCleared ? 'ready' : ''}`}>
        <div>
          <h2>{allCleared ? '6分野すべてクリア。模擬試験で仕上げましょう' : '模擬試験'}</h2>
          <p className="muted">
            {allCleared
              ? '本試験と同じ60問・90分・合格ライン65%で、分野ごとの弱点を確認できます。'
              : '6分野をクリアしたら、60問・90分の模擬試験で総仕上げをします。今は問題がそろっている分野だけで受けられます。'}
          </p>
        </div>
        <button type="button" className={`btn ${allCleared ? 'primary' : ''}`} onClick={onMock}>
          模擬試験へ
        </button>
      </section>
    </div>
  );
}
