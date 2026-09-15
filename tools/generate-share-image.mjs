import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../site/og-image-learndiag-v1.png', import.meta.url));
const fontfile = fileURLToPath(new URL('../tmp-logo/fonts/instrument-serif-italic.woff2', import.meta.url));

const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F2EFE9"/>
  <path d="M80 142H1120M80 518H1120" stroke="#D8D1C5" stroke-width="2"/>
  <text x="80" y="101" font-family="Arial, sans-serif" font-size="23" letter-spacing="4" fill="#6E6760">FREE PRAXIS PREP</text>
  <text x="80" y="418" font-family="Arial, sans-serif" font-size="40" fill="#3C3733">Know where to start.</text>
  <text x="80" y="466" font-family="Arial, sans-serif" font-size="25" fill="#6E6760">Find your weak spots. Practice with purpose.</text>
  <text x="80" y="567" font-family="Arial, sans-serif" font-size="24" fill="#6E6760">learndiag.com</text>
  <path d="M1024 558H1120M1108 546L1120 558L1108 570" fill="none" stroke="#A67D7A" stroke-width="2"/>
</svg>`);

// Load the checked-in font explicitly so the wordmark never depends on installed fonts.
const wordmark = await sharp({
  text: {
    text: '<span foreground="#3C3733">Learndiag<span foreground="#A67D7A">.</span></span>',
    font: 'Instrument Serif Italic 164',
    fontfile,
    rgba: true,
  },
}).png().toBuffer();

await sharp(background)
  .composite([{ input: wordmark, left: 78, top: 194 }])
  .png()
  .toFile(output);
console.log(output);
