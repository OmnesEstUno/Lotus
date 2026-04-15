import { useState, useCallback } from 'react';
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
import { Category, TimeRange } from '../../types';
import { CATEGORY_COLORS } from '../../utils/categories';
import { buildLineChartData, formatCurrency, getMaxValue, TRENDING_CATEGORIES } from '../../utils/dataProcessing';
import { Transaction } from '../../types';

interface Props {
  transactions: Transaction[];
  timeRange: TimeRange;
}

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  week: 'Past Week',
  month: 'Past Month',
  '3month': 'Past 3 Months',
  year: 'Past 12 Months',
  all: 'All Time',
};

function CustomTooltip({ active, payload, label, highlighted }: TooltipProps<number, string> & { highlighted: Category | null }) {
  if (!active || !payload || payload.length === 0) return null;

  const filtered = highlighted ? payload.filter((e) => e.name === highlighted) : payload;
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

export default function CategoryLineChart({ transactions, timeRange }: Props) {
  const allCategories = TRENDING_CATEGORIES as readonly Category[];
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(new Set(allCategories));
  const [hoveredLine, setHoveredLine] = useState<Category | null>(null);
  const [selectedLine, setSelectedLine] = useState<Category | null>(null);

  // effective highlight: selection wins, otherwise hover
  const highlighted = selectedLine ?? hoveredLine;

  const data = buildLineChartData(transactions, timeRange);
  const maxValue = getMaxValue(data, activeCategories);

  const toggle = useCallback((cat: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        if (next.size === 1) return prev;
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const selectCategory = useCallback((cat: Category) => {
    setSelectedLine((curr) => (curr === cat ? null : cat));
  }, []);

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
      {/* Legend with checkboxes (and selection indicator) */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 16px',
          marginBottom: 12,
          alignItems: 'center',
        }}
      >
        {visibleCategories.map((cat) => {
          const isActive = activeCategories.has(cat);
          const isSelected = selectedLine === cat;
          return (
            <button
              key={cat}
              onClick={(e) => {
                // Shift-click (or Ctrl/Cmd click) toggles visibility.
                // Plain click selects/deselects the line.
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  toggle(cat);
                } else {
                  if (!isActive) toggle(cat);
                  selectCategory(cat);
                }
              }}
              onMouseEnter={() => setHoveredLine(cat)}
              onMouseLeave={() => setHoveredLine(null)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                border: `1px solid ${isSelected ? CATEGORY_COLORS[cat] : isActive ? CATEGORY_COLORS[cat] + '60' : 'var(--border)'}`,
                background: isSelected ? CATEGORY_COLORS[cat] + '30' : isActive ? CATEGORY_COLORS[cat] + '18' : 'transparent',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: isActive ? CATEGORY_COLORS[cat] : 'var(--text-muted)',
                transition: 'all 0.15s',
                opacity: highlighted && highlighted !== cat ? 0.4 : 1,
              }}
              title={isActive ? 'Click to isolate, shift-click to hide' : 'Click to show'}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isActive ? CATEGORY_COLORS[cat] : 'var(--border)',
                  flexShrink: 0,
                }}
              />
              {cat}
              {isActive ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
            </button>
          );
        })}
        {selectedLine && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => setSelectedLine(null)}
          >
            Clear selection
          </button>
        )}
      </div>
      <p className="text-xs text-muted" style={{ marginBottom: 16 }}>
        Tip: Click a legend chip or a data point to isolate that category. Shift-click to toggle visibility.
      </p>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
          onClick={(e: unknown) => {
            // Click on empty chart area clears selection
            const ev = e as { activePayload?: unknown } | null;
            if (!ev || !ev.activePayload) setSelectedLine(null);
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
          <Tooltip content={<CustomTooltip highlighted={highlighted} />} />
          {allCategories.map((cat) => {
            if (!activeCategories.has(cat)) return null;
            const isHighlighted = highlighted === cat;
            const hasAnyHighlight = highlighted !== null;
            return (
              <Line
                key={cat}
                type="monotone"
                dataKey={cat}
                stroke={CATEGORY_COLORS[cat]}
                strokeWidth={isHighlighted ? 3 : 1.5}
                dot={false}
                activeDot={{
                  r: 5,
                  strokeWidth: 2,
                  stroke: CATEGORY_COLORS[cat],
                  fill: 'var(--bg-card)',
                  style: { cursor: 'pointer' },
                  onMouseEnter: () => setHoveredLine(cat),
                  onMouseLeave: () => setHoveredLine(null),
                  onClick: (e: { stopPropagation?: () => void }) => {
                    e?.stopPropagation?.();
                    selectCategory(cat);
                  },
                }}
                opacity={hasAnyHighlight && !isHighlighted ? 0.15 : 1}
                onMouseEnter={() => setHoveredLine(cat)}
                onMouseLeave={() => setHoveredLine(null)}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export { TIME_RANGE_LABELS };
export type { Props as CategoryLineChartProps };
