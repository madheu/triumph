// cleanup-dm-learn.js — 删除 diagnostic 页的 DM_Learn 遗留组件
const fs = require('fs');
const f = 'E:\Triumph\praxis-5001/site/diagnostic.html';
let c = fs.readFileSync(f, 'utf8');

// 1. 删除 DM_Learn 函数（function DM_Learn 到 function DM_App 前）
const ls = c.indexOf('function DM_Learn');
const la = c.indexOf('function DM_App');
if (ls > 0 && la > ls) {
  c = c.slice(0, ls) + c.slice(la);
  console.log('DM_Learn 函数已删除');
} else {
  console.log('未找到 DM_Learn 边界:', ls, la);
}

// 2. 删除 DM_App 里 learn 渲染行
const learnRender = c.indexOf("{stage === 'learn'");
if (learnRender > 0) {
  const end = c.indexOf('/>}', learnRender);
  if (end > 0) c = c.slice(0, learnRender) + c.slice(end + 3);
  console.log('learn 渲染已删除');
}

// 3. DM_Report 调用去掉 onStartLearn
c = c.replace("onStartLearn={() => setStage('learn')}", '');
// 4. DM_Report 签名去掉 onStartLearn
c = c.replace('onRestart, onStartLearn })', 'onRestart })');
// 5. stage 注释清理
c = c.replace('// intro | quiz | report | learn', '// intro | quiz | report');

fs.writeFileSync(f, c, 'utf8');
const check = fs.readFileSync(f, 'utf8');
console.log('残留 DM_Learn:', /DM_Learn/.test(check));
console.log('残留 onStartLearn:', /onStartLearn/.test(check));
console.log('残留 learn stage:', /stage === 'learn'/.test(check));
