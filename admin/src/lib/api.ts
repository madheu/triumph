// 后台 API 客户端 —— 复用主站账号体系（/api/login、/api/admin/me）
const TOKEN_KEY = 'triumph_token';
const USER_KEY = 'triumph_admin_user';

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

export interface AdminMe {
  ok: boolean;
  admin: boolean;
  user?: { id: string; email: string };
}

/** 登录：调用主站 /api/login 换取 JWT（任何有效账号都能登录，但未必是管理员） */
export async function adminLogin(email: string, password: string): Promise<AdminUser> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code || 'request_failed';
    throw new Error(code === 'not_verified' ? '账号未验证' : code === 'invalid_credentials' ? '邮箱或密码错误' : '登录失败，请重试');
  }
  const token: string = data.token;
  localStorage.setItem(TOKEN_KEY, token);

  // 服务端校验是否管理员（ADMIN_EMAILS 白名单）
  const me = await adminMe();
  if (!me.admin || !me.user) {
    localStorage.removeItem(TOKEN_KEY);
    throw new Error('该账号不是管理员，无法进入后台');
  }
  const user: AdminUser = { id: me.user.id, email: me.user.email, role: 'admin' };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

/** 服务端确认当前 JWT 是否管理员（唯一可信来源） */
export async function adminMe(): Promise<AdminMe> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api/admin/me', { headers });
  return res.json().catch(() => ({ ok: false, admin: false }));
}

export function adminLogout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AdminUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
