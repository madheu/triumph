// worker-src/account-password.mjs — 改密码 / 首次设置密码。
//
// 为什么一个端点要兼顾两件事：
// 站点从 2026-09 起走 magic link 优先，绝大多数账号是 /api/magic 建出来的，
// KV 里根本没有 hashHex（login 时靠 magicOnly 标记把人赶回魔法链接）。
// 对这批账号来说"修改密码"其实是"第一次设密码" —— 如果把它俩拆成两个端点，
// 前端就得先探一次账号有没有密码再决定调哪个，多一次往返不说，
// 还等于把"这个账号有没有设密码"这种信息暴露给任意调用方。
//
// 所以：一个端点，按记录里有没有 hashHex 自动分叉。
//   · 有 hashHex  -> 改密码，必须带 current_password 且校验通过
//   · 无 hashHex  -> 设密码，不需要旧密码（本来就没有）
//
// 门禁：只认 Bearer JWT，只作用于 token 里的那个 email，无法越权改别人。
//
// 已知缺口（记录在案，不是遗漏）：
// 改密后旧 JWT 不会立刻失效。JWT 是 30 天有效期的无状态令牌，
// 本项目没有 token 版本号机制，verifyJwt 只验签名不查 KV，
// 所以一个人在 A 设备改了密码，B 设备上已经签发的 token 仍可用到自然过期。
// 要补就得给账号记录加 pwdEpoch、在每个鉴权点比对 KV，改动面涉及全部鉴权入口，
// 这次没做。当前站点 passwordless 为主、密码是次要路径，风险可接受；
// 真要收紧时按这条注释来改，不要另起炉灶。

import { json, apiError, readJsonBody } from './http.mjs';
import { bearerToken, verifyJwt, hashPassword, timingSafeEqual } from './crypto.mjs';
import { USER_KEY } from './accounts.mjs';

const MIN_LEN = 8;

export async function hAccountPassword(request, env) {
  const payload = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!payload || !payload.email) return apiError('unauthorized');

  const email = String(payload.email).toLowerCase().trim();

  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;

  const current = String((parsed.body && parsed.body.current_password) || '');
  const nextPw = String((parsed.body && parsed.body.new_password) || '');

  if (nextPw.length < MIN_LEN) {
    return apiError('password_too_short', { min: MIN_LEN });
  }
  // 新密码和旧密码一样就没必要走一遍哈希
  if (current && current === nextPw) {
    return apiError('same_password');
  }

  if (!env.TRIUMPH_KV) return apiError('not_configured', { hint: 'KV binding missing' });

  const recJson = await env.TRIUMPH_KV.get(USER_KEY(email));
  if (!recJson) return apiError('not_registered');
  const rec = JSON.parse(recJson);

  const hasPassword = !!rec.hashHex;
  let mode = 'set';

  if (hasPassword) {
    // 已有密码：必须拿旧密码来换，防止别人拿一个偷来的短期 token 直接改密锁死账号
    if (!current) {
      return apiError('current_password_required', {
        hint: 'this account has a password; send current_password to change it',
      });
    }
    const { hashHex } = await hashPassword(current, rec.saltHex);
    if (!timingSafeEqual(hashHex, rec.hashHex)) {
      return apiError('invalid_credentials', { field: 'current_password' });
    }
    mode = 'changed';
  }

  const { saltHex, hashHex } = await hashPassword(nextPw);
  rec.saltHex = saltHex;
  rec.hashHex = hashHex;
  // 设了密码就不再是无密码账号 —— 否则 login 会继续把人往魔法链接那边赶，
  // 明明刚设完密码却登不进去。
  delete rec.magicOnly;
  rec.passwordChangedAt = Date.now();

  await env.TRIUMPH_KV.put(USER_KEY(email), JSON.stringify(rec));

  return json({ ok: true, mode, email });
}

export const ACCOUNT_PASSWORD_ROUTES = {
  '/api/account/password': { POST: hAccountPassword },
};
