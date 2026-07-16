// Security regression (M10 / Phase F): exercise the DOMPurify EMAIL_CONFIG used
// by src/utils/html-sanitizer.js against the audit's canonical XSS vectors.
// Run: node scripts/xss-regression.mjs   (requires jsdom + dompurify installed)
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const { window } = new JSDOM('');
const DOMPurify = createDOMPurify(window);

// Mirror EMAIL_CONFIG + link/protocol hooks from html-sanitizer.js
const DANGEROUS_PROTOCOL = /^\s*(javascript|vbscript|data\s*:(?!image\/(png|jpe?g|gif|webp|bmp|svg\+xml)))/i;
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
  for (const attr of ['href', 'src', 'xlink:href']) {
    const v = node.getAttribute && node.getAttribute(attr);
    if (v && DANGEROUS_PROTOCOL.test(v)) node.removeAttribute(attr);
  }
});
const EMAIL_CONFIG = {
  FORBID_TAGS: ['script','iframe','object','embed','base','form','meta','link'],
  FORBID_ATTR: ['srcdoc','ping','formaction'],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target','rel']
};
const clean = h => DOMPurify.sanitize(String(h), EMAIL_CONFIG);

const vectors = [
  ['img onerror', `<img src=x onerror="alert(document.cookie)">`],
  ['svg onload', `<svg onload=alert(1)>`],
  ['iframe injection', `<iframe src="javascript:alert(1)"></iframe>`],
  ['javascript: href', `<a href="javascript:alert(1)">x</a>`],
  ['inline onclick', `<div onclick="alert(1)">x</div>`],
  ['script tag', `<script>alert(1)</script>`],
  ['body onload', `<body onload=alert(1)>hi</body>`],
  ['object data', `<object data="javascript:alert(1)"></object>`],
  ['form formaction', `<form><button formaction="javascript:alert(1)">x</button></form>`],
  ['meta refresh', `<meta http-equiv="refresh" content="0;url=javascript:alert(1)">`],
  ['svg script', `<svg><script>alert(1)</script></svg>`],
  ['a data html', `<a href="data:text/html,<script>alert(1)</script>">x</a>`],
];

let fail = 0;
for (const [name, payload] of vectors) {
  const out = clean(payload);
  const bad = /onerror|onload|onclick|<script|<iframe|javascript:|<object|<meta|formaction/i.test(out);
  console.log(`${bad ? 'FAIL' : 'PASS'}  ${name}  -> ${out || '(empty)'}`);
  if (bad) fail++;
}

const benign = clean(`<p>Hello <b>world</b> <a href="https://example.com">link</a></p><img src="https://x/y.png">`);
const keptLink = benign.includes('href="https://example.com"');
const keptImg = benign.includes('src="https://x/y.png"');
console.log(`${keptLink && keptImg ? 'PASS' : 'FAIL'}  benign content preserved -> ${benign}`);
if (!(keptLink && keptImg)) fail++;

console.log(`\nSTORED_XSS_FIXED=${fail === 0 ? 'true' : 'false'}  (${fail} failing vectors)`);
process.exit(fail === 0 ? 0 : 1);
