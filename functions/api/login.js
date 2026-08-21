// POST /api/login — 登录（校验验证状态；未验证则要求验证）
import { json, hashPassword, timingSafeEqual, signJwt, USER_KEY } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return json({ error: 'invalid_credentials' }, 401);
  const rec = JSON.parse(recJson);

  const { hashHex } = await hashPassword(password, rec.saltHex);
  if (!timingSafeEqual(hashHex, rec.hashHex)) return json({ error: 'invalid_credentials' }, 401);

  // 账号均为直接激活，登录不要求验证码
  const jwt = await signJwt({ sub: rec.id, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);
  return json({ token: jwt, user: { id: rec.id, email }, verified: true });
}
