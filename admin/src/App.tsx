import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Questions from './pages/Questions';
import Content from './pages/Content';
import Analytics from './pages/Analytics';
import Orders from './pages/Orders';
import Tickets from './pages/Tickets';
import Layout from './components/Layout';
import { adminMe, getStoredUser, adminLogout } from './lib/api';

function RequireAdmin({ children }: { children: JSX.Element }) {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // 本地没有 token → 直接去登录页
      if (!getStoredUser()) {
        adminLogout();
        navigate('/login', { replace: true });
        return;
      }
      // 有 token → 服务端确认管理员身份（唯一可信来源）
      const me = await adminMe();
      setState(me.admin ? 'ok' : 'denied');
      if (!me.admin) {
        adminLogout();
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate]);

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-400">
        正在确认身份…
      </div>
    );
  }
  if (state === 'denied') return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAdmin>
            <Layout />
          </RequireAdmin>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="questions" element={<Questions />} />
        <Route path="content" element={<Content />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="orders" element={<Orders />} />
        <Route path="tickets" element={<Tickets />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
