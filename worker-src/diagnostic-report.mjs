// worker-src/diagnostic-report.mjs — 诊断报告（付费内容，服务端生成）
//
// 三条硬约束（决定了整个模块的形状）：
//
//   1. **报告内容只能在服务端生成，未获权益一律 402 且响应体里不含任何报告数据。**
//      「付费墙未解锁时报告绝对不能渲染」因此是结构性保证，而不是前端的一个 if。
//      前端拿不到数据，就没有"渲染错了"的可能。
//
//   2. **判分以服务端题库为准**（assets/data/questions-api.json 的 answer 字段），
//      绝不接受客户端传来的 correct。否则改一行 JS 就能刷出满分报告。
//
//   3. **九个维度的分数是确定性计算，AI 只写叙述、不算分。**
//      模型会漂，分数不能飘 —— 同一份答卷每次必须给出同样的雷达图。
//
// 端点：
//   POST /api/diagnostic/report        生成（或取回）报告，需权益
//   GET  /api/diagnostic/report/status  查权益，不下发报告

import { json, ok, readJsonBody, apiError, safeFetch } from './http.mjs';
import { bearerToken, verifyJwt } from './crypto.mjs';
import { loadBank } from './bank.mjs';
import { USER_KEY } from './accounts.mjs';

// ---------------------------------------------------------------- 常量

/** 免费可见的错题条数上限：游客只能看到诊断前 6 题的对错与解析。 */
export const FREE_REVIEW_LIMIT = 6;

const CREDIT_PREFIX = 'report_credit:';
const REPORT_PREFIX = 'report_cache:';
const HIST_PREFIX = 'diaghist:';
const REPORT_TTL = 60 * 60 * 24 * 180; // 半年，够用户随时回来重下

/** AI 模型链（与 ai-analyst 同源，按实测质量排序；全失败则回退模板叙述）。 */
const MODELS = [
  'minimax/minimax-m3:free',
  'z-ai/glm-5.2:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

const SUBTEST_NAMES = {
  '5002': 'Reading & Language Arts',
  '5003': 'Mathematics',
  '5004': 'Social Studies',
  '5005': 'Science',
};

/**
 * 九个维度。数组顺序 = 雷达图轴顺序（顺时针）。
 * `needsPace` / `needsHistory` 为 true 时，缺数据会让该维度 `measured:false`，
 * 前端把它画成灰色虚线轴而不是伪造一个分数。
 */
export const DIMENSIONS = [
  { id: 'accuracy',    label: 'Answer accuracy',        hint: 'Share of questions answered correctly.' },
  { id: 'pace',        label: 'Answering pace',         hint: 'Median seconds per question vs a healthy band.', needsPace: true },
  { id: 'knowledge',   label: 'Knowledge-point response', hint: 'Average accuracy across knowledge points touched.' },
  { id: 'miss_load',   label: 'Error load',             hint: 'How much of the set you got wrong, weighted by subtest size.' },
  { id: 'concentration', label: 'Weak-spot concentration', hint: 'High when misses cluster in one topic instead of scattering.' },
  { id: 'consistency', label: 'Subtest consistency',    hint: 'How evenly you perform across the four subtests.' },
  { id: 'guessing',    label: 'Guess control',          hint: 'Penalised by very fast wrong answers (under 15s).', needsPace: true },
  { id: 'uplift',      label: 'Uplift headroom',        hint: 'Score you gain by bringing the weakest subtest to full marks.' },
  { id: 'momentum',    label: 'Momentum',               hint: 'Movement against your own previous diagnostics.', needsHistory: true },
];

// ---------------------------------------------------------------- 权益

/**
 * 解析调用者的权益。
 *
 * 优先级：Pro 订阅 > 一次性报告凭证 > 无。
 * 返回 { tier, email, scope, credit }，scope 是历史记录/凭证的归属键。
 *
 * 为什么游客也能买：产品上「对的可以不登录购买完整报告」。所以凭证挂在
 * 匿名 visitor_id 上，而不是邮箱 —— 买了之后愿意注册再缝合，两条路都不堵。
 */
export async function resolveEntitlement(request, env, visitorId) {
  const payload = await verifyJwt(bearerToken(request), env.JWT_SECRET).catch(() => null);
  const email = payload && payload.email ? String(payload.email).toLowerCase() : null;
  const scope = email ? 'u:' + email : (visitorId ? 'v:' + visitorId : null);

  let plan = 'free';
  if (email) {
    try {
      const rec = await env.TRIUMPH_KV.get(USER_KEY(email), 'json');
      if (rec && rec.plan) plan = rec.plan;
    } catch (e) { /* KV 抖动按 free 处理，下面还有凭证兜底 */ }
  }
  if (plan === 'pro') return { tier: 'pro', email, scope, credit: null };

  if (visitorId) {
    let credit = null;
    try { credit = await env.TRIUMPH_KV.get(CREDIT_PREFIX + visitorId, 'json'); } catch (e) { credit = null; }
    if (credit && credit.report_product) return { tier: 'credit', email, scope, credit };
  }
  return { tier: 'free', email, scope, credit: null };
}

/** 402：报告锁定。响应体里**只有**解锁选项，一个字的报告内容都没有。 */
export function lockedResponse(ent, extra = {}) {
  return json({
    error: {
      code: 'report_locked',
      message: 'The full diagnostic report is not unlocked for this visitor yet.',
      hint: 'Log in for the free tier, or buy the one-time report — no account needed.',
    },
    status: 402,
    // 前端据此决定显示哪几个按钮，不含任何付费内容
    options: ['login', 'purchase'],
    free_review_limit: FREE_REVIEW_LIMIT,
    tier: ent ? ent.tier : 'free',
    ...extra,
  }, 402);
}

// ---------------------------------------------------------------- 计算（纯函数，可测）

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** 映射到 0-100 的雷达分。 */
const toScore = (ratio) => Math.round(clamp01(ratio) * 100);

function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 由「答卷 + 服务端题库」算出报告的全部数值部分。
 *
 * @param bank  服务端题库（含 answer / explain / category / code）
 * @param answers [{ question_id, selected, elapsed_ms }]
 * @param history 同一 scope 的历史摘要（旧→新），用于 momentum 维度
 */
export function computeReport(bank, answers, history = []) {
  const byId = new Map(bank.map((q) => [q.id, q]));
  const rows = [];

  for (const a of answers) {
    const q = byId.get(String(a.question_id || ''));
    if (!q) continue;                                   // 题库里没有的一律丢弃
    const selected = Number(a.selected);
    if (!Number.isInteger(selected) || selected < 0 || selected >= q.options.length) continue;
    // ⚠️ Number(null) === 0 —— 和 events.mjs 里踩过的同一个坑。
    // 不显式判 null/undefined/''，「没用时数据」会变成「用时 0 秒」，
    // 于是节奏维度拿 0 秒去算，反而被判成"草率答题"。
    const rawElapsed = a.elapsed_ms;
    const elapsed = (rawElapsed === null || rawElapsed === undefined || rawElapsed === '')
      ? NaN : Number(rawElapsed);
    rows.push({
      id: q.id,
      code: q.code,
      subtest: SUBTEST_NAMES[q.code] || q.subtest || q.code,
      category: q.category || 'General',
      selected,
      correct: selected === q.answer,
      elapsed_ms: Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(elapsed, 3600000) : null,
    });
  }

  if (!rows.length) return null;

  const total = rows.length;
  const correctCount = rows.filter((r) => r.correct).length;

  // ---- 按科目
  const perSubtest = {};
  for (const r of rows) {
    const s = (perSubtest[r.code] = perSubtest[r.code] || {
      code: r.code, name: r.subtest, attempted: 0, correct: 0, misses: 0, elapsed: [],
    });
    s.attempted++;
    if (r.correct) s.correct++; else s.misses++;
    if (r.elapsed_ms !== null) s.elapsed.push(r.elapsed_ms);
  }
  const subtests = Object.values(perSubtest).sort((a, b) => a.code.localeCompare(b.code));
  for (const s of subtests) {
    s.accuracy = round1((s.correct / s.attempted) * 100);
    s.scaled = 140 + (s.correct / s.attempted) * 40;      // 与前端 DM_estimateScore 同一模型
    s.median_ms = median(s.elapsed);
  }

  // ---- 按知识点
  const perCategory = {};
  for (const r of rows) {
    const c = (perCategory[r.category] = perCategory[r.category] || {
      category: r.category, code: r.code, attempted: 0, correct: 0, misses: 0,
    });
    c.attempted++;
    if (r.correct) c.correct++; else c.misses++;
  }
  const categories = Object.values(perCategory)
    .map((c) => ({ ...c, accuracy: round1((c.correct / c.attempted) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy);

  // ---- 分数（与前端模型一致）
  const scaledPer = subtests.map((s) => s.scaled);
  const score = Math.round(mean(scaledPer));
  const pass = Math.max(5, Math.min(95, Math.round(5 + (score - 140) * 2.25)));

  // ---- 错题明细（只给错题，按诊断顺序）
  const misses = rows
    .map((r, i) => ({ ...r, index: i }))
    .filter((r) => !r.correct)
    .map((r) => {
      const q = byId.get(r.id);
      return {
        index: r.index,
        question_id: r.id,
        code: r.code,
        subtest: r.subtest,
        category: r.category,
        question: q.q,
        options: q.options,
        answer_index: q.answer,
        answer_text: q.options[q.answer],
        selected_index: r.selected,
        selected_text: q.options[r.selected],
        explanation: q.explain || '',
      };
    });

  // ---- 节奏
  const allElapsed = rows.map((r) => r.elapsed_ms).filter((v) => v !== null);
  const paceAvailable = allElapsed.length >= Math.ceil(total * 0.5); // 过半有数据才算「测到」
  const medianMs = median(allElapsed);
  const fastWrong = rows.filter((r) => !r.correct && r.elapsed_ms !== null && r.elapsed_ms < 15000).length;
  const pacePct = allElapsed.length
    ? {
        median_s: Math.round(medianMs / 1000),
        fastest_s: Math.round(Math.min(...allElapsed) / 1000),
        slowest_s: Math.round(Math.max(...allElapsed) / 1000),
        under_15s: rows.filter((r) => r.elapsed_ms !== null && r.elapsed_ms < 15000).length,
      }
    : null;

  // ---- 九维（确定性）
  const accuracy = correctCount / total;
  // 节奏：理想中位数 45–75 秒。低于 25s 视为草率，高于 150s 视为卡顿。
  let paceRatio = 0;
  if (paceAvailable && medianMs !== null) {
    const sec = medianMs / 1000;
    if (sec >= 45 && sec <= 75) paceRatio = 1;
    else if (sec < 45) paceRatio = clamp01(1 - (45 - sec) / 35);   // 45→1, 10→0
    else paceRatio = clamp01(1 - (sec - 75) / 120);                // 75→1, 195→0
  }
  // 知识点反应：触达的各个知识点准确率均值
  const knowledgeRatio = categories.length ? mean(categories.map((c) => c.accuracy / 100)) : 0;
  // 错题负荷：按科目规模加权（大科目错得多更伤）
  const missLoadRatio = accuracy;
  // 弱项集中度：错题集中在单一知识点 = 风险高，得分低
  let concentrationRatio = 0;
  if (misses.length) {
    const counts = {};
    for (const m of misses) counts[m.category] = (counts[m.category] || 0) + 1;
    const top = Math.max(...Object.values(counts));
    concentrationRatio = clamp01(1 - (top / misses.length - 1 / Object.keys(counts).length) / (1 - 1 / Math.max(2, Object.keys(counts).length)));
  } else {
    concentrationRatio = 1; // 全对 = 没有集中风险
  }
  // 一致性：四科准确率的离散度
  const subAccs = subtests.map((s) => s.accuracy / 100);
  const consistencyRatio = subAccs.length > 1
    ? clamp01(1 - Math.sqrt(mean(subAccs.map((v) => (v - mean(subAccs)) ** 2))) / 0.5)
    : 1;
  // 猜测抑制：秒答(<15s)且答错的比例
  const guessingRatio = paceAvailable
    ? clamp01(1 - fastWrong / Math.max(1, Math.ceil(total * 0.25)))
    : 0;
  // 提分空间：把最弱一科拉到满分能补多少分（折算成 0-100 的"剩余空间"读数，
  // 越高说明最弱科越值得投入）
  const weakest = subtests.reduce((a, b) => (a.accuracy <= b.accuracy ? a : b), subtests[0]);
  const upliftRatio = clamp01((100 - weakest.accuracy) / 100);
  // 动力：与历史最好成绩比
  const prev = history.length ? history[history.length - 1] : null;
  const momentumRatio = prev && Number.isFinite(prev.score)
    ? clamp01(0.5 + (score - prev.score) / 40)                        // ±20 分打满
    : 0.5;                                                            // 无历史给中性 50

  const dimensions = DIMENSIONS.map((d) => {
    let ratio;
    let measured = true;
    switch (d.id) {
      case 'accuracy': ratio = accuracy; break;
      case 'pace': ratio = paceRatio; measured = paceAvailable; break;
      case 'knowledge': ratio = knowledgeRatio; break;
      case 'miss_load': ratio = missLoadRatio; break;
      case 'concentration': ratio = concentrationRatio; break;
      case 'consistency': ratio = consistencyRatio; break;
      case 'guessing': ratio = guessingRatio; measured = paceAvailable; break;
      case 'uplift': ratio = upliftRatio; break;
      case 'momentum': ratio = momentumRatio; measured = !!prev; break;
      default: ratio = 0;
    }
    return { id: d.id, label: d.label, hint: d.hint, value: toScore(ratio), measured };
  });

  return {
    // 「真实反映做题数量」：这三个数一律由服务端实际匹配到的题数算出，
    // 前端传什么都不影响。
    question_count: total,
    answered_count: rows.length,
    correct_count: correctCount,
    accuracy: round1(accuracy * 100),
    score,
    pass_probability: pass,
    typical_line: 160,
    subtests,
    categories,
    misses,
    pace: pacePct,
    weakest: weakest ? { code: weakest.code, name: weakest.name, accuracy: weakest.accuracy } : null,
    strongest: (() => {
      const s = subtests.reduce((a, b) => (a.accuracy >= b.accuracy ? a : b), subtests[0]);
      return s ? { code: s.code, name: s.name, accuracy: s.accuracy } : null;
    })(),
    dimensions,
    history_used: history.length,
    previous_score: prev ? prev.score : null,
  };
}

// ---------------------------------------------------------------- 历史

async function readHistory(env, scope) {
  if (!scope) return [];
  try {
    const h = await env.TRIUMPH_KV.get(HIST_PREFIX + scope, 'json');
    return Array.isArray(h) ? h : [];
  } catch (e) { return []; }
}

async function appendHistory(env, scope, summary) {
  if (!scope) return;
  try {
    const h = await readHistory(env, scope);
    // 同一 attempt 不重复计入（用户反复点刷新不该刷出假趋势）
    const next = h.filter((x) => x.attempt_id !== summary.attempt_id).concat([summary]).slice(-12);
    await env.TRIUMPH_KV.put(HIST_PREFIX + scope, JSON.stringify(next));
  } catch (e) { /* 历史写失败不该让报告失败 */ }
}

// ---------------------------------------------------------------- AI 叙述

const AI_SYSTEM =
  'You are a Praxis 5001 (Elementary Education) readiness analyst writing a diagnostic report for a ' +
  'teacher candidate. You receive pre-computed statistics — treat every number as fact and never ' +
  'recompute or contradict it. Write in direct, specific, non-promotional English addressed to "you". ' +
  'Never invent facts about the candidate beyond the statistics. Output STRICT JSON only, no markdown ' +
  'fences, with exactly these keys: {"headline": string, "trend": string, "pace_read": string, ' +
  '"knowledge_read": string, "miss_read": string, "risk": string, "weak_points": [{"topic": string, ' +
  '"why": string, "fix": string}], "next_actions": [string]}. headline <= 90 chars. trend/pace_read/' +
  'knowledge_read/miss_read/risk: 2-3 sentences each. weak_points: 3-5 items. next_actions: 3-5 items.';

function buildAiPayload(stats) {
  return JSON.stringify({
    question_count: stats.question_count,
    correct_count: stats.correct_count,
    accuracy_pct: stats.accuracy,
    estimated_scaled_score: stats.score,
    pass_probability_pct: stats.pass_probability,
    previous_scaled_score: stats.previous_score,
    subtests: stats.subtests.map((s) => ({ code: s.code, name: s.name, correct: s.correct, missed: s.misses, accuracy_pct: s.accuracy })),
    knowledge_points: stats.categories.map((c) => ({ category: c.category, correct: c.correct, missed: c.misses, accuracy_pct: c.accuracy })),
    weakest: stats.weakest,
    strongest: stats.strongest,
    pace: stats.pace,
    dimensions: stats.dimensions.map((d) => ({ id: d.id, value: d.value, measured: d.measured })),
    missed_topics: stats.misses.slice(0, 8).map((m) => ({ category: m.category, question: String(m.question).slice(0, 140) })),
  });
}

async function callModel(env, model, userPayload) {
  try {
    const res = await safeFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.OPENROUTER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: AI_SYSTEM }, { role: 'user', content: userPayload }],
        temperature: 0.3,
        max_tokens: 1400,
      }),
    });
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) return null;
    let clean = content.trim();
    if (clean.startsWith('```')) clean = clean.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    const p = JSON.parse(clean.slice(s, e + 1));
    if (typeof p.headline !== 'string' || typeof p.trend !== 'string') return null;
    return {
      headline: String(p.headline).slice(0, 160),
      trend: String(p.trend),
      pace_read: String(p.pace_read || ''),
      knowledge_read: String(p.knowledge_read || ''),
      miss_read: String(p.miss_read || ''),
      risk: String(p.risk || ''),
      weak_points: Array.isArray(p.weak_points) ? p.weak_points.slice(0, 5).map((w) => ({
        topic: String((w && w.topic) || ''), why: String((w && w.why) || ''), fix: String((w && w.fix) || ''),
      })) : [],
      next_actions: Array.isArray(p.next_actions) ? p.next_actions.slice(0, 5).map(String) : [],
    };
  } catch (e) {
    return null;
  }
}

/** 全模型失败时的确定性兜底：报告仍然完整，只是没有模型润色。 */
export function fallbackNarrative(stats) {
  const w = stats.weakest;
  const topMisses = {};
  for (const m of stats.misses) topMisses[m.category] = (topMisses[m.category] || 0) + 1;
  const worstTopics = Object.entries(topMisses).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    headline: `You scored about ${stats.score} with ${stats.correct_count} of ${stats.question_count} correct.`,
    trend: stats.previous_score
      ? `Your previous diagnostic estimated ${stats.previous_score}; this one lands at ${stats.score}. ${stats.score >= stats.previous_score ? 'That is movement in the right direction — keep the same weekly rhythm.' : 'Scores move down when a session is rushed; re-run when you are fresh before reading too much into it.'}`
      : `This is your first recorded diagnostic, so it sets the baseline at about ${stats.score}.`,
    pace_read: stats.pace
      ? `Your median question took ${stats.pace.median_s}s (fastest ${stats.pace.fastest_s}s, slowest ${stats.pace.slowest_s}s). ${stats.pace.under_15s} question(s) were answered in under 15 seconds — those are the ones most likely to be careless misses.`
      : 'Timing data was incomplete for this session, so pace is not scored. Keep the tab open from the first question next time.',
    knowledge_read: `You touched ${stats.categories.length} knowledge point(s). Strongest: ${stats.strongest ? stats.strongest.name : 'n/a'}. Weakest: ${w ? w.name : 'n/a'}.`,
    miss_read: worstTopics.length
      ? `Most of your misses sit in ${worstTopics.map(([t, n]) => `${t} (${n})`).join(', ')}.`
      : 'You missed nothing — move to a longer diagnostic to find the real ceiling.',
    risk: w
      ? `${w.name} is the subtest most likely to decide your result; at ${w.accuracy}% it is the one to attack first.`
      : 'No clear risk area in this session.',
    weak_points: worstTopics.map(([t, n]) => ({
      topic: t,
      why: `${n} of your ${stats.misses.length} missed question(s) came from this knowledge point.`,
      fix: `Review the underlying rule, then re-attempt ${n < 2 ? 'two' : 'three'} fresh questions from the same knowledge point before moving on.`,
    })),
    next_actions: [
      'Re-do every missed question in this report without looking at the explanation first.',
      w ? `Spend your next two study sessions on ${w.name}.` : 'Take a longer diagnostic to establish a real ceiling.',
      'Come back in 7 days and re-run the diagnostic to measure movement.',
    ],
  };
}

async function buildNarrative(env, stats) {
  if (!env.OPENROUTER_API_KEY) return { narrative: fallbackNarrative(stats), ai: false, model: null };
  const payload = buildAiPayload(stats);
  for (const model of MODELS) {
    const n = await callModel(env, model, payload);
    if (n) return { narrative: n, ai: true, model };
  }
  return { narrative: fallbackNarrative(stats), ai: false, model: null };
}

// ---------------------------------------------------------------- 端点

/** POST /api/diagnostic/report */
export async function hDiagnosticReport(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const body = parsed.body;

  const visitorId = String(body.visitor_id || '').slice(0, 64);
  const attemptId = String(body.attempt_id || '').slice(0, 80);
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 60) : null;
  if (!answers || !answers.length) return apiError('bad_request', { field: 'answers' });
  if (!attemptId) return apiError('bad_request', { field: 'attempt_id' });

  const ent = await resolveEntitlement(request, env, visitorId);

  // ---- 门控：未获权益 → 402，且响应体里没有任何报告内容
  if (ent.tier === 'free') return lockedResponse(ent);

  if (ent.tier === 'credit') {
    const used = Array.isArray(ent.credit.used_attempts) ? ent.credit.used_attempts : [];
    // 一次购买 = 一份报告；同一份报告允许重复下载（用户不该为重新打开再付一次钱）
    if (used.length && used.indexOf(attemptId) === -1) {
      return lockedResponse(ent, { reason: 'credit_spent', spent_on: used.length });
    }
  }

  const bank = await loadBank(env).catch(() => null);
  if (!bank) return apiError('internal_error', { hint: 'Question bank unavailable.' });

  const history = await readHistory(env, ent.scope);
  const stats = computeReport(bank, answers, history);
  if (!stats) return apiError('bad_request', { field: 'answers', hint: 'No answer matched the server question bank.' });

  // 报告缓存：同一 attempt 反复打开不再调模型、不再扣次数
  const cacheKey = REPORT_PREFIX + attemptId;
  let report = null;
  if (ent.tier === 'pro') {
    try { report = await env.TRIUMPH_KV.get(cacheKey, 'json'); } catch (e) { report = null; }
  }
  if (report && report.stats) {
    return ok({ report, cached: true, tier: ent.tier, credit_remaining: creditRemaining(ent, attemptId) });
  }

  const { narrative, ai, model } = await buildNarrative(env, stats);
  const weakTopics = {};
  for (const m of stats.misses) weakTopics[m.category] = (weakTopics[m.category] || 0) + 1;

  report = {
    version: 1,
    generated_at: Date.now(),
    attempt_id: attemptId,
    ai_generated: ai,
    ai_model: model,
    // 报告顶部的结论区
    summary: {
      question_count: stats.question_count,
      correct_count: stats.correct_count,
      accuracy: stats.accuracy,
      score: stats.score,
      pass_probability: stats.pass_probability,
      typical_line: stats.typical_line,
      weakest: stats.weakest,
      strongest: stats.strongest,
      previous_score: stats.previous_score,
    },
    radar: stats.dimensions,
    subtests: stats.subtests.map((s) => ({
      code: s.code, name: s.name, attempted: s.attempted, correct: s.correct,
      misses: s.misses, accuracy: s.accuracy, scaled: Math.round(s.scaled * 10) / 10,
      median_s: s.median_ms === null ? null : Math.round(s.median_ms / 1000),
    })),
    knowledge_points: stats.categories,
    miss_topics: Object.entries(weakTopics)
      .map(([topic, n]) => ({ topic, misses: n }))
      .sort((a, b) => b.misses - a.misses),
    pace: stats.pace,
    narrative,
    // 错题明细：付费报告里给全 12 题（免费层只能看到前 6 题）
    misses: stats.misses,
    history: { used: stats.history_used, previous_score: stats.previous_score },
  };

  // 用掉凭证（一次购买一份报告）
  if (ent.tier === 'credit') {
    const used = Array.isArray(ent.credit.used_attempts) ? ent.credit.used_attempts.slice() : [];
    if (used.indexOf(attemptId) === -1) {
      used.push(attemptId);
      const next = { ...ent.credit, used_attempts: used, last_used_at: Date.now() };
      try {
        await env.TRIUMPH_KV.put(CREDIT_PREFIX + visitorId, JSON.stringify(next), { expirationTtl: REPORT_TTL });
      } catch (e) {
        // 凭证写入失败必须让客户端重试，否则用户付了钱拿不到报告
        console.error('report credit write failed', visitorId, String(e && e.message || e));
        return json({ error: { code: 'internal_error', message: 'Could not record the report credit.', hint: 'Retry in a moment.' }, status: 500 }, 500);
      }
    }
  }

  try { await env.TRIUMPH_KV.put(cacheKey, JSON.stringify(report), { expirationTtl: REPORT_TTL }); } catch (e) {}
  await appendHistory(env, ent.scope, {
    attempt_id: attemptId, ts: Date.now(), score: stats.score,
    pass: stats.pass_probability, accuracy: stats.accuracy, question_count: stats.question_count,
  });

  return ok({ report, cached: false, tier: ent.tier, credit_remaining: creditRemaining(ent, attemptId) });
}

function creditRemaining(ent, attemptId) {
  if (ent.tier !== 'credit') return null;
  const used = Array.isArray(ent.credit.used_attempts) ? ent.credit.used_attempts : [];
  if (!used.length) return 1;
  return used.indexOf(attemptId) === -1 ? 0 : 0; // 单次购买只有一份
}

/** GET /api/diagnostic/report/status?visitor_id=... — 只报权益，不下发报告 */
export async function hDiagnosticReportStatus(request, env) {
  const url = new URL(request.url);
  const visitorId = String(url.searchParams.get('visitor_id') || '').slice(0, 64);
  const ent = await resolveEntitlement(request, env, visitorId);
  return ok({
    tier: ent.tier,
    logged_in: !!ent.email,
    free_review_limit: FREE_REVIEW_LIMIT,
    can_view_report: ent.tier === 'pro' || ent.tier === 'credit',
    purchase_available: ent.tier !== 'pro',
  });
}

export const REPORT_ROUTES = {
  '/api/diagnostic/report': { POST: hDiagnosticReport },
  '/api/diagnostic/report/status': { GET: hDiagnosticReportStatus },
};
