#!/usr/bin/env node
// Submit URLs to IndexNow (Bing + participating engines) after deploying.
// Usage:
//   node tools/submit-indexnow.mjs                # submit every URL in sitemap.xml
//   node tools/submit-indexnow.mjs /url1 /url2    # submit specific paths
// Key file must be live at https://<host>/<key>.txt before submitting.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HOST = 'trytriumph.de5.net';
const KEY = '5c78f3e393bb49578d6348ab14eeff91';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function urlsFromSitemap() {
  const xml = fs.readFileSync(path.join(__dirname, '..', 'site', 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

const args = process.argv.slice(2);
let urlList;
if (args.length > 0) {
  urlList = args.map(u => (u.startsWith('http') ? u : `https://${HOST}/${u.replace(/^\//, '')}`));
} else {
  urlList = urlsFromSitemap();
}

if (urlList.length === 0) {
  console.error('No URLs to submit.');
  process.exit(1);
}

const body = {
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList,
};

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

console.log(`Submitted ${urlList.length} URL(s) to IndexNow -> HTTP ${res.status}`);
if (res.status === 200 || res.status === 202) {
  console.log('OK — engines will crawl on their own schedule. Verify receipt in Bing Webmaster Tools.');
  if (args.length === 0) {
    for (const u of urlList) console.log(`  · ${u}`);
  }
} else {
  const text = await res.text().catch(() => '');
  console.error(`Response: ${res.status} ${text}`);
  // 400 bad format, 403 key not valid, 422 urls don't belong to host, 429 spam guard
  process.exit(1);
}
