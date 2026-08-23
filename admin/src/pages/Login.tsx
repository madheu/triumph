import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin } from '../lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await adminLogin(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-serif tracking-tight text-brand-dark">Triumph.</div>
          <div className="text-xs uppercase tracking-widest text-neutral-400 mt-1">Admin Console</div>
        </div>
        <form onSubmit={submit} className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">密码</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-dark text-white text-sm font-medium py-2.5 hover:bg-brand disabled:opacity-50 transition-colors"
          >
            {busy ? '登录中…' : '登录后台'}
          </button>
        </form>
        <p className="text-center text-xs text-neutral-400 mt-6">
          仅限管理员访问 · 操作均记录审计日志
        </p>
      </div>
    </div>
  );
}
