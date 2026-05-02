import { TimeRange } from '../../types';

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  week: 'Past Week',
  month: 'Past Month',
  '3month': 'Past 3 Months',
  year: 'Past 1 Year',
  custom: 'Custom Range',
};

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => onChange(e.target.value as TimeRange)}
      aria-label="Time range"
      style={{ paddingLeft: 15 }}
    >
      {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((r) => (
        <option key={r} value={r}>{TIME_RANGE_LABELS[r]}</option>
      ))}
    </select>
  );
}
