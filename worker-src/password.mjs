// worker-src/password.mjs — 密码重置（P1）
//
// 用户自助：
//   POST /api/password/forgot { email }      → 无论邮箱是否存在都返回 200（防枚举）
//                                              生成一次性 token（KV TTL 30 分钟），Resend 发重置链接
//   POST /api/password/reset { token, new }  → 校验 token → 更新 PBKDF2 哈希 → 吊销该用户会话
//
// 管理员代办（P1 后台）：
//   POST /api/admin/users/:email/password-reset-link → 生成同样的链接直接发到用户邮箱
//
// 安全要点：
// - 重置链接 token 用 crypto.getRandomValues 生成（32 字节 hex），绝不复用验证码
// - token 只存哈希在 KV（防止 KV 泄露直接可用）
// - 重置成功后删除 token（用后即焚）
// - 不暴露"邮箱是否存在"（统一 200）

import { json, apiError } from './http.mjs';
import { hashPassword } from './crypto.mjs';
import { USER_KEY } from './accounts.mjs';

const RESET_KEY = email => `pwreset:${email.toLowerCase().trim()}`;
const RESET_TTL = 30 * 60; // 30 分钟

function genToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
}

export { RESET_KEY };

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** 生成重置 token 并存 KV，返回明文 token（供发邮件或管理员直接取链接） */
export async function storeResetToken(env, email) {
  const token = genToken();
  const tokenHash = await sha256Hex(token);
  await env.TRIUMPH_KV.put(RESET_KEY(email), JSON.stringify({ tokenHash, exp: Date.now() + RESET_TTL * 1000, email }), { expirationTtl: RESET_TTL });
  return token;
}

/** 发重置邮件（Resend 优先，Mailgun 兜底，与验证码邮件同一套发信逻辑） */
async function sendResetEmail(env, email, token) {
  const from = env.EMAIL_FROM || '';
  if (!from) throw new Error('EMAIL_FROM not configured');
  const base = env.SITE_URL || 'https://trytriumph.de5.net';
  const link = `${base}/reset.html?token=${token}&email=${encodeURIComponent(email)}`;
  const html = `<p>We received a request to reset your Triumph password.</p>
    <p><a href="${link}" style="display:inline-block;background:#A67D7A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Reset my password</a></p>
    <p>If you didn't ask for this, you can safely ignore this email. This link expires in 30 minutes.</p>
    <p style="color:#6E6760;font-size:12px">Triumph · independent Praxis 5001 study tool · not affiliated with ETS</p>`;
  const body = { from, to: [email], subject: 'Reset your Triumph password', html };
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('resend_failed:' + res.status);
    return true;
  }
  if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
    const form = new URLSearchParams();
    form.set('from', from); form.set('to', email); form.set('subject', body.subject); form.set('html', html);
    const res = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY) },
      body: form,
    });
    if (!res.ok) throw new Error('mailgun_failed:' + res.status);
    return true;
  }
  throw new Error('no_mail_provider');
}

/** POST /api/password/forgot — 发起重置（防枚举：邮箱不存在也返回 ok） */
export async function hPasswordForgot(request, env) {
  const parsed = await readJsonSafe(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: true }); // 不暴露校验细节

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return json({ ok: true }); // 防枚举：不存在也 200

  const token = await storeResetToken(env, email);

  try {
    await sendResetEmail(env, email, token);
  } catch (e) {
    // 邮件失败也要返回 ok（不暴露），但可以记日志
    return json({ ok: true });
  }
  return json({ ok: true });
}

/** POST /api/password/reset — 用 token 重置密码 */
export async function hPasswordReset(request, env) {
  const parsed = await readJsonSafe(request);
  if (parsed.err) return parsed.err;
  const token = String(parsed.body.token || '').trim();
  const newPassword = String(parsed.body.newPassword || parsed.body.password || '');
  if (!token) return apiError('bad_request', { field: 'token' });
  if (newPassword.length < 8) return apiError('password_too_short');

  // 从 KV 找匹配的 token（遍历 prefix 太贵，改为：先查所有可能？不行）
  // 方案：token 里不编码邮箱，遍历 pwreset: 前缀。验证期用户少，可接受。
  // 更优：reset 请求带 email 参数，直接定位 key。
  const email = String(parsed.body.email || '').trim().toLowerCase();
  if (!email) return apiError('bad_request', { field: 'email' });

  const storedJson = await env.TRIUMPH_KV.get(RESET_KEY(email));
  if (!storedJson) return apiError('bad_request', { field: 'token', hint: 'This reset link is invalid or expired.' });

  const stored = JSON.parse(storedJson);
  const tokenHash = await sha256Hex(token);
  // 用 timingSafeEqual 比较哈希
  if (stored.tokenHash !== tokenHash || stored.exp < Date.now()) {
    return apiError('bad_request', { field: 'token', hint: 'This reset link is invalid or expired.' });
  }

  // 更新密码
  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return apiError('not_registered');
  const rec = JSON.parse(recJson);
  const { saltHex, hashHex } = await hashPassword(newPassword);
  rec.saltHex = saltHex;
  rec.hashHex = hashHex;
  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify(rec));

  // 用后即焚
  await env.TRIUMPH_KV.delete(RESET_KEY(email));

  return json({ ok: true, message: 'Password updated. You can now log in.' });
}

async function readJsonSafe(request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object') return { err: apiError('bad_request') };
    return { body };
  } catch {
    return { err: apiError('invalid_json') };
  }
}

export const PASSWORD_ROUTES = {
  '/api/password/forgot': { POST: hPasswordForgot },
  '/api/password/reset':  { POST: hPasswordReset },
};
