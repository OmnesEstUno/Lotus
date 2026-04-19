import { useEffect, useState } from 'react';
import { Transaction } from '../../types';
import { getTransactions, updateTransaction } from '../../api/client';
import { formatCurrency } from '../../utils/dataProcessing';
import { getCategoryColor } from '../../utils/categories';

export default function ArchivedCard() {
  const [archived, setArchived] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const all = await getTransactions();
      setArchived(all.filter((t) => t.archived));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleUnarchive(id: string) {
    setBusy(true);
    setError('');
    try {
      await updateTransaction(id, { archived: false });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2>Archived Transactions</h2>
      <p className="text-muted text-sm" style={{ marginTop: -4, marginBottom: 12 }}>
        Hidden from charts and aggregates but still counted in your total.
      </p>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      {archived.length === 0 ? (
        <p className="text-muted text-sm">No archived transactions.</p>
      ) : (
        <div className="preview-scroll" style={{ maxHeight: 360 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {archived.sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => (
                <tr key={t.id}>
                  <td className="text-sm font-mono" style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                  <td>{t.description}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: getCategoryColor(t.category), flexShrink: 0 }} />
                      {t.category}
                    </span>
                  </td>
                  <td className="num text-danger">{formatCurrency(Math.abs(t.amount))}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleUnarchive(t.id)}
                      disabled={busy}
                      title="Unarchive"
                      style={{ padding: '4px 8px' }}
                    >
                      Unarchive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
