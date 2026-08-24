import { useCallback, useEffect, useState } from 'react';
import { apiGet, ApiError } from '../lib/api';

interface DailyRow {
  date: string;
  attempted: number;
  correct: number;
  active_users: number;
  accuracy: number | null;
}

interface Summary {
  users_total: number;
  users_pro: number;
  tickets_open: number | null;
  attempts_today: number | null;
}

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, d] = await Promise.all([
        apiGet<Summary>('/api/admin/stats/summary'),
        apiGet<{ items: DailyRow[] }>('/api/admin/stats/daily?days=' + days),
      ]);
      setSummary(s);
      setDaily(d.items || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // 简单条形图：正确率（0-100%）按日
  const maxAttempted = Math.max(1, ...daily.map(r => r.attempted));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">行为分析</h1>
          <p className="text-sm text-neutral-500">做题量与正确率日报（D1 精确统计）· 总览</p>
        </div>
        <div className="flex gap-3 items-center">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white">
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
          <button onClick={load} className="text-sm text-brand-dark hover:underline">刷新</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {/* 总览卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: '注册用户', value: summary ? summary.users_total : '…', sub: 'KV 权威' },
          { label: 'Pro 用户', value: summary ? summary.users_pro : '…', sub: summary && summary.users_total ? Math.round(summary.users_pro / summary.users_total * 100) + '%' : '' },
          { label: '今日做题', value: summary ? (summary.attempts_today ?? '—') : '…', sub: 'attempts_daily' },
          { label: '未解决工单', value: summary ? (summary.tickets_open ?? '—') : '…', sub: '含 pending' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-neutral-200 px-5 py-4">
            <div className="text-xs text-neutral-400">{c.label}</div>
            <div className="text-2xl font-semibold text-neutral-800 mt-1">{c.value}</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 日报表 */}
      {loading ? (
        <div className="text-sm text-neutral-400 py-10 text-center">加载中…</div>
      ) : !daily.length ? (
        <div className="bg-white rounded-xl border border-neutral-200 py-14 text-center text-neutral-400 text-sm">
          还没有做题数据。用户在练习页答题并上报后，这里会出现每日正确率趋势。
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3">日期</th>
                <th className="px-4 py-3 w-40">做题量</th>
                <th className="px-4 py-3 w-24">正确率</th>
                <th className="px-4 py-3 w-28">活跃用户</th>
              </tr>
            </thead>
            <tbody>
              {daily.map(r => (
                <tr key={r.date} className="border-b border-neutral-50">
                  <td className="px-4 py-3 font-mono text-xs">{r.date}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden min-w-[80px]">
                        <div className="h-full bg-brand rounded-full" style={{ width: Math.round(r.attempted / maxAttempted * 100) + '%' }} />
                      </div>
                      <span className="text-xs text-neutral-600 w-10 text-right">{r.attempted}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={r.accuracy !== null && r.accuracy >= 70 ? 'text-green-700 font-medium' : r.accuracy !== null && r.accuracy < 50 ? 'text-red-600 font-medium' : 'text-neutral-700'}>
                      {r.accuracy !== null ? r.accuracy + '%' : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{r.active_users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
