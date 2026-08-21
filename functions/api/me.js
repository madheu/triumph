// GET /api/me — 当前用户
import { json, verifyJwt } from './_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token ? await verifyJwt(token, env.JWT_SECRET) : null;
  if (!user) return json({ error: 'unauthorized' }, 401);
  return json({ user: { id: user.sub, email: user.email } });
}
