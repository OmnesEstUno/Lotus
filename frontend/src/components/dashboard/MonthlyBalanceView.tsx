import { formatCurrency } from '../../utils/dataProcessing';

interface MonthlyBalanceViewProps {
  monthlyBalance: Array<{
    month: string;
    monthIndex: number;
    income: number;
    expenses: number;
    surplus: number;
  }>;
  onMonthClick: (monthIndex: number) => void;
}

function MonthlyBalanceView({ monthlyBalance, onMonthClick }: MonthlyBalanceViewProps) {
  return (
    <>
      {/* Numeric table — rows are clickable */}
      <div className="table-wrapper" style={{ marginBottom: 24 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Expenses</th>
              <th className="num">Surplus / Deficit</th>
            </tr>
          </thead>
          <tbody>
            {monthlyBalance.map((row) => (
              <tr
                key={row.month}
                onClick={() => onMonthClick(row.monthIndex)}
                style={{ cursor: 'pointer' }}
                title="Click to drill down into this month"
              >
                <td>{row.month}</td>
                <td className="num text-success">{row.income > 0 ? formatCurrency(row.income) : <span className="zero">—</span>}</td>
                <td className="num text-danger">{row.expenses > 0 ? formatCurrency(row.expenses) : <span className="zero">—</span>}</td>
                <td className={`num ${row.surplus >= 0 ? 'text-success' : 'text-danger'}`}>
                  {(row.income > 0 || row.expenses > 0) ? formatCurrency(row.surplus) : <span className="zero">—</span>}
                </td>
              </tr>
            ))}
            {/* YTD totals */}
            <tr style={{ background: 'var(--bg-elevated)', fontWeight: 600 }}>
              <td>YTD Total</td>
              <td className="num text-success">
                {formatCurrency(monthlyBalance.reduce((s, r) => s + r.income, 0))}
              </td>
              <td className="num text-danger">
                {formatCurrency(monthlyBalance.reduce((s, r) => s + r.expenses, 0))}
              </td>
              <td className={`num ${monthlyBalance.reduce((s, r) => s + r.surplus, 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                {formatCurrency(monthlyBalance.reduce((s, r) => s + r.surplus, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

export default MonthlyBalanceView;
