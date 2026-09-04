// worker-src/ai-analyst.mjs — AI 错题分析师（OpenRouter 免费模型链）
//
// 设计原则：AI 永远不判对错。正确答案与官方解析来自题库（ASSETS 内
// data/questions-api.json），模型仅基于这些事实解释学生的错因。
// 任何失败（429/超时/坏 JSON）→ 依次降级到下一个模型 → 全败回退官方解析。
// 最坏情况等于现状（静态解析），不会更差。
//
// POST /api/ai/analyze  { questionId, selected }   （需登录）
//   free 用户每日 3 次（UTC 日）。仅真实模型调用计数：缓存命中与回退都不扣次数。
//   PRO（users:<email> 记录 plan==='pro'）不限量。
//   KV: ai_quota:<sub>:<yyyymmdd> 计数；ai_cache:<sha256(qid|selected)> 结果缓存 30 天。
//   模型链：minimax-m3 → glm-5.2 → nemotron-ultra（免费档，按实测质量排序）。

import { json, ok, readJsonBody, apiError, safeFetch } from './http.mjs';
import { bearerToken, verifyJwt } from './crypto.mjs';
import { loadBank } from './bank.mjs';
import { USER_KEY } from './accounts.mjs';

const MODELS = [
  'minimax/minimax-m3:free',
  'z-ai/glm-5.2:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];
const FREE_DAILY_LIMIT = 3;
const CACHE_TTL = 60 * 60 * 24 * 30; // 30 天

const SYSTEM_PROMPT =
  'You are an expert Praxis 5001 (Elementary Education) tutor writing for a teacher-candidate ' +
  'who just answered a practice question incorrectly. You will receive: the question, all options, ' +
  'the correct answer, the official explanation, and the wrong option the student chose. ' +
  'Rules: Use ONLY the facts provided — never introduce outside facts, and never claim any option ' +
  'other than the given correct answer could be correct. Explain why the STUDENT\'S choice is ' +
  'tempting but wrong, name the misconception, and give a concrete review pointer. Encouraging, ' +
  'direct tone, addressed to the student ("you"). Output STRICT JSON only — no markdown fences, ' +
  'no commentary — with exactly these keys: ' +
  '{"misconception": string, "why_wrong": string, "key_point": string, "review_topic": string}. ' +
  'Each value: 1-2 short sentences.';

function quotaKey(sub) {
  const d = new Date();
  const ymd = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  return `ai_quota:${sub}:${ymd}`;
}

async function cacheKey(questionId, selected) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${questionId}|${selected}`));
  return 'ai_cache:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 调一个模型并解析输出；任何异常/坏 JSON 返回 null（由调用方降级到下一个模型）。 */
async function callModel(env, model, userPayload) {
  try {
    const res = await safeFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.OPENROUTER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPayload },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) return null;
    let clean = content.trim();
    if (clean.startsWith('```')) clean = clean.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(clean.slice(start, end + 1));
    const keys = ['misconception', 'why_wrong', 'key_point', 'review_topic'];
    if (!keys.every(k => typeof parsed[k] === 'string' && parsed[k].trim())) return null;
    return { misconception: parsed.misconception.trim(), why_wrong: parsed.why_wrong.trim(), key_point: parsed.key_point.trim(), review_topic: parsed.review_topic.trim() };
  } catch (e) {
    return null;
  }
}

export async function hAiAnalyze(request, env) {
  const user = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!user || !user.email) return apiError('unauthorized');
  if (!env.OPENROUTER_API_KEY) {
    return json({ error: { code: 'ai_not_configured', message: 'AI analysis is not configured yet.', hint: 'Contact the site owner.' }, status: 503 }, 503);
  }

  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const qid = String((parsed.body && parsed.body.questionId) || '');
  const selected = Number(parsed.body && parsed.body.selected);
  if (!qid) return apiError('bad_request', { field: 'questionId' });
  if (!Number.isInteger(selected)) return apiError('bad_request', { field: 'selected', expected: 'integer option index' });

  const bank = await loadBank(env);
  const q = bank.find(x => x.id === qid);
  if (!q) return apiError('not_found', { path: qid });
  if (selected === q.answer) return ok({ already_correct: true });

  // PRO 判定：users:<email> 记录 plan
  let plan = 'free';
  try {
    const rec = await env.TRIUMPH_KV.get(USER_KEY(user.email), 'json');
    if (rec && rec.plan) plan = rec.plan;
  } catch (e) {}
  const isPro = plan === 'pro';

  const qKey = quotaKey(user.sub || user.email);
  let used = 0;
  if (!isPro) {
    used = await env.TRIUMPH_KV.get(qKey).then(Number).catch(() => 0);
    if (!Number.isFinite(used) || used < 0) used = 0;
    if (used >= FREE_DAILY_LIMIT) {
      return json({
        error: {
          code: 'quota_exceeded',
          message: `You have used all ${FREE_DAILY_LIMIT} free AI analyses for today.`,
          hint: 'Upgrade to Pro for unlimited AI error analysis.',
        },
        status: 429,
      }, 429);
    }
  }
  const remainingLeft = isPro ? null : Math.max(0, FREE_DAILY_LIMIT - used);

  // 缓存命中不扣次数、不调模型
  const cKey = await cacheKey(qid, selected);
  const cached = await env.TRIUMPH_KV.get(cKey, 'json').catch(() => null);
  if (cached && cached.analysis) {
    return ok({ analysis: cached.analysis, model: cached.model || null, cached: true, remaining: remainingLeft, fallback: false });
  }

  const userPayload = JSON.stringify({
    question: q.q,
    options: q.options,
    correct_answer: q.options[q.answer],
    official_explanation: q.explain,
    student_chose: q.options[selected],
  });

  let analysis = null;
  let usedModel = null;
  for (const model of MODELS) {
    analysis = await callModel(env, model, userPayload);
    if (analysis) { usedModel = model; break; }
  }

  if (!analysis) {
    // 全部模型失败：回退官方解析（不扣次数，鼓励稍后重试）
    return ok({
      fallback: true,
      explanation: q.explain,
      correct_answer: q.options[q.answer],
      remaining: remainingLeft,
    });
  }

  await env.TRIUMPH_KV.put(cKey, JSON.stringify({ analysis, model: usedModel, ts: Date.now() }), { expirationTtl: CACHE_TTL });
  const newUsed = used + 1;
  await env.TRIUMPH_KV.put(qKey, String(newUsed), { expirationTtl: 60 * 60 * 48 });
  return ok({
    analysis,
    model: usedModel,
    cached: false,
    remaining: isPro ? null : Math.max(0, FREE_DAILY_LIMIT - newUsed),
    fallback: false,
  });
}

export const AI_ROUTES = {
  '/api/ai/analyze': { POST: hAiAnalyze },
};
