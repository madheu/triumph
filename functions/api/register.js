// POST /api/register — 注册：直接创建账号并激活（当前不要求邮箱验证码）
import { json, hashPassword, signJwt, USER_KEY, STATE_KEY } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return json({ error: 'password_too_short' }, 400);

  const existing = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (existing) return json({ error: 'email_taken' }, 409);

  // 哈希密码 + 直接激活账号
  const { saltHex, hashHex } = await hashPassword(password);
  const userId = crypto.randomUUID();
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify({
    id: userId, email, saltHex, hashHex, verified: true, createdAt: Date.now(),
  }));
  await env.TRIUMPH_KV.put(STATE_KEY(userId), JSON.stringify({
    createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {},
  }));

  const jwt = await signJwt({ sub: userId, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);
  return json({ token: jwt, user: { id: userId, email }, verified: true });
}
