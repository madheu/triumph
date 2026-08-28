// add-og-images.js — 给 site 下的 SEO 文章页插入 og:image + og:url
// og:image 指向 site/images/<slug>.png，og:url 指向 canonical 域名
import fs from 'fs';
import path from 'path';

const SITE = 'E:/Triumph/praxis-5001/site';
const DOMAIN = 'https://learndiag.com';

const files = fs.readdirSync(SITE).filter(f => /^praxis-500[1-5]-.*\.html$/.test(f));

let done = 0;
for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const imgPath = path.join(SITE, 'images', slug + '.png');
  if (!fs.existsSync(imgPath)) { console.log('跳过（无图）:', file); continue; }

  const fp = path.join(SITE, file);
  let c = fs.readFileSync(fp, 'utf8');

  const hasOgImage = c.includes('property="og:image"');
  const hasOgUrl = c.includes('property="og:url"');

  let changed = false;
  if (!hasOgImage) {
    const imgTag = `  <meta property="og:image" content="${DOMAIN}/images/${slug}.png">`;
    // 插到 og:type 后面；若无 og:type 则插到 og:description 后面；都没有则插到 robots 后
    if (c.includes('property="og:type"')) {
      c = c.replace(/(  <meta property="og:type"[^\n]*\n)/, '$1' + imgTag + '\n');
      changed = true;
    } else if (c.includes('property="og:description"')) {
      c = c.replace(/(  <meta property="og:description"[^\n]*\n)/, '$1' + imgTag + '\n');
      changed = true;
    } else {
      c = c.replace(/(  <meta name="robots"[^\n]*\n)/, '$1' + imgTag + '\n');
      changed = true;
    }
  }

  if (!hasOgUrl) {
    const urlTag = `  <meta property="og:url" content="${DOMAIN}/${slug}">`;
    if (c.includes('property="og:type"')) {
      c = c.replace(/(  <meta property="og:type"[^\n]*\n)/, '$1' + urlTag + '\n');
      changed = true;
    } else if (c.includes('property="og:image"')) {
      c = c.replace(/(  <meta property="og:image"[^\n]*\n)/, '$1' + urlTag + '\n');
      changed = true;
    } else {
      c = c.replace(/(  <meta name="robots"[^\n]*\n)/, '$1' + urlTag + '\n');
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(fp, c, 'utf8');
    done++;
    console.log('✓', file, hasOgImage ? '' : '+og:image', hasOgUrl ? '' : '+og:url');
  } else {
    console.log('= (已有) ', file);
  }
}
console.log(`\n更新 ${done} 个文件`);
