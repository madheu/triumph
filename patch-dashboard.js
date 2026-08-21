// patch-dashboard.js — dashboard.html 接入账户系统 + SRS 入口
const fs = require('fs');
const f = 'E:/Triumph/praxis-5001/site/dashboard.html';
let txt = fs.readFileSync(f, 'utf8');
let changed = 0;

// 1) script 标签前加 auth.js
const oldScript = `<script type="text/babel">
    const { useState, useEffect } = React;`;
const newScript = `<script src="js/auth.js"></script>
  <script type="text/babel">
    const { useState, useEffect } = React;`;
if (txt.includes(oldScript)) { txt = txt.replace(oldScript, newScript); changed++; console.log('1) auth.js added'); }

// 2) DB_App：登录态走 TriumphAuth
const oldUser = `const [user, setUser] = useState(() => { try { return localStorage.getItem('triumph_user') || ''; } catch (e) { return ''; } });`;
const newUser = `const [user, setUser] = useState(() => window.TriumphAuth.isLoggedIn() ? window.TriumphAuth.user : '');
      const [syncing, setSyncing] = useState(false);
      const [syncNote, setSyncNote] = useState('');

      // 页面加载时：已登录 → 拉云端合并本地
      useEffect(() => {
        if (!window.TriumphAuth.isLoggedIn()) return;
        let alive = true;
        (async () => {
          try {
            await window.TriumphAuth.syncPull();
            if (!alive) return;
            setPassPct(Number(window.TriumphAuth.localGet('triumph_last_pass', 0)));
            setToday(window.TriumphAuth.localGet('triumph_today', null));
            setExamDate(window.TriumphAuth.localGet('triumph_exam_date', ''));
            const ans = window.TriumphAuth.localGet('triumph_answers', []);
            if (answersRef.current.length === 0) setAnswers(ans);
            setSyncNote('Synced from cloud');
          } catch (e) { setSyncNote('Cloud sync unavailable — showing local data'); }
        })();
        return () => { alive = false; };
      }, []);

      const answersRef = React.useRef([]);`;
if (txt.includes(oldUser)) { txt = txt.replace(oldUser, newUser); changed++; console.log('2) user state via auth'); }

// 3) answers state 引用改 ref（保留现有 useState，仅加载时从云端填充）
const oldAnswers = `const [answers] = useState(() => { try { return JSON.parse(localStorage.getItem('triumph_answers') || '[]'); } catch (e) { return []; } });`;
const newAnswers = `const [answers, setAnswers] = useState(() => window.TriumphAuth.localGet('triumph_answers', []));`;
if (txt.includes(oldAnswers)) { txt = txt.replace(oldAnswers, newAnswers); changed++; console.log('3) answers via auth'); }

// 4) logout 用 auth.js + 云端推送
const oldLogout = `const logout = () => { setUser(''); try { localStorage.removeItem('triumph_user'); } catch (e) {} };`;
const newLogout = `const logout = () => { window.TriumphAuth.logout(); setUser(''); };

      // 关键本地数据变化后自动推送云端（登录时）
      const pushCloud = async () => {
        if (!window.TriumphAuth.isLoggedIn()) return;
        try { await window.TriumphAuth.syncPush(); setSyncNote('Synced'); } catch (e) {}
      };
      const saveDate = d => { setExamDate(d); window.TriumphAuth.localSet('triumph_exam_date', d); pushCloud(); };`;
if (txt.includes(oldLogout)) { txt = txt.replace(oldLogout, newLogout); changed++; console.log('4) logout via auth'); }

// 5) 移除旧的 saveDate（会被新的覆盖定义）
const oldSaveDate = `const saveDate = d => { setExamDate(d); try { localStorage.setItem('triumph_exam_date', d); } catch (e) {} };`;
if (txt.includes(oldSaveDate)) { txt = txt.replace(oldSaveDate, ''); changed++; console.log('5) old saveDate removed'); }

// 6) 未登录提示改为登录引导
const oldLoginBar = `{!user && (
            <div className="login-bar wrap">
              <p>This is a preview. Sign in from the homepage to link your study progress — for now, data stays on this device.</p>
            </div>
          )}`;
const newLoginBar = `{!user && (
            <div className="login-bar wrap">
              <p><a href="login" style={{fontWeight:600}}>Log in</a> to sync your results, plan, and progress across devices. Not registered yet? <a href="login" style={{fontWeight:600}}>Create a free account</a>.</p>
            </div>
          )}
          {syncing && <div className="login-bar wrap"><p>Syncing…</p></div>}
          {syncNote && user && <div className="login-bar wrap" style={{paddingBottom:6}}><p>{syncNote}</p></div>}`;
if (txt.includes(oldLoginBar)) { txt = txt.replace(oldLoginBar, newLoginBar); changed++; console.log('6) login bar updated'); }

// 7) Nav 未登录时加 Log in 链接（DB_Nav 组件内）
const oldNav = `            <a className="nav-cta" href="diagnostic">Free diagnostic →</a>
            {user && <button onClick={onLogout} style={{background:'none',border:'none',fontFamily:'var(--sans)',fontSize:14,color:'var(--ink-soft)',cursor:'pointer',textDecoration:'underline'}}>Log out</button>}`;
const newNav = `            <a className="nav-cta" href="diagnostic">Free diagnostic →</a>
            {user ? <button onClick={onLogout} style={{background:'none',border:'none',fontFamily:'var(--sans)',fontSize:14,color:'var(--ink-soft)',cursor:'pointer',textDecoration:'underline'}}>Log out</button> : <a className="nav-cta" href="login">Log in</a>}`;
if (txt.includes(oldNav)) { txt = txt.replace(oldNav, newNav); changed++; console.log('7) nav login link'); }

// 8) 左侧 Today 区域加 SRS 入口（在 today tasks 下面）
const oldSrs = `              {isTodayDone && (
                <div className="km-bar" style={{margin:'0 14px 12px'}}><div className="km-fill" style={{width: Math.round(today.right / today.total * 100) + '%'}} /></div>
              )}`;
const newSrs = `              {isTodayDone && (
                <div className="km-bar" style={{margin:'0 14px 12px'}}><div className="km-fill" style={{width: Math.round(today.right / today.total * 100) + '%'}} /></div>
              )}
              <h2 style={{marginTop:18}}>Memory <em>cards</em></h2>
              <a className="sub-link" href="srs">
                <span className="code">SRS</span>Review due cards
                <span className="n">due today</span>
              </a>`; 
if (txt.includes(oldSrs)) { txt = txt.replace(oldSrs, newSrs); changed++; console.log('8) SRS entry'); }

// 9) 右侧 stats 提示更新
const oldHint = `<p style={{marginTop:14, fontSize:12, color:'var(--ink-soft)'}}>Future: study plans, memory cards due today, mastery trends.</p>`;
const newHint = `<p style={{marginTop:14, fontSize:12, color:'var(--ink-soft)'}}>Daily tasks focus on your weakest gate. Memory cards use spaced repetition — review what you missed, then forget it less.</p>`;
if (txt.includes(oldHint)) { txt = txt.replace(oldHint, newHint); changed++; console.log('9) stats hint'); }

fs.writeFileSync(f, txt, 'utf8');
console.log(`dashboard done, ${changed} changes`);
