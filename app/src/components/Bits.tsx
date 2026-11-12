import { MASTER_STREAK, type TopicStatus } from '../store';

const STATUS_LABEL: Record<TopicStatus, string> = { untouched: '未学習', learning: '演習中', mastered: '習得' };

export function StatusChip({ status }: { status: TopicStatus }) {
  return <span className={`status s-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function StreakDots({ streak, mastered }: { streak: number; mastered: boolean }) {
  const n = mastered ? MASTER_STREAK : Math.min(streak, MASTER_STREAK);
  return (
    <span className="dots" role="img" aria-label={mastered ? '習得済み' : `連続正解 ${n}/${MASTER_STREAK}`}>
      {Array.from({ length: MASTER_STREAK }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

export function fmtDate(t: number) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
