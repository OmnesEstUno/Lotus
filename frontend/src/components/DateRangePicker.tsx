import { useEffect, useState } from 'react';
import DatePicker from 'react-datepicker';
import { format, parseISO } from 'date-fns';
import { CustomDateRange } from '../types';
import { MONTH_NAMES_SHORT } from '../utils/dateConstants';

interface DateRangePickerProps {
  value: CustomDateRange | null;
  onChange: (range: CustomDateRange) => void;
  minDate?: string; // yyyy-mm-dd
  maxDate?: string; // yyyy-mm-dd
}

const toISO = (d: Date) => format(d, 'yyyy-MM-dd');
const fromISO = (s: string | null | undefined) => (s ? parseISO(s) : null);

// Renders a custom header for react-datepicker that limits the month and
// year <select> dropdowns to only values inside [min, max]. Without this
// the dropdowns would show all 12 months and a wide-open year range even
// when those picks fall outside the selectable window.
interface CustomHeaderProps {
  date: Date;
  changeYear: (year: number) => void;
  changeMonth: (month: number) => void;
  decreaseMonth: () => void;
  increaseMonth: () => void;
  prevMonthButtonDisabled: boolean;
  nextMonthButtonDisabled: boolean;
  min: Date | null;
  max: Date | null;
}

function CustomHeader({
  date, changeYear, changeMonth, decreaseMonth, increaseMonth,
  prevMonthButtonDisabled, nextMonthButtonDisabled, min, max,
}: CustomHeaderProps) {
  const viewedYear = date.getFullYear();
  const viewedMonth = date.getMonth();

  const minYear = min ? min.getFullYear() : viewedYear - 10;
  const maxYear = max ? max.getFullYear() : viewedYear + 10;
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  // Months available depend on how the viewed year compares to the window edges.
  const firstMonthAllowed =
    min && viewedYear === min.getFullYear() ? min.getMonth() : 0;
  const lastMonthAllowed =
    max && viewedYear === max.getFullYear() ? max.getMonth() : 11;
  const months: number[] = [];
  for (let m = firstMonthAllowed; m <= lastMonthAllowed; m++) months.push(m);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
      <button
        type="button"
        className="react-datepicker__navigation react-datepicker__navigation--previous"
        onClick={decreaseMonth}
        disabled={prevMonthButtonDisabled}
        aria-label="Previous month"
        style={{ position: 'static' }}
      >
        <span className="react-datepicker__navigation-icon react-datepicker__navigation-icon--previous" />
      </button>
      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <select
          className="react-datepicker__month-select"
          value={viewedMonth}
          onChange={(e) => changeMonth(Number(e.target.value))}
        >
          {months.map((m) => (
            <option key={m} value={m}>{MONTH_NAMES_SHORT[m]}</option>
          ))}
        </select>
        <select
          className="react-datepicker__year-select"
          value={viewedYear}
          onChange={(e) => changeYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="react-datepicker__navigation react-datepicker__navigation--next"
        onClick={increaseMonth}
        disabled={nextMonthButtonDisabled}
        aria-label="Next month"
        style={{ position: 'static' }}
      >
        <span className="react-datepicker__navigation-icon react-datepicker__navigation-icon--next" />
      </button>
    </div>
  );
}

// react-datepicker with month + year dropdowns in the header.
// Clicking either dropdown opens a list; selecting a value updates the
// day grid and auto-returns to the day-selection view.
export default function DateRangePicker({ value, onChange, minDate, maxDate }: DateRangePickerProps) {
  const [start, setStart] = useState<string>(value?.start ?? '');
  const [end, setEnd] = useState<string>(value?.end ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    setStart(value?.start ?? '');
    setEnd(value?.end ?? '');
  }, [value?.start, value?.end]);

  function apply() {
    if (!start || !end) { setError('Both dates required.'); return; }
    if (parseISO(start) > parseISO(end)) { setError('Start must be before end.'); return; }
    if (minDate && start < minDate) { setError('Start is before the earliest data.'); return; }
    if (maxDate && end > maxDate) { setError('End cannot be in the future.'); return; }
    setError('');
    onChange({ start, end });
  }

  const min = fromISO(minDate);
  const max = fromISO(maxDate);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <DatePicker
        selected={fromISO(start)}
        onChange={(d: Date | null) => setStart(d ? toISO(d) : '')}
        minDate={min ?? undefined}
        maxDate={max ?? undefined}
        dateFormat="yyyy-MM-dd"
        placeholderText="Start date"
        className="input"
        wrapperClassName="date-range-wrapper"
        renderCustomHeader={(props) => <CustomHeader {...props} min={min} max={max} />}
      />
      <span style={{ color: 'var(--text-muted)' }}>→</span>
      <DatePicker
        selected={fromISO(end)}
        onChange={(d: Date | null) => setEnd(d ? toISO(d) : '')}
        minDate={min ?? undefined}
        maxDate={max ?? undefined}
        dateFormat="yyyy-MM-dd"
        placeholderText="End date"
        className="input"
        wrapperClassName="date-range-wrapper"
        renderCustomHeader={(props) => <CustomHeader {...props} min={min} max={max} />}
      />
      <button type="button" className="btn btn-sm btn-primary" onClick={apply}>Apply</button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
