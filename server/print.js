import fs from 'node:fs';
import { toFaDigits, formatNumber, formatDigitsText, lineTotal } from '../shared/format.js';
import { fontCss, FONT_STACK } from './fonts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const BASE_ROWS = 14;      // ردیف‌هایی که با اندازه‌ی کامل جا می‌شوند
export const MAX_SINGLE = 25;     // بیش از این → صفحه دوم
const ROW_MM = 6.2;
const PAGE_MM = 193;
const GAP = 2;
const SIGN_MM = 29;
const HEAD_BLOCK_MM = 13 + 12.5 * 2 + GAP * 3;   // سربرگ + دو کادر + سه فاصله
const TITLE_HEAD_MM = 5.8 + 6.2;                 // نوار عنوان + سرستون جدول
const SAFETY_MM = 2;

const COLS = (showCode) => [
  { k: 'row', w: 10 },
  ...(showCode ? [{ k: 'code', w: 16 }] : []),
  { k: 'desc', w: 78 },
  { k: 'qty', w: 20 },
  { k: 'unit', w: 14 },
  { k: 'price', w: 32 },
  { k: 'total', w: 36 },
  { k: 'remark', w: showCode ? 75 : 91 },
];

/** تقسیم ردیف‌ها به صفحه‌ها: تا ۲۵ ردیف تک‌صفحه؛ بیشتر → چندصفحه با تکرار سرستون، آخرین صفحه حداکثر ۱۴ ردیف. */
export function paginate(n) {
  if (n <= MAX_SINGLE) return [n];
  const pages = [];
  let rem = n;
  while (rem > MAX_SINGLE) { pages.push(MAX_SINGLE); rem -= MAX_SINGLE; }
  if (rem > BASE_ROWS) { pages.push(rem - BASE_ROWS); rem = BASE_ROWS; }
  pages.push(rem);
  return pages;
}

const fitFont = (text, capacity, fs) => {
  const len = [...String(text)].length;
  return len > capacity ? Math.max(5.5, fs * capacity / len) : fs;
};

/** ارتفاع تقریبی بخش پایین (جمع‌ها + توضیحات/پرداخت + مهر) به میلی‌متر. */
function footerMm(d) {
  const t = d.totals;
  const rows = 1 + (t.discount > 0 || t.taxPercent > 0 ? 1 : 0) + (t.discount > 0 ? 1 : 0) + (t.taxPercent > 0 ? 2 : 0);
  const wordLines = Math.ceil(([...String(d.words)].length + 16) / 62);
  const totals = Math.max(rows * 5.4, 3 + wordLines * 4.9);
  const half = d.pay?.length ? 0.5 : 1;
  const noteLines = Math.min(5, String(d.notes || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(([...l].length + 8) / (180 * half))), 0));
  const noteH = Math.max(7, 2.6 + noteLines * 4.6);
  const payH = d.pay?.length ? 2.4 + d.pay.length * 4.6 : 0;
  return totals + Math.max(noteH, payH) + SIGN_MM + GAP * 3 + 1;
}

function itemRow(it, idx, cols, fs, rowMm) {
  const cell = (k) => {
    switch (k) {
      case 'row': return `<td class="c">${toFaDigits(idx)}</td>`;
      case 'code': return `<td class="c">${toFaDigits(it.code)}</td>`;
      case 'desc': return `<td class="r" style="font-size:${fitFont(it.description, 52, fs).toFixed(2)}pt">${esc(it.description)}</td>`;
      case 'qty': return `<td class="c">${formatNumber(it.qty)}</td>`;
      case 'unit': return `<td class="c">${esc(it.unit)}</td>`;
      case 'price': return `<td class="c">${formatNumber(it.unit_price)}</td>`;
      case 'total': return `<td class="c">${formatNumber(it.line_total ?? lineTotal(it.qty, it.unit_price))}</td>`;
      case 'remark': return `<td class="r" style="font-size:${fitFont(it.remark, 62, fs).toFixed(2)}pt">${esc(it.remark)}</td>`;
    }
  };
  return `<tr style="height:${rowMm}mm">${cols.map((c) => cell(c.k)).join('')}</tr>`;
}

function headerBlock(d) {
  return `<div class="box hdr">
  <div class="hc company">${d.logo_data_uri ? `<img class="logo" src="${d.logo_data_uri}" alt="">` : esc(d.company_title)}</div>
  <div class="hc title">${esc(d.invoice_title)}</div>
  <div class="hc meta"><div><span>شماره فاکتور:</span><b>${toFaDigits(d.number)}</b></div><div><span>تاریخ:</span><b>${toFaDigits(d.jdate)}</b></div></div>
</div>`;
}

function party(title, p, second) {
  return `<div class="box party"><div class="vt"><span>${title.replace(' ', '<br>')}</span></div><div class="pbody">
    <div class="prow"><div class="pc w5"><b>نام شخص حقیقی / حقوقی:</b> ${esc(p.name)}</div>
      <div class="pc w3"><b>شناسه ملی:</b> <span>${formatDigitsText(esc(p.national_id))}</span></div>
      <div class="pc w2 last"><b>تلفن تماس:</b> <span>${formatDigitsText(esc(p.phone))}</span></div></div>
    <div class="prow">${second}</div></div></div>`;
}

function totalsBlock(d, cols) {
  const t = d.totals;
  const rows = [];
  if (t.discount > 0 || t.taxPercent > 0) rows.push(['جمع کل:', formatNumber(t.subtotal)]);
  if (t.discount > 0) rows.push(['تخفیف:', formatNumber(t.discount)]);
  if (t.taxPercent > 0) {
    rows.push(['درصد مالیات:', `${formatNumber(t.taxPercent)}٪`]);
    rows.push(['مبلغ مالیات:', formatNumber(t.taxAmount)]);
  }
  rows.push(['مبلغ قابل پرداخت:', formatNumber(t.payable), true]);
  const wordSpan = cols.findIndex((c) => c.k === 'price');
  const body = rows.map((r, i) => {
    const b = r[2] ? ' b' : '';
    const first = i === 0 ? `<td class="words" colspan="${wordSpan}" rowspan="${rows.length}"><b>جمع کل (حروف):</b> ${esc(d.words)}</td>` : '';
    const last = i === 0 ? `<td class="rem" rowspan="${rows.length}"></td>` : '';
    return `<tr>${first}<td class="tl${b}">${r[0]}</td><td class="tv${b}">${r[1]}</td>${last}</tr>`;
  }).join('');
  return `<div class="box"><table class="tot"><colgroup>${cols.map((c) => `<col style="width:${c.w}mm">`).join('')}</colgroup>${body}</table></div>`;
}

function itemsBox(cols, rows, startIdx, { rowMm, fs, titleSuffix }) {
  const head = { row: 'ردیف', code: 'کد کالا', desc: 'شرح کالا یا خدمات', qty: 'مقدار', unit: 'واحد', price: 'مبلغ واحد (ریال)', total: 'مبلغ کل (ریال)', remark: 'توضیحات' };
  // خطوط عمودی ستون‌ها (از راست)
  let acc = 0;
  const lines = cols.slice(0, -1).map((c) => { acc += c.w; return `<i class="vl" style="right:${acc}mm"></i>`; }).join('');
  const body = rows.map((it, i) => itemRow(it, startIdx + i + 1, cols, fs, rowMm)).join('');
  return `<div class="box itemsbox">
  <div class="ttl">مشخصات کالا یا خدمات مورد معامله${titleSuffix || ''}</div>
  ${lines}
  <table class="items" style="font-size:${fs}pt"><colgroup>${cols.map((c) => `<col style="width:${c.w}mm">`).join('')}</colgroup>
  <tr class="hd">${cols.map((c) => `<td>${head[c.k]}</td>`).join('')}</tr>${body}</table></div>`;
}

function payBox(pay) {
  const rows = pay.map((p) => {
    let v = String(p.value);
    if (p.key === 'card') v = v.replace(/(\d{4})(?=\d)/g, '$1-');
    return `<div class="payrow"><span>${esc(p.label)}:</span><b class="ltr">${p.key === 'holder' ? esc(v) : toFaDigits(esc(v))}</b></div>`;
  }).join('');
  return `<div class="pay">${rows}</div>`;
}

const CSS = `
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box}
:root{--ln:#8d98a8;--soft:#d3d9e2;--bg:#f3f5f8}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${FONT_STACK};font-size:9pt;color:#111;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:281mm;height:${PAGE_MM}mm;overflow:hidden;position:relative;page-break-after:always;break-after:page;display:flex;flex-direction:column;gap:${GAP}mm}
.page:last-child{page-break-after:auto;break-after:auto}
.box{border:.6pt solid var(--ln);border-radius:1.8mm;overflow:hidden;background:#fff;flex:none}
.hdr{display:flex;height:13mm}
.hc{display:flex;align-items:center;justify-content:center;border-left:.5pt solid var(--soft)}
.hc:last-child{border-left:0}
.company{width:70mm;font-size:11pt;font-weight:700}
.logo{max-width:62mm;max-height:11mm;object-fit:contain}
.title{flex:1;font-size:15pt;font-weight:700}
.meta{width:70mm;flex-direction:column;align-items:stretch;justify-content:stretch}
.meta>div{flex:1;display:flex;justify-content:space-between;align-items:center;padding:0 3mm;font-size:9.5pt}
.meta>div+div{border-top:.5pt solid var(--soft)}
.party{display:flex;height:12.5mm}
.vt{width:9mm;flex:none;background:var(--bg);border-left:.5pt solid var(--soft);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:7.5pt;overflow:hidden}
.vt span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;line-height:1.25;text-align:center}
.pbody{flex:1;display:flex;flex-direction:column}
.prow{flex:1;display:flex;align-items:center}
.prow+.prow{border-top:.5pt solid var(--soft)}
.pc{padding:0 2.5mm;height:100%;display:flex;align-items:center;gap:1.5mm;border-left:.5pt solid var(--soft);white-space:nowrap;overflow:hidden}
.pc.last{border-left:0}.pc.full{flex:1;border-left:0;white-space:normal}
.w5{flex:5}.w3{flex:3}.w2{flex:2}
.pc b{font-weight:700}
table{border-collapse:collapse}
.itemsbox{flex:1;min-height:0;position:relative}
.ttl{background:#D6DCE4;text-align:center;font-weight:700;height:5.8mm;line-height:5.8mm;font-size:9.5pt;position:relative;z-index:2}
.vl{position:absolute;top:5.8mm;bottom:0;width:0;border-right:.4pt solid var(--soft);z-index:0}
.items{width:281mm;table-layout:fixed;position:relative;z-index:1}
.items td{padding:0 1.8mm;line-height:1.1;overflow:hidden;white-space:nowrap;border-bottom:.3pt solid var(--soft)}
.items td.c{text-align:center}.items td.r{text-align:right}
.items tr.hd td{text-align:center;font-weight:700;height:6.2mm;background:var(--bg);border-bottom:.5pt solid var(--ln)}
.tot{width:281mm;table-layout:fixed}
.tot td{padding:0 2mm;height:5.4mm;line-height:1.1}
.tot td.words{vertical-align:top;padding:1.6mm 3mm;white-space:normal;line-height:1.5;font-size:9.5pt}
.tot td.tl{text-align:right;border-right:.4pt solid var(--soft);border-left:.4pt solid var(--soft)}
.tot td.tv{text-align:center;border-left:.4pt solid var(--soft)}
.tot td.b{font-weight:700;font-size:10pt}
.notesrow{display:flex}
.notes{flex:1;min-height:7mm;max-height:26mm;overflow:hidden;padding:1.4mm 3mm;line-height:1.5;white-space:pre-wrap}
.pay{width:50%;border-right:.5pt solid var(--soft);padding:1.4mm 3mm;display:flex;flex-direction:column;justify-content:center;gap:.6mm;background:#fafbfc}
.payrow{display:flex;justify-content:space-between;gap:4mm;line-height:1.5}
.ltr{direction:ltr;unicode-bidi:isolate;letter-spacing:.2pt}
.sign{display:flex;height:${SIGN_MM}mm}
.sign>div{flex:1;padding:1.6mm 3mm;position:relative;font-weight:700}
.sign>div+div{border-right:.5pt solid var(--soft)}
.sign img{position:absolute;height:25mm;max-width:50mm;bottom:1.6mm;right:42mm;mix-blend-mode:multiply;opacity:.95}
`;

/**
 * d = { number, jdate, company_title, invoice_title, seller{...}, buyer{...}, items[], totals, words, notes,
 *       pay[{key,label,value}], show_code, stamp_data_uri }
 */
export function renderInvoiceHtml(d, { embedFonts = false } = {}) {
  const cols = COLS(!!d.show_code);
  const items = d.items;
  const pages = paginate(items.length);
  const sellerBox = party('مشخصات فروشنده', d.seller, `<div class="pc full"><b>نشانی:</b> ${esc(d.seller.address)}</div>`);
  const buyerBox = party('مشخصات خریدار', d.buyer,
    `<div class="pc full" style="flex:8"><b>نشانی:</b> ${esc(d.buyer.address)}</div><div class="pc" style="flex:3;border-right:.5pt solid var(--soft);border-left:0"><b>شماره ثبت:</b> ${formatDigitsText(esc(d.buyer.reg_no))}</div>`);
  const stampImg = d.stamp_data_uri ? `<img src="${d.stamp_data_uri}" alt="">` : '';
  const hasPay = d.pay?.length > 0;
  const footer = `${totalsBlock(d, cols)}
    <div class="box notesrow"><div class="notes"><b>توضیحات:</b> ${esc(d.notes)}</div>${hasPay ? payBox(d.pay) : ''}</div>
    <div class="box sign"><div>مهر و امضاء فروشنده:${stampImg}</div><div>مهر و امضاء خریدار:</div></div>`;

  let out = '';
  let start = 0;
  pages.forEach((count, pi) => {
    const rows = items.slice(start, start + count);
    const isFirst = pi === 0;
    const isLast = pi === pages.length - 1;
    const used = (isFirst ? HEAD_BLOCK_MM : 0) + TITLE_HEAD_MM + GAP + (isLast ? footerMm(d) : 0);
    let rowMm = (PAGE_MM - used - SAFETY_MM) / Math.max(count, BASE_ROWS);
    rowMm = Math.max(3.2, Math.min(ROW_MM, rowMm));
    const fs = Math.min(9, Math.max(6, rowMm * 1.55));
    out += `<div class="page">`;
    if (isFirst) out += `${headerBlock(d)}${sellerBox}${buyerBox}`;
    out += itemsBox(cols, rows, start, { rowMm, fs, titleSuffix: isFirst ? '' : ` — ادامه (شماره ${toFaDigits(d.number)})` });
    if (isLast) out += footer;
    out += `</div>`;
    start += count;
  });
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${toFaDigits(d.number)}</title>
<style>${fontCss({ embed: embedFonts })}${CSS}</style></head><body>${out}</body></html>`;
}

export function stampDataUri(file) {
  if (!file || !fs.existsSync(file)) return null;
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
}

export function imageDataUri(file) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,` + fs.readFileSync(file).toString('base64');
}
