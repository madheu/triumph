// patch-index-auth.js — 一次性补丁：把 index.html 的 mock 登录换成真实 API 登录
const fs = require('fs');
const f = 'E:/Triumph/praxis-5001/site/index.html';
let txt = fs.readFileSync(f, 'utf8');

// 1) doLogin -> doAuth
const oldDoAuth = `const doLogin = () => {
        const ok = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim());
        if (!ok) { setErr('Please enter a valid email.'); return; }
        try { localStorage.setItem('triumph_user', email.trim()); } catch (e) {}
        setUser(email.trim()); setShowLogin(false); setEmail(''); setErr('');
      };
      const doLogout = () => { try { localStorage.removeItem('triumph_user'); } catch (e) {} setUser(''); };`;

const newDoAuth = `const doAuth = async () => {
        const ok = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim());
        if (!ok) { setErr('Please enter a valid email.'); return; }
        if (authMode === 'register' && password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
        setBusy(true); setErr('');
        try {
          if (authMode === 'login') await window.TriumphAuth.login(email.trim(), password);
          else await window.TriumphAuth.register(email.trim(), password);
          try { await window.TriumphAuth.syncAll(); } catch (e) {}
          setUser(window.TriumphAuth.user); setShowLogin(false); setEmail(''); setPassword(''); setErr('');
        } catch (e) {
          setErr({ invalid_email: 'That email address is not valid.', password_too_short: 'Password must be at least 8 characters.', email_taken: 'That email is already registered. Try logging in.', invalid_credentials: 'Email or password is incorrect.' }[e.code] || (e.message || 'Something went wrong.'));
        } finally { setBusy(false); }
      };
      const doLogout = () => { window.TriumphAuth.logout(); setUser(''); };`;

let changed = 0;
if (txt.includes(oldDoAuth)) { txt = txt.replace(oldDoAuth, newDoAuth); changed++; console.log('1) doAuth replaced'); }
else console.log('1) doAuth pattern NOT FOUND (maybe already patched)');

// 2) states: add password/authMode/busy
const oldStates = `const [email, setEmail] = useState('');
      const [err, setErr] = useState('');`;
const newStates = `const [email, setEmail] = useState('');
      const [password, setPassword] = useState('');
      const [authMode, setAuthMode] = useState('login');
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState('');`;
if (txt.includes(oldStates)) { txt = txt.replace(oldStates, newStates); changed++; console.log('2) states added'); }
else console.log('2) states pattern NOT FOUND');

// 3) auth.js script tag
const oldScript = `<script type="text/babel">
    const { useState } = React;`;
const newScript = `<script src="js/auth.js"></script>
  <script type="text/babel">
    const { useState } = React;`;
if (txt.includes(oldScript)) { txt = txt.replace(oldScript, newScript); changed++; console.log('3) auth.js added'); }
else console.log('3) script tag pattern NOT FOUND (maybe already added)');

fs.writeFileSync(f, txt, 'utf8');
console.log(`done, ${changed} changes`);
