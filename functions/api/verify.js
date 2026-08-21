// POST /api/verify — 提交验证码，激活账号
import { json, signJwt, timingSafeEqual, USER_KEY, STATE_KEY, CODE_KEY } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return json({ error: 'not_registered' }, 404);
  const rec = JSON.parse(recJson);
  if (rec.verified) return json({ error: 'already_verified' }, 400);

  const storedJson = await env.TRIUMPH_KV.get(CODE_KEY(email));
  if (!storedJson) return json({ error: 'code_expired' }, 400);
  const stored = JSON.parse(storedJson);
  if (!timingSafeEqual(stored.code, code)) return json({ error: 'wrong_code' }, 400);
  if (stored.exp < Date.now()) return json({ error: 'code_expired' }, 400);

  rec.verified = true;
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify(rec));
  await env.TRIUMPH_KV.put(STATE_KEY(rec.id), JSON.stringify({ createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {} }));
  await env.TRIUMPH_KV.delete(CODE_KEY(email));

  const jwt = await signJwt({ sub: rec.id, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);
  return json({ token: jwt, user: { id: rec.id, email }, verified: true });
}
