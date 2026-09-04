import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet, ApiError, getToken } from '../lib/api';

interface UserDetail {
  id: string;
  email: string;
  verified: boolean;
  authProvider: string;
  googleLinked: boolean;
  googleName: string | null;
  plan: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: number | null;
  creemCustomerId: string | null;
  createdAt: number | null;
}

interface SubRow {
  id: string;
  creem_subscription_id: string | null;
  status: string | null;
  plan: string | null;
  current_period_end: number | null;
  created_at: number | null;
  canceled_at: number | null;
}

interface OrderRow {
  id: string;
  creem_order_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  type: string | null;
  status: string | null;
  created_at: number | null;
}

interface Attempts {
  attempted: number | null;
  correct: number | null;
  active_days: number | null;
  first_date: string | null;
  last_date: string | null;
}

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');
const fmtMoney = (cents: number | null, currency: string | null) =>
  cents == null ? '—' : `$${(cents / 100).toFixed(2)}${currency ? ' ' + currency.toUpperCase() : ''}`;

const SUB_STATUS_CN: Record<string, string> = {
  active: '生效中', past_due: '逾期', canceled: '已取消', expired: '已过期', admin_granted: '管理员授予',
};

export default function UserDetail() {
  const [params] = useSearchParams();
  const email = params.get('email') || '';
  const [user, setUser] = useState<UserDetail | null>(null);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [attempts, setAttempts] = useState<Attempts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!email) { setError('缺少 email 参数'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const d = await apiGet<{ user: UserDetail; subscriptions: SubRow[]; orders: OrderRow[]; attempts: Attempts | null }>(
        '/api/admin/users/detail?email=' + encodeURIComponent(email));
      setUser(d.user);
      setSubs(d.subscriptions || []);
      setOrders(d.orders || []);
      setAttempts(d.attempts || null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  const setPlan = async (plan: 'pro' | 'free') => {
    if (!user) return;
    const verb = plan === 'pro' ? '授予 Pro（无到期，长期有效）' : '降为 Free（收回 Pro 权益）';
    if (!window.confirm(`确认对 ${user.email} ${verb}？`)) return;
    setActing(true); setActionMsg('');
    try {
      const res = await fetch('/api/admin/users/set-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ email: user.email, plan }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d?.error?.message || '操作失败');
      setActionMsg(plan === 'pro' ? '已授予 Pro。' : '已降为 Free。');
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : '操作失败');
    } finally { setActing(false); }
  };

  const accuracy = attempts && attempts.attempted ? Math.round((attempts.correct || 0) / attempts.attempted * 100) : null;

  return (
    <div>
      <div className="mb-6">
        <Link to="/users" className="text-xs text-neutral-400 hover:text-brand-dark">← 返回用户列表</Link>
        <h1 className="text-xl font-semibold text-neutral-800 mt-1 break-all">{email || '用户详情'}</h1>
        <p className="text-sm text-neutral-500">资料 / 权益 / 订阅订单 / 做题统计</p>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      {actionMsg && <div className="mb-4 text-sm bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2">{actionMsg}</div>}

      {loading ? (
        <div className="text-sm text-neutral-400 py-10 text-center">加载中…</div>
      ) : user && (
        <>
          {/* 资料 */}
          <div className="bg-white rounded-xl border border-neutral-200 p-5 mb-6">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
              <div><div className="text-xs text-neutral-400">注册时间</div><div className="text-neutral-800 mt-0.5">{fmtTime(user.createdAt)}</div></div>
              <div><div className="text-xs text-neutral-400">验证</div><div className="mt-0.5">{user.verified ? <span className="text-green-600">✓ 已验证</span> : <span className="text-amber-600">未验证</span>}</div></div>
              <div><div className="text-xs text-neutral-400">登录方式</div><div className="mt-0.5 text-neutral-800">
                {user.authProvider === 'google' ? 'Google' : '邮箱'}{user.googleLinked && user.authProvider !== 'google' ? '（已绑 Google）' : ''}
                {user.googleName ? <span className="text-neutral-400"> · {user.googleName}</span> : null}
              </div></div>
              <div><div className="text-xs text-neutral-400">当前权益</div><div className="mt-0.5">
                <span className={`text-xs px-2 py-0.5 rounded-full ${user.plan === 'pro' ? 'bg-brand/20 text-brand-dark' : 'bg-neutral-100 text-neutral-500'}`}>
                  {user.plan === 'pro' ? 'Pro' : 'Free'}
                </span>
              </div></div>
              <div><div className="text-xs text-neutral-400">订阅状态</div><div className="text-neutral-800 mt-0.5">{SUB_STATUS_CN[user.subscriptionStatus || ''] || user.subscriptionStatus || '—'}</div></div>
              <div><div className="text-xs text-neutral-400">Creem Customer</div><div className="text-neutral-800 mt-0.5 font-mono text-xs break-all">{user.creemCustomerId || '—'}</div></div>
            </div>
          </div>

          {/* 权益操作 */}
          <div className="bg-white rounded-xl border border-neutral-200 p-5 mb-6">
            <h2 className="text-sm font-medium text-neutral-600 mb-3">权益操作（写审计日志）</h2>
            {user.plan === 'pro' ? (
              <button disabled={acting} onClick={() => setPlan('free')}
                className="text-sm px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
                降为 Free
              </button>
            ) : (
              <button disabled={acting} onClick={() => setPlan('pro')}
                className="text-sm px-4 py-2 rounded-lg bg-brand text-white hover:bg-brand-dark disabled:opacity-50">
                手动授予 Pro
              </button>
            )}
            <div className="text-[11px] text-neutral-400 mt-2">
              手动授予的 Pro 无到期时间；用户之后走 Creem 正常付费/取消时，以 webhook 为准覆盖。
            </div>
          </div>

          {/* 做题统计 */}
          <div className="bg-white rounded-xl border border-neutral-200 p-5 mb-6">
            <h2 className="text-sm font-medium text-neutral-600 mb-3">做题统计（D1 attempts_daily）</h2>
            {attempts && attempts.attempted ? (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                <div><div className="text-xs text-neutral-400">总做题</div><div className="text-neutral-800 mt-0.5 text-lg font-semibold">{attempts.attempted}</div></div>
                <div><div className="text-xs text-neutral-400">正确率</div><div className={`mt-0.5 text-lg font-semibold ${accuracy !== null && accuracy >= 70 ? 'text-green-700' : accuracy !== null && accuracy < 50 ? 'text-red-600' : 'text-neutral-800'}`}>{accuracy}%</div></div>
                <div><div className="text-xs text-neutral-400">活跃天数</div><div className="text-neutral-800 mt-0.5 text-lg font-semibold">{attempts.active_days}</div></div>
                <div><div className="text-xs text-neutral-400">首次</div><div className="text-neutral-800 mt-0.5 text-xs">{attempts.first_date || '—'}</div></div>
                <div><div className="text-xs text-neutral-400">最近</div><div className="text-neutral-800 mt-0.5 text-xs">{attempts.last_date || '—'}</div></div>
              </div>
            ) : (
              <div className="text-sm text-neutral-400">该用户还没有做题上报数据。</div>
            )}
          </div>

          {/* 订阅历史 */}
          <h2 className="text-sm font-medium text-neutral-600 mb-2">订阅历史（{subs.length}）</h2>
          {!subs.length ? (
            <div className="bg-white rounded-xl border border-neutral-200 py-6 text-center text-sm text-neutral-400 mb-6">无订阅记录。</div>
          ) : (
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                    <th className="px-4 py-3">状态</th><th className="px-4 py-3">权益</th><th className="px-4 py-3">到期</th><th className="px-4 py-3">创建</th><th className="px-4 py-3">订阅 ID</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map(s => (
                    <tr key={s.id} className="border-b border-neutral-50">
                      <td className="px-4 py-3 text-xs">{SUB_STATUS_CN[s.status || ''] || s.status || '—'}</td>
                      <td className="px-4 py-3 text-xs">{s.plan || '—'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(s.current_period_end)}</td>
                      <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(s.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-neutral-400">{s.creem_subscription_id || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 订单历史 */}
          <h2 className="text-sm font-medium text-neutral-600 mb-2">订单历史（{orders.length}）</h2>
          {!orders.length ? (
            <div className="bg-white rounded-xl border border-neutral-200 py-6 text-center text-sm text-neutral-400">无订单记录。</div>
          ) : (
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                    <th className="px-4 py-3">时间</th><th className="px-4 py-3">金额</th><th className="px-4 py-3">类型</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">订单号</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="border-b border-neutral-50">
                      <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(o.created_at)}</td>
                      <td className="px-4 py-3 text-neutral-800">{fmtMoney(o.amount_cents, o.currency)}</td>
                      <td className="px-4 py-3 text-xs">{o.type === 'refund' ? '退款' : '支付'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-500">{o.status || '—'}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-neutral-400">{o.creem_order_id || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
