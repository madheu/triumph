import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, ApiError } from '../lib/api';

interface Summary {
  users_total: number;
  users_pro: number;
  tickets_open: number | null;
  attempts_today: number | null;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setSummary(await apiGet<Summary>('/api/admin/stats/summary'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    document.title = '概览 · Learndiag Admin';
    load();
  }, [load]);

  const cards = [
    { label: '注册用户', value: summary ? String(summary.users_total) : '…', sub: 'KV 权威' },
    { label: 'Pro 用户', value: summary ? String(summary.users_pro) : '…', sub: summary && summary.users_total ? `付费率 ${Math.round(summary.users_pro / summary.users_total * 100)}%` : '' },
    { label: '今日做题', value: summary ? String(summary.attempts_today ?? '—') : '…', sub: 'attempts_daily 上报' },
    { label: '未解决工单', value: summary ? String(summary.tickets_open ?? '—') : '…', sub: '含 pending' },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-neutral-800 mb-1">概览</h1>
      <p className="text-sm text-neutral-500 mb-6">Learndiag 后台管理 · 数据总览</p>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-neutral-200 p-5">
            <div className="text-xs text-neutral-400">{s.label}</div>
            <div className="text-2xl font-semibold text-neutral-800 mt-1">{s.value}</div>
            <div className="text-[11px] text-neutral-400 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400 mb-4">
        UV/PV、漏斗、留存 cohort 待 Analytics Engine 埋点接入（P3）——做题正确率日报已可用
      </div>

      <div className="flex gap-4 text-sm">
        <Link to="/analytics" className="text-brand-dark hover:underline">→ 行为分析（做题日报）</Link>
        <Link to="/users" className="text-brand-dark hover:underline">→ 用户管理</Link>
        <Link to="/orders" className="text-brand-dark hover:underline">→ 订单与订阅</Link>
      </div>
    </div>
  );
}
