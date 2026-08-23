// live-check.mjs — verify deployed homepage: address removed, pricing intact
import { readFileSync } from 'node:fs';
const h = readFileSync(process.env.TEMP + '/live-home2.html', 'utf8');
console.log('contactPoint present:', h.includes('contactPoint'));
console.log('sameAs x.com/madehu:', h.includes('x.com/madehu'));
console.log('$15 count:', (h.match(/\$15/g) || []).length, '(expect 6)');
console.log('$0 count:', (h.match(/\$0/g) || []).length, '(expect 2)');
console.log('bytes:', Buffer.byteLength(h));
