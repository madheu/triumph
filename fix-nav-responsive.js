// fix-nav-responsive.js — 所有页面导航手机端适配（flex-wrap + 紧凑）
const fs = require('fs');
const path = require('path');
const site = 'E:\Triumph\praxis-5001/site/';

const files = fs.readdirSync(site).filter(f => f.endsWith('.html'));
files.forEach(f => {
  const p = site + f;
  let c = fs.readFileSync(p, 'utf8');
  let changed = 0;

  // 1. .nav 主样式加 flex-wrap + gap（防溢出）
  const navRe = /(\.nav \{[^}]*?)(\})/;
  if (navRe.test(c) && !/\.nav \{[^}]*flex-wrap/.test(c)) {
    c = c.replace(navRe, (m, head, tail) => head + ' flex-wrap: wrap; gap: 10px 18px;' + tail);
    changed++;
  }

  // 2. @media 手机块：若无 nav 紧凑规则则注入（放在每个 media 块开头）
  const mediaRe = /(@media \(max-width: (?:620|760)px\) \{)([\s\S]*?)(\n    \})/g;
  c = c.replace(mediaRe, (m, open, body, close) => {
    let b = body;
    if (!b.includes('.nav-email { display: none; }')) {
      b = b.replace(/(\n[ \t]+)\.wrap \{/, '$1.nav { gap: 8px 14px; }\n$1.nav-cta { font-size: 13px; }\n$1.nav-btn { padding: 5px 10px; font-size: 13px; }\n$1.nav-email { display: none; }$1.wrap {');
      changed++;
    }
    return open + b + close;
  });

  if (changed) {
    fs.writeFileSync(p, c, 'utf8');
    console.log(`已修: ${f} (${changed})`);
  } else {
    console.log(`跳过(无需改): ${f}`);
  }
});
console.log('完成');
