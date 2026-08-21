// patch-practice.js — practice.html 接入账户：答题记录云端推送
const fs = require('fs');
const f = 'E:/Triumph/praxis-5001/site/practice.html';
let txt = fs.readFileSync(f, 'utf8');
let changed = 0;

// 1) auth.js script 标签
const oldScript = `<script src="questions.js"></script>`;
const newScript = `<script src="questions.js"></script>
  <script src="js/auth.js"></script>`;
if (txt.includes(oldScript)) { txt = txt.replace(oldScript, newScript); changed++; console.log('1) auth.js added'); }
else {
  // 备选：找 babel script 前插入
  const alt = `<script type="text/babel">`;
  if (txt.includes(alt)) { txt = txt.replace(alt, `<script src="js/auth.js"></script>\n  ${alt}`); changed++; console.log('1) auth.js added (alt)'); }
  else console.log('1) NOT FOUND');
}

// 2) 答题记录写入：本地 + 云端（登录时）
const oldPush = `          const arr = JSON.parse(localStorage.getItem('triumph_answers') || '[]');
          arr.push({ qid: q.id, sub: q.code, category: q.category || '', correct, ts: Date.now() });
          localStorage.setItem('triumph_answers', JSON.stringify(arr.slice(-500)));`;
const newPush = `          const arr = JSON.parse(localStorage.getItem('triumph_answers') || '[]');
          arr.push({ qid: q.id, sub: q.code, category: q.category || '', correct, ts: Date.now() });
          localStorage.setItem('triumph_answers', JSON.stringify(arr.slice(-500)));
          // 登录用户：同步一条答题到云端
          if (window.TriumphAuth && window.TriumphAuth.isLoggedIn()) {
            const state = window.TriumphAuth.buildLocalState();
            state.answers = arr.slice(-500);
            window.TriumphAuth.saveState(state).catch(() => {});
          }`;
if (txt.includes(oldPush)) { txt = txt.replace(oldPush, newPush); changed++; console.log('2) answer sync to cloud'); }
else console.log('2) answer push pattern NOT FOUND');

// 3) 今日任务完成 → 写 triumph_today 后也推云端
const oldToday = `          localStorage.setItem('triumph_today', JSON.stringify({
            date: new Date().toISOString().slice(0, 10), total, done: total, right: stats.right,
          }));`;
const newToday = `          localStorage.setItem('triumph_today', JSON.stringify({
            date: new Date().toISOString().slice(0, 10), total, done: total, right: stats.right,
          }));
          if (window.TriumphAuth && window.TriumphAuth.isLoggedIn()) {
            const st = window.TriumphAuth.buildLocalState();
            window.TriumphAuth.saveState(st).catch(() => {});
          }`;
if (txt.includes(oldToday)) { txt = txt.replace(oldToday, newToday); changed++; console.log('3) today sync'); }
else console.log('3) today pattern NOT FOUND');

fs.writeFileSync(f, txt, 'utf8');
console.log(`practice done, ${changed} changes`);
