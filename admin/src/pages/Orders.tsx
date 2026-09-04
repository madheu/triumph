import { useCallback, useEffect, useState } from 'react';
import { apiGet, ApiError } from '../lib/api';

interface OrderRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  creem_order_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  type: string | null;       // payment | refund
  status: string | null;
  created_at: number | null;
}

interface SubRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  creem_subscription_id: string | null;
  status: string | null;     // active | past_due | canceled | expired
  plan: string | null;
  current_period_end: number | null;
  created_at: number | null;
  canceled_at: number | null;
}

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');
const fmtMoney = (cents: number | null, currency: string | null) =>
  cents == null ? '—' : `$${(cents / 100).toFixed(2)}${currency ? ' ' + currency.toUpperCase() : ''}`;

const SUB_STATUS_CN: Record<string, string> = {
  active: '生效中', past_due: '逾期', canceled: '已取消', expired: '已过期',
};

export default function Orders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const q = typeFilter ? '?type=' + typeFilter : '';
      const [o, s] = await Promise.all([
        apiGet<{ items: OrderRow[] }>('/api/admin/orders' + q),
        apiGet<{ items: SubRow[] }>('/api/admin/subscriptions'),
      ]);
      setOrders(o.items || []);
      setSubs(s.items || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">订单与订阅</h1>
          <p className="text-sm text-neutral-500">Creem 支付与订阅生命周期（D1 权威数据）· 退款走工单</p>
        </div>
        <div className="flex gap-3 items-center">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white">
            <option value="">全部类型</option>
            <option value="payment">支付</option>
            <option value="refund">退款</option>
          </select>
          <button onClick={load} className="text-sm text-brand-dark hover:underline">刷新</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {/* 订阅 */}
      <h2 className="text-sm font-medium text-neutral-600 mb-2">订阅（{subs.length}）</h2>
      {loading ? (
        <div className="text-sm text-neutral-400 py-8 text-center">加载中…</div>
      ) : !subs.length ? (
        <div className="bg-white rounded-xl border border-neutral-200 py-8 text-center text-sm text-neutral-400 mb-8">
          还没有订阅记录。用户完成 Creem 结账后，webhook 会把订阅写进这里。
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">权益</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">当前到期</th>
                <th className="px-4 py-3">订阅 ID</th>
                <th className="px-4 py-3">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                  <td className="px-4 py-3 text-neutral-800">{s.user_email || <span className="text-neutral-300 font-mono text-xs">{s.user_id || '—'}</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.plan === 'pro' ? 'bg-brand/20 text-brand-dark' : 'bg-neutral-100 text-neutral-500'}`}>
                      {s.plan === 'pro' ? 'Pro' : (s.plan || '—')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={s.status === 'active' ? 'text-green-600' : s.status === 'past_due' ? 'text-amber-600' : 'text-neutral-500'}>
                      {SUB_STATUS_CN[s.status || ''] || s.status || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(s.current_period_end)}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-neutral-400">{s.creem_subscription_id || '—'}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 订单 */}
      <h2 className="text-sm font-medium text-neutral-600 mb-2">订单（{orders.length}）</h2>
      {loading ? null : !orders.length ? (
        <div className="bg-white rounded-xl border border-neutral-200 py-8 text-center text-sm text-neutral-400">
          还没有订单记录。
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">金额</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">Creem 订单号</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                  <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(o.created_at)}</td>
                  <td className="px-4 py-3 text-neutral-800">{o.user_email || <span className="text-neutral-300 font-mono text-xs">{o.user_id || '—'}</span>}</td>
                  <td className="px-4 py-3 font-medium text-neutral-800">{fmtMoney(o.amount_cents, o.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${o.type === 'refund' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                      {o.type === 'refund' ? '退款' : '支付'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{o.status || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-neutral-400">{o.creem_order_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
