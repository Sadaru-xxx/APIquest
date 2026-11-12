import type { FieldId } from '../types';
import { fieldById, questionsOfTopic, topicsOf } from '../data';
import { fieldSummary, MASTER_STREAK, topicStatus, useProgress } from '../store';
import { Bar, StatusChip, StreakDots } from '../components/Bits';

type Props = { fieldId: FieldId; onBack: () => void; onPractice: (f: FieldId, topicIds?: string[]) => void };

export default function FieldView({ fieldId, onBack, onPractice }: Props) {
  const p = useProgress();
  const field = fieldById.get(fieldId)!;
  const topics = topicsOf(fieldId);
  const s = fieldSummary(p, fieldId);

  return (
    <div className="view">
      <button type="button" className="back" onClick={onBack}>
        ← ホーム
      </button>
      <p className="eyebrow">分野{field.no}</p>
      <h1>{field.name}</h1>
      {s.cleared && <p className="banner good">この分野はクリアしました。間違えた問題は復習で再出題されます。</p>}
      <div className="field-progress">
        <Bar value={s.mastered} max={s.total} label="習得トピック" />
        <span className="muted small">
          習得 {s.mastered}/{s.total} トピック ・ 各トピック{MASTER_STREAK}問連続正解で習得
        </span>
      </div>
      <div className="actions">
        <button type="button" className="btn primary big" onClick={() => onPractice(fieldId)}>
          {s.cleared ? 'もう一度ひと通り演習する' : '未習得のトピックを演習する'}
        </button>
      </div>
      <h2 className="section-title">トピック</h2>
      <ul className="topic-list">
        {topics.map((t) => {
          const st = p.topics[t.id];
          const status = topicStatus(p, t.id);
          const n = questionsOfTopic(t.id).length;
          return (
            <li key={t.id} className="topic-row">
              <div className="topic-info">
                <strong>{t.name}</strong>
                <div className="topic-meta">
                  <StreakDots streak={st?.streak ?? 0} mastered={status === 'mastered'} />
                  <span className="muted small">
                    {n}問 ・ 正解 {st?.ok ?? 0}/{st?.n ?? 0}回
                  </span>
                </div>
              </div>
              <div className="topic-side">
                <StatusChip status={status} />
                <button type="button" className="btn small" onClick={() => onPractice(fieldId, [t.id])}>
                  このトピックだけ
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
