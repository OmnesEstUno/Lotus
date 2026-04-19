import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import { Category, CustomDateRange, TimeRange } from '../../types';
import { getCategoryColor } from '../../utils/categories';
import { buildLineChartData, formatCurrency, getMaxValue, getTrendingCategories } from '../../utils/dataProcessing';
import { Transaction } from '../../types';
import CheckmarkToggle from '../CheckmarkToggle';
import DateRangePicker from '../DateRangePicker';

interface Props {
  transactions: Transaction[];
  timeRange: TimeRange;
  customRange?: CustomDateRange | null;
  onCustomRangeChange?: (range: CustomDateRange) => void;
}

function CustomTooltip({ active, payload, label, selectedSet }: TooltipProps<number, string> & { selectedSet: Set<Category> }) {
  if (!active || !payload || payload.length === 0) return null;

  const filtered = selectedSet.size > 0
    ? payload.filter((e) => e.name !== undefined && selectedSet.has(e.name as Category))
    : payload;
  const sorted = [...filtered].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 16px',
        fontSize: '0.8125rem',
        maxWidth: 260,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>{label}</div>
      {sorted.map((entry) => (
        <div
          key={entry.name}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 24,
            color: entry.color,
            marginBottom: 4,
          }}
        >
          <span>{entry.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {formatCurrency(entry.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CategoryLineChart({ transactions, timeRange, customRange, onCustomRangeChange }: Props) {
  // Derive the full category list from the current transactions so custom
  // categories appear automatically alongside built-ins.
  const allCategories = useMemo(() => getTrendingCategories(transactions), [transactions]);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(() => new Set(allCategories));
  const [hoveredLine, setHoveredLine] = useState<Category | null>(null);
  // Multi-select isolation: when non-empty, those categories are emphasized and
  // others dim. When empty, falls back to the hoveredLine hover-highlight.
  const [selectedSet, setSelectedSet] = useState<Set<Category>>(new Set());

  // When the set of available categories changes (e.g., after a new upload),
  // re-sync the active set to include everything. User toggles within the
  // same data reset here — they persist while the data is stable.
  useEffect(() => {
    setActiveCategories(new Set(allCategories));
  }, [allCategories]);

  const data = buildLineChartData(transactions, timeRange, customRange);
  const maxValue = getMaxValue(data, activeCategories);

  const toggle = useCallback((cat: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const toggleSelected = useCallback((cat: Category) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  // Emphasis rule: non-empty selection wins; otherwise hover highlights one.
  const isEmphasized = (cat: Category) =>
    selectedSet.size > 0 ? selectedSet.has(cat) : hoveredLine === cat;
  const isFaded = (cat: Category) =>
    selectedSet.size > 0 ? !selectedSet.has(cat) : (hoveredLine !== null && hoveredLine !== cat);

  const visibleCategories = allCategories.filter((c) =>
    data.some((point) => (point[c] as number | undefined) !== undefined && (point[c] as number) > 0),
  );

  if (data.length === 0) {
    return (
      <div
        style={{
          height: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        No expense data for this time period.
      </div>
    );
  }

  return (
    <div>
      {timeRange === 'custom' && onCustomRangeChange && (() => {
        // Bounds: latest = today; earliest = max(10 years ago, oldest non-archived
        // transaction date). If there's no data, fall back to 10 years ago.
        const toISODate = (d: Date) => d.toISOString().slice(0, 10);
        const today = new Date();
        const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
        const activeDates = transactions
          .filter((t) => !t.archived)
          .map((t) => t.date)
          .sort();
        const oldestStr = activeDates[0];
        const tenYearsAgoStr = toISODate(tenYearsAgo);
        const minDate = oldestStr && oldestStr > tenYearsAgoStr ? oldestStr : tenYearsAgoStr;
        const maxDate = toISODate(today);
        return (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <DateRangePicker
              value={customRange ?? null}
              onChange={onCustomRangeChange}
              minDate={minDate}
              maxDate={maxDate}
            />
          </div>
        );
      })()}

      {/* Legend with CheckmarkToggle chips */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 12px',
          marginBottom: 12,
          alignItems: 'center',
        }}
      >
        {visibleCategories.map((cat) => {
          const isActive = activeCategories.has(cat);
          return (
            <div
              key={cat}
              style={{ opacity: isFaded(cat) ? 0.4 : 1, transition: 'opacity 0.15s' }}
            >
              <CheckmarkToggle
                label={cat}
                color={getCategoryColor(cat)}
                active={isActive}
                size="sm"
                onToggle={() => toggle(cat)}
                onHover={() => setHoveredLine(cat)}
                onLeave={() => setHoveredLine(null)}
              />
            </div>
          );
        })}
        <button
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          onClick={() => setActiveCategories(new Set(visibleCategories))}
        >
          Select All
        </button>
        <button
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          onClick={() => setActiveCategories(new Set())}
        >
          Deselect All
        </button>
        {selectedSet.size > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => setSelectedSet(new Set())}
          >
            Clear selection
          </button>
        )}
      </div>

      {activeCategories.size === 0 ? (
        <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          No categories selected. Use the legend to pick some.
        </div>
      ) : (
        <>
          <p className="text-xs text-muted" style={{ marginBottom: 16 }}>
            Tip: Click a chip to show/hide a category. Click a data point to isolate it; click more points to compare.
          </p>

          <ResponsiveContainer width="100%" height={400}>
            <LineChart
          data={data}
          margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
          onClick={(e: unknown) => {
            // Click on empty chart area clears selection
            const ev = e as { activePayload?: unknown } | null;
            if (!ev || !ev.activePayload) setSelectedSet(new Set());
          }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            label={{ value: 'Time Period', position: 'insideBottom', offset: -4, fill: 'var(--text-muted)', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
            domain={[0, Math.ceil((maxValue * 1.1) / 50) * 50 || 100]}
            label={{
              value: 'Amount ($)',
              angle: -90,
              position: 'insideLeft',
              offset: 12,
              fill: 'var(--text-muted)',
              fontSize: 11,
            }}
          />
          <Tooltip content={<CustomTooltip selectedSet={selectedSet} />} />
          {allCategories.map((cat) => {
            if (!activeCategories.has(cat)) return null;
            const emphasized = isEmphasized(cat);
            const faded = isFaded(cat);
            return (
              <Line
                key={cat}
                type="monotone"
                dataKey={cat}
                stroke={getCategoryColor(cat)}
                strokeWidth={emphasized ? 3 : 1.5}
                dot={data.length <= 1 ? {
                  r: 4,
                  strokeWidth: 2,
                  stroke: getCategoryColor(cat),
                  fill: 'var(--bg-card)',
                } : false}
                activeDot={{
                  r: 5,
                  strokeWidth: 2,
                  stroke: getCategoryColor(cat),
                  fill: 'var(--bg-card)',
                  style: { cursor: 'pointer' },
                  onMouseEnter: () => setHoveredLine(cat),
                  onMouseLeave: () => setHoveredLine(null),
                  onClick: (e: { stopPropagation?: () => void }) => {
                    e?.stopPropagation?.();
                    toggleSelected(cat);
                  },
                }}
                opacity={faded ? 0.15 : 1}
                onMouseEnter={() => setHoveredLine(cat)}
                onMouseLeave={() => setHoveredLine(null)}
              />
            );
          })}
        </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

export type { Props as CategoryLineChartProps };
