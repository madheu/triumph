// POST /api/resend — 重新发送验证码
import { json, genCode, sendVerificationEmail, USER_KEY, CODE_KEY } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return json({ error: 'not_registered' }, 404);
  const rec = JSON.parse(recJson);
  if (rec.verified) return json({ error: 'already_verified' }, 400);

  const code = genCode();
  await env.TRIUMPH_KV.put(CODE_KEY(email), JSON.stringify({ code, exp: Date.now() + 15 * 60000, email }), { expirationTtl: 900 });
  try {
    await sendVerificationEmail(env, email, code);
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'mail_failed', message: 'Failed to resend verification email.' }, 502);
  }
}
