// worker-src/db.mjs — 共享 D1 工具层（P2 抽取，billing/admin/cms 共用）
//
// 设计原则与 P1 相同：
//   - D1 绑定缺失或执行失败时返回 null 并打 console.error，绝不抛出阻断主流程
//     （后台读接口会显式检查 null 返回并给前端友好错误；写审计失败不影响业务写入）

/** 执行一条 SQL（带可选参数绑定）。D1 未绑定/出错 → null */
export async function d1Exec(env, sql, params = []) {
  if (!env.TRIUMPH_D1) return null;
  try {
    const stmt = env.TRIUMPH_D1.prepare(sql);
    const res = await (params.length ? stmt.bind(...params) : stmt).run();
    return res;
  } catch (e) {
    console.error('d1 error:', String(e && e.message || e));
    return null;
  }
}

/** 查询多行（D1 未绑定/出错 → null；成功返回 rows 数组） */
export async function d1All(env, sql, params = []) {
  if (!env.TRIUMPH_D1) return null;
  try {
    const stmt = env.TRIUMPH_D1.prepare(sql);
    const res = await (params.length ? stmt.bind(...params) : stmt).all();
    return (res && Array.isArray(res.results)) ? res.results : [];
  } catch (e) {
    console.error('d1 all error:', String(e && e.message || e));
    return null;
  }
}

/** 查单行（没有/出错 → null） */
export async function d1One(env, sql, params = []) {
  const rows = await d1All(env, sql, params);
  return rows && rows.length ? rows[0] : null;
}

/**
 * 后台操作审计日志（admin_audit_log）。失败静默（审计不阻断业务）。
 * action 例：question.update, content.create, user.reset_password
 */
export async function audit(env, actor, action, targetType, targetId, detail) {
  await d1Exec(env,
    `INSERT OR IGNORE INTO admin_audit_log (id, actor, action, target_type, target_id, detail_json, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), actor || 'unknown', action, targetType || null, targetId || null,
     detail ? JSON.stringify(detail).slice(0, 2000) : null, Date.now()]);
}
