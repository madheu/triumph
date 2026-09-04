// worker-src/account-delete.mjs — self-service account deletion.
//
// Why this exists: 老户只有一个邮箱，每次验证注册流程都要能回到"未注册"状态重来。
// 没有删除入口的话，测试一次就把邮箱占死了。
//
// 顺带解决一件迟早要面对的事：美国站面向真实用户，GDPR / CCPA 都要求提供
// 账号删除路径。与其以后单独做，不如这次用一个端点同时满足两件事。
//
// 门禁模型（比 admin 严格，比匿名宽）：
//   · 必须持有有效 JWT（Bearer）。不接受邮箱明文 —— 否则任何人都能删别人账号。
//   · 只能删 token 里那个 email 对应的账号。无法越权删他人。
//   · 二次确认：body 必须带 { confirm: "<email>" }，防误点。
//
// 删除范围（KV）：
//   users:<email>        账号记录
//   state:<sub>          学习状态 / 测试成绩 / 计划
//   verify:<email>       未过期的邮箱验证码
//   magicpending:<email> 未完成的 magic 注册流程
//
// 删除范围（D1）：
//   product_events 中 user_id 命中 sub 或 email 的行。
//   测试号的数据本来就是噪音，真删比匿名化干净 —— 留着半匿名行反而让漏斗多一层歧义。
//
// 不清理的部分（记录在案，不是遗漏）：
//   apikey:<sha256> —— KV 只存哈希，无法从 email 反推。主站用户默认不持有 API key，
//   真要清理时按 key 归属逐个查，代价不值得。
//   feedback:* —— 用户主动提交的反馈，带邮箱但与账号体系解耦，属内容而非账号数据。

import { json, apiError, readJsonBody } from './http.mjs';
import { bearerToken, verifyJwt } from './crypto.mjs';
import { USER_KEY, STATE_KEY, CODE_KEY } from './accounts.mjs';
import { MAGIC_PENDING_KEY } from './magic.mjs';

export async function hAccountDelete(request, env) {
  const payload = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!payload || !payload.email) return apiError('unauthorized');

  const email = String(payload.email).toLowerCase().trim();
  const sub = payload.sub ? String(payload.sub) : null;

  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const confirm = String((parsed.body && parsed.body.confirm) || '').toLowerCase().trim();
  if (confirm !== email) {
    return apiError('bad_request', {
      field: 'confirm',
      hint: 'type your account email exactly to confirm deletion',
    });
  }

  if (!env.TRIUMPH_KV) return apiError('not_configured', { hint: 'KV binding missing' });

  // KV 键清单。state 用 sub 索引；没有 sub 的老记录无法定位，跳过即可 ——
  // 那种记录本来就不存在 state（从未保存过任何东西）。
  const keys = [USER_KEY(email), CODE_KEY(email), MAGIC_PENDING_KEY(email)];
  if (sub) keys.push(STATE_KEY(sub));

  const removed = [];
  await Promise.all(
    keys.map(async k => {
      try {
        await env.TRIUMPH_KV.delete(k);
        removed.push(k);
      } catch (e) {
        /* 单个键失败不阻断其余清理 */
      }
    }),
  );

  // D1：清掉归属该账号的事件行
  let eventsDeleted = 0;
  if (env.TRIUMPH_D1) {
    try {
      const ids = [sub, email].filter(Boolean);
      for (const id of ids) {
        const r = await env.TRIUMPH_D1
          .prepare('DELETE FROM product_events WHERE user_id = ?')
          .bind(id)
          .run();
        // D1 的 run() 结果在不同版本返回 meta.changes 或 changes，两种都接住
        const changes = r && r.meta && typeof r.meta.changes === 'number'
          ? r.meta.changes
          : (r && typeof r.changes === 'number' ? r.changes : 0);
        eventsDeleted += changes;
      }
    } catch (e) {
      /* events 表可能不存在（未执行 DDL）；账号已删，不因此报错 */
    }
  }

  return json({
    ok: true,
    email,
    kv_removed: removed.length,
    events_deleted: eventsDeleted,
    note: 'Account deleted. You can register again with the same email.',
  });
}

export const ACCOUNT_DELETE_ROUTES = {
  '/api/account/delete': { POST: hAccountDelete },
};
