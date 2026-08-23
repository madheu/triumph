import { useEffect, useState } from 'react';
import { getToken, getStoredUser } from '../lib/api';

interface UserRow {
  id: string;
  email: string;
  verified: boolean;
  plan: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: number | null;
  createdAt: number | null;
}

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resetMsg, setResetMsg] = useState<{ email: string; link: string } | null>(null);
  const me = getStoredUser();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d?.error?.message || '加载失败');
      setUsers(d.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const genResetLink = async (email: string) => {
    setError('');
    setResetMsg(null);
    try {
      const res = await fetch('/api/admin/users/password-reset-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d?.error?.message || '生成失败');
      setResetMsg({ email, link: d.reset_link });
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    }
  };

  const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">用户管理</h1>
          <p className="text-sm text-neutral-500">共 {users.length} 个账号 · 密码重置 / 订阅状态一览</p>
        </div>
        <button onClick={load} className="text-sm text-brand-dark hover:underline">刷新</button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      {resetMsg && (
        <div className="mb-4 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <div className="font-medium text-green-700 mb-1">重置链接已生成（30 分钟有效）：{resetMsg.email}</div>
          <input readOnly value={resetMsg.link} onFocus={e => e.target.select()} className="w-full text-xs bg-white border border-green-200 rounded px-2 py-1" />
          <div className="text-[11px] text-green-600 mt-1">复制发给用户；或你自己打开链接代设新密码。用后即焚，不可复用。</div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-neutral-400 py-10 text-center">加载中…</div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">验证</th>
                <th className="px-4 py-3">权益</th>
                <th className="px-4 py-3">注册时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800">{u.email}</div>
                    {u.email === me?.email && <span className="text-[10px] text-brand-dark">（你）</span>}
                  </td>
                  <td className="px-4 py-3">
                    {u.verified
                      ? <span className="text-xs text-green-600">✓ 已验证</span>
                      : <span className="text-xs text-amber-600">未验证</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.plan === 'pro' ? 'bg-brand/20 text-brand-dark' : 'bg-neutral-100 text-neutral-500'}`}>
                      {u.plan === 'pro' ? 'Pro' : 'Free'}
                    </span>
                    {u.subscriptionStatus && (
                      <span className="text-[11px] text-neutral-400 ml-1">{u.subscriptionStatus}</span>
                    )}
                    {u.currentPeriodEnd && (
                      <div className="text-[11px] text-neutral-400">到期 {fmtTime(u.currentPeriodEnd)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(u.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => genResetLink(u.email)}
                      className="text-xs text-brand-dark hover:underline"
                    >
                      重置密码
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
