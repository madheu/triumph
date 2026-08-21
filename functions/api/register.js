// POST /api/register — 注册：创建未激活账号 + 发验证码邮件（两阶段验证）
// 流程: register -> need_verify -> verify(输码) -> 激活
import { json, hashPassword, genCode, sendVerificationEmail, USER_KEY, CODE_KEY } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return json({ error: 'password_too_short' }, 400);

  let userId;
  const existingJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (existingJson) {
    const existing = JSON.parse(existingJson);
    if (existing.verified) return json({ error: 'email_taken' }, 409);
    userId = existing.id; // 未验证账号重注册：复用 id，更新密码
  } else {
    userId = crypto.randomUUID();
  }

  // 哈希密码 + 存未激活账号
  const { saltHex, hashHex } = await hashPassword(password);
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify({
    id: userId, email, saltHex, hashHex, verified: false, createdAt: Date.now(),
  }));

  // 生成并保存验证码
  const code = genCode();
  await env.TRIUMPH_KV.put(CODE_KEY(email), JSON.stringify({ code, exp: Date.now() + 15 * 60000, email }), { expirationTtl: 900 });

  try {
    await sendVerificationEmail(env, email, code);
    return json({ need_verify: true, message: 'Verification email sent.' });
  } catch (e) {
    // 邮件失败：保留账号 + 验证码，前端引导「重发验证码」，不再回滚
    return json({ error: 'mail_failed', message: 'Failed to send verification email.' }, 502);
  }
}
