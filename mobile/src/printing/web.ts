// Printing from the web app (iPhone, computer): the slip is laid out as a page and handed to the browser's
// print dialog (AirPrint on iPhone, any installed printer on a computer). Text keeps its own letters (Marathi).
import type { Row, Slip } from './escpos';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function rowHtml(r: Row) {
  if (r.kind === 'rule') return '<hr>';
  const cls = `${r.bold ? 'b' : ''} ${r.big ? 'big' : ''}`;
  if (r.kind === 'cols') return `<div class="cols ${cls}"><span>${esc(r.left)}</span><span>${esc(r.right)}</span></div>`;
  return `<div class="${cls}" style="text-align:${r.align}">${esc(r.text) || '&nbsp;'}</div>`;
}

/** The slips as one printable page (each slip on its own page), text as written. */
export function slipsHtml(slips: Slip[], paper: 58 | 80) {
  const mm = paper === 80 ? 72 : 48;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@500;700&display=block">
<style>
  @page { margin: 3mm; }
  body { margin: 0; font: 12px/1.35 ui-monospace, Menlo, Consolas, "Noto Sans Devanagari", monospace; color: #000; }
  .slip { width: ${mm}mm; margin: 0 auto; }
  .slip + .slip { page-break-before: always; }
  .b { font-weight: 700; } .big { font-size: 17px; line-height: 1.25; }
  .cols { display: flex; justify-content: space-between; gap: 8px; } .cols span:last-child { white-space: nowrap; }
  hr { border: 0; border-top: 1px dashed #000; margin: 3px 0; }
</style></head><body>${slips.map((s) => `<div class="slip">${s.rows.map(rowHtml).join('')}</div>`).join('')}</body></html>`;
}

export function printInBrowser(slips: Slip[], paper: 58 | 80) {
  const html = slipsHtml(slips, paper);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  const go = () => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  // Wait for the Marathi font (max 1.5 s) so the page prints with it.
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  Promise.race([fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]).then(() => setTimeout(go, 50));
}
