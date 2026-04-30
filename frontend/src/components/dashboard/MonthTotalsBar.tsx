import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '../../utils/dataProcessing/shared';
import { formatAxisCurrency } from './constants';

interface Props { income: number; expenses: number; }

export default function MonthTotalsBar({ income, expenses }: Props) {
  const data = [{ label: 'Totals', Income: income, Expenses: expenses }];
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8125rem' }}
          formatter={(v: number, name: string) => [formatCurrency(v), name]}
        />
        <Bar dataKey="Income" fill="#4ade80" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Expenses" fill="#f87171" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
