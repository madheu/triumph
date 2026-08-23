import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { adminLogout, getStoredUser } from '../lib/api';

const nav = [
  { to: '/', label: '概览', end: true },
  { to: '/users', label: '用户管理' },
  { to: '/orders', label: '订单与订阅' },
  { to: '/tickets', label: '工单' },
  { to: '/content', label: '内容管理' },
  { to: '/analytics', label: '行为分析' },
];

export default function Layout() {
  const navigate = useNavigate();
  const user = getStoredUser();

  return (
    <div className="min-h-screen flex">
      {/* 侧边栏 */}
      <aside className="w-52 shrink-0 bg-white border-r border-neutral-200 flex flex-col">
        <div className="px-5 py-5 border-b border-neutral-100">
          <div className="text-lg font-serif text-brand-dark">Triumph.</div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-400 mt-0.5">Admin</div>
        </div>
        <nav className="flex-1 py-3">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-5 py-2 text-sm ${
                  isActive ? 'text-brand-dark font-medium bg-brand/5 border-r-2 border-brand-dark' : 'text-neutral-600 hover:bg-neutral-50'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-neutral-100">
          <div className="text-xs text-neutral-500 truncate">{user?.email}</div>
          <button
            onClick={() => { adminLogout(); navigate('/login'); }}
            className="mt-1 text-xs text-neutral-400 hover:text-red-500 transition-colors"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
