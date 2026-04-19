import { TimeRange } from '../../types';
import { TIME_RANGE_LABELS } from '../charts/CategoryLineChart';

interface Props {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
}

export default function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className="tabs">
      {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((r) => (
        <button
          key={r}
          className={`tab ${value === r ? 'active' : ''}`}
          onClick={() => onChange(r)}
        >
          {TIME_RANGE_LABELS[r]}
        </button>
      ))}
    </div>
  );
}
