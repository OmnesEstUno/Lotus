import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { formatCurrency } from '../../utils/dataProcessing/shared';
import { formatAxisCurrency } from './constants';

interface Props {
  monthlyBalance: Array<{ month: string; surplus: number; monthIndex: number }>;
}

export default function NetBalanceView({ monthlyBalance }: Props) {
  const manyBars = monthlyBalance.length > 12;
  const minWidth = manyBars ? Math.max(monthlyBalance.length * 48, 600) : undefined;

  return (
    <div className="net-balance-chart">
      <div
        className={`net-balance-scroll${manyBars ? ' net-balance-scroll--scrollable' : ''}`}
      >
        <div style={minWidth ? { minWidth } : undefined}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyBalance} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <ReferenceLine y={0} stroke="var(--text-muted)" strokeWidth={1} />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8125rem' }}
                cursor={false}
                formatter={(v: number) => [formatCurrency(v), v >= 0 ? 'Surplus' : 'Deficit']}
              />
              <Bar dataKey="surplus" radius={[3, 3, 0, 0]} fillOpacity={0.5} activeBar={{ fillOpacity: 1 }}>
                {monthlyBalance.map((entry, i) => (
                  <Cell key={i} fill={entry.surplus >= 0 ? '#4ade80' : '#f87171'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
