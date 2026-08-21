// POST /api/register — 注册：创建账号 + 发验证码（两阶段）
// 流程: register -> 返回 need_verify -> verify(输码) -> 激活
// 如果配置了邮件通道，注册后需要验证；否则直接激活（降级）
import { json, hashPassword, signJwt, genCode, sendVerificationEmail, USER_KEY, STATE_KEY, CODE_KEY } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return json({ error: 'password_too_short' }, 400);

  const existing = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (existing) return json({ error: 'email_taken' }, 409);

  // 哈希密码
  const { saltHex, hashHex } = await hashPassword(password);
  const userId = crypto.randomUUID();
  // 存入未激活账号
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify({ id: userId, email, saltHex, hashHex, verified: false, createdAt: Date.now() }));

  // 尝试发验证码邮件
  const hasMail = !!(env.RESEND_API_KEY || (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN));
  if (hasMail) {
    const code = genCode();
    await env.TRIUMPH_KV.put(CODE_KEY(email), JSON.stringify({ code, exp: Date.now() + 15 * 60000, email }), { expirationTtl: 900 });
    try {
      await sendVerificationEmail(env, email, code);
      return json({ need_verify: true, message: 'Verification email sent. Check your inbox.' });
    } catch (e) {
      // 邮件失败：回滚账号，返回可读错误
      await env.TRIUMPH_KV.delete(USER_KEY(email));
      return json({ error: 'mail_failed', detail: String(e.message || e) }, 500);
    }
  }

  // 无邮件通道：降级为直接激活（开发模式），登录时给提示
  const rec = JSON.parse(await env.TRIUMPH_KV.get(USER_KEY(email)));
  rec.verified = true;
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify(rec));
  await env.TRIUMPH_KV.put(STATE_KEY(userId), JSON.stringify({ createdAt: Date.now(), answers: [], mastery: {}, plan: null, srs: {}, tasks: {} }));
  const jwt = await signJwt({ sub: userId, email, iat: Date.now(), exp: Date.now() + 30 * 86400000 }, env.JWT_SECRET);
  return json({ token: jwt, user: { id: userId, email }, verified: true });
}
