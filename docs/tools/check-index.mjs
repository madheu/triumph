// check-index.mjs — verify address removal + pricing retained in index.html
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const count = (re) => (html.match(re) || []).length;

console.log('addressCountry occurrences:', count(/addressCountry/g), '(expect 0)');
console.log('PostalAddress occurrences:', count(/PostalAddress/g), '(expect 0)');
console.log('$15 occurrences:', count(/\$15/g), '(expect 6: JSON-LD + comment + SSR cell/note + JSX cell/note)');
console.log('$0 occurrences:', count(/\$0/g), '(expect 2: SSR + JSX)');
console.log('contactPoint present:', html.includes('contactPoint'));
console.log('sameAs x.com/madehu:', html.includes('x.com/madehu'));

let bad = 0;
if (count(/addressCountry/g) !== 0 || count(/PostalAddress/g) !== 0) { console.error('FAIL: address not fully removed'); bad = 1; }
if (count(/\$15/g) !== 6) { console.error('FAIL: $15 count wrong — pricing copy changed unexpectedly'); bad = 1; }
process.exit(bad);
