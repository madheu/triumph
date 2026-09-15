#!/usr/bin/env node
// 开工检查器 —— 多会话共写同一工作区时的风险体检。
//
// 背景：本项目全盘只有 praxis-5001 一份代码副本，除 design/rebuild 的 worktree 外，
// 所有会话都写同一个工作区、同一个 main。实测已发生过
// "lost to a concurrent-edit race"（两会话同改一文件、一方被覆盖）的真实事故。
// docs/agent协作工作流.md §5 早就规定了"开工先读会话锁、先看 git status"，但一直是纸面机制。
// 这个脚本把那一步变成一条命令，让规则可执行。
//
// 用法：
//   node tools/session-start.mjs
//   node tools/session-start.mjs --scope site/js        # 额外判断锁是否压住你要改的范围
//   node tools/session-start.mjs --lock-file <路径>      # 用替代锁文件（测试用）
//
// 退出码：0 = 可以开工；1 = 检测到阻塞（有人持锁并压住你的范围）

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const SCOPE = flag('--scope');
const LOCK_FILE = flag('--lock-file') || path.join(REPO, 'docs', '会话锁.md');

let blocking = false;

const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
const rel = (p) => (p || '').replace(/^"|"$/g, '');

console.log('========== 开工检查 ==========');
console.log(`仓库   : ${REPO}`);
console.log(`时间   : ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
if (SCOPE) console.log(`我的范围: ${SCOPE}`);
console.log('');

// ---------- 1. 会话锁 ----------
console.log('---- 1. 会话锁 ----');
console.log(`  文件: ${path.relative(REPO, LOCK_FILE)}`);
if (!fs.existsSync(LOCK_FILE)) {
  console.log('  ⚠️  锁文件不存在 —— 无法判断是否有人在改，建议先补上');
} else {
  const stripped = fs.readFileSync(LOCK_FILE, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const grab = (label) => {
    const m = stripped.match(new RegExp(`^\\s*-\\s*${label}\\s*[:：]\\s*(.+?)\\s*$`, 'm'));
    return m ? m[1].trim() : null;
  };
  const owner = grab('持有会话');
  const lockScope = grab('锁住范围');

  if (!owner) {
    console.log('  🟢 空闲 —— 无人持锁');
  } else {
    console.log('  🔴 有人持锁');
    console.log(`     持有会话: ${owner}`);
    console.log(`     锁住范围: ${lockScope || '(未填)'}`);
    console.log(`     开始时间: ${grab('开始时间') || '(未填)'}`);
    console.log(`     预计结束: ${grab('预计结束') || '(未填)'}`);
    if (SCOPE && lockScope) {
      const parts = lockScope.split(/[,，、;；\s]+/).filter(Boolean);
      const hit = parts.some(
        (p) => SCOPE.startsWith(p) || p.startsWith(SCOPE) || SCOPE.includes(p)
      );
      if (hit) {
        blocking = true;
        console.log(`  ⛔ 与你的范围（${SCOPE}）冲突 —— 停手，先汇报，不要动`);
      } else {
        console.log(`  ✓ 与你的范围（${SCOPE}）不重叠 —— 可以继续，但仍需避开对方文件`);
      }
    } else if (SCOPE && !lockScope) {
      console.log('  ⚠️  对方没写锁住范围 —— 按最坏情况处理，先把你要改的文件列给用户确认');
    }
  }
}
console.log('');

// ---------- 2. 未提交改动 ----------
console.log('---- 2. 未提交改动 ----');
const statusRaw = sh('git status --porcelain') || '';
const lines = statusRaw ? statusRaw.split('\n').filter(Boolean) : [];
const untracked = lines.filter((l) => l.startsWith('??'));
const tracked = lines.filter((l) => !l.startsWith('??'));
console.log(`  共 ${lines.length} 项（已跟踪改动 ${tracked.length} · 未跟踪 ${untracked.length}）`);

if (lines.length) {
  const now = Date.now();
  const byDay = new Map();
  const entries = [];
  for (const l of lines) {
    const f = rel(l.slice(3));
    let st;
    try {
      st = fs.statSync(path.join(REPO, f));
    } catch {
      continue;
    }
    const d = new Date(st.mtime);
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    byDay.set(key, (byDay.get(key) || 0) + 1);
    entries.push({ f, ageH: (now - st.mtimeMs) / 3.6e6 });
  }

  const days = [...byDay.keys()].sort();
  console.log(`  改动日期分布: ${days.map((k) => `${k}(${byDay.get(k)})`).join(' / ')}`);
  if (days.length >= 3) {
    console.log(`  ⚠️  横跨 ${days.length} 个日期 —— 疑似多个会话的活堆在同一个工作区`);
  }

  entries.sort((a, b) => a.ageH - b.ageH);
  const fresh = entries.filter((e) => e.ageH < 1);
  if (fresh.length) {
    console.log(`  ⏱  最近 1 小时内有改动 ${fresh.length} 项（半成品嫌疑，可能是别人正在写）:`);
    for (const e of fresh.slice(0, 8)) console.log(`       ${e.f}  (${Math.round(e.ageH * 60)} 分钟前)`);
    if (fresh.length > 8) console.log(`       … 另有 ${fresh.length - 8} 项`);
  }
}
console.log('');

// ---------- 3. 部署风险 ----------
console.log('---- 3. 部署风险（若此刻跑 pages deploy site） ----');
const siteTracked = tracked.filter((l) => rel(l.slice(3)).startsWith('site/'));
const siteNew = untracked.filter((l) => rel(l.slice(3)).startsWith('site/'));
console.log(`  site/ 下：已跟踪改动 ${siteTracked.length} 项 · 未跟踪 ${siteNew.length} 项`);
console.log('  → 全部会随下一次部署直接上线（未跟踪文件同样会被上传）');
if (siteNew.length) {
  console.log('  未跟踪（将被新增上线）:');
  for (const l of siteNew.slice(0, 12)) console.log(`     ${rel(l.slice(3))}`);
  if (siteNew.length > 12) console.log(`     … 另有 ${siteNew.length - 12} 项`);
}
console.log('');

// ---------- 4. 分支与 worktree ----------
console.log('---- 4. 分支与 worktree ----');
const branch = sh('git rev-parse --abbrev-ref HEAD');
const ahead = sh('git rev-list --count origin/main..HEAD');
console.log(`  当前分支: ${branch}${ahead && ahead !== '0' ? `（领先 origin/main ${ahead} 个提交，未推）` : ''}`);
const wts = sh('git worktree list');
if (wts) {
  console.log('  已有 worktree:');
  for (const l of wts.split('\n')) console.log(`     ${l}`);
}
console.log('');

// ---------- 5. 建议 ----------
console.log('---- 5. 结论 ----');
if (blocking) {
  console.log('  ⛔ 有阻塞项（见第 1 节）—— 不要开工，先向用户汇报');
} else if (lines.length) {
  console.log('  ⚠️  工作区不干净。若要开新分支，绝不要在主工作区 git checkout -b');
  console.log('     （会把上面这些未提交改动一起带走，抽掉别人的工作现场）');
  console.log('  ✅ 正确做法 —— 用 worktree 起一个独立工作区：');
  console.log('     git worktree add ../wt-<会话名> -b <分支名>');
  console.log('  用完清理：git worktree remove ../wt-<会话名>');
} else {
  console.log('  ✅ 工作区干净、无人持锁 —— 可以开工');
}
console.log('');

process.exit(blocking ? 1 : 0);
