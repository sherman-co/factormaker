import fs from 'node:fs';
import { toFaDigits, formatNumber, formatDigitsText, lineTotal } from '../shared/format.js';
import { fontCss, FONT_STACK } from './fonts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const BASE_ROWS = 14;      // ردیف‌های ثابت طراحی
export const MAX_SINGLE = 25;     // بیش از این → صفحه دوم
const ROW_MM = 6.2;
const PAGE_MM = 193;
const TOP_FIXED_MM = 13 + 13.5 * 2 + 1.6 * 5 + 5.8 + 6; // سربرگ + دو کادر + فاصله‌ها + نوار عنوان و سرستون
const SAFETY_MM = 2;

/** ارتفاع تقریبی بخش پایین (جمع‌ها + توضیحات + مهر) به میلی‌متر. */
function footerMm(d) {
  const t = d.totals;
  const rows = 1 + (t.discount > 0 || t.taxPercent > 0 ? 1 : 0) + (t.discount > 0 ? 1 : 0) + (t.taxPercent > 0 ? 2 : 0);
  const wordLines = Math.ceil(([...String(d.words)].length + 16) / 62);
  const totals = Math.max(rows * 5.4, 3 + wordLines * 4.9);
  const noteLines = Math.min(5, String(d.notes || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(([...l].length + 8) / 180)), 0));
  const notes = Math.max(7, 2.6 + noteLines * 4.6);
  return totals + notes + 18 + 1.6 * 2 + 1;
}

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

/** تقسیم ردیف‌ها به صفحه‌ها: تا ۲۵ ردیف تک‌صفحه؛ بیشتر → صفحه‌های بعدی، آخرین صفحه حداکثر ۱۴ ردیف (برای جمع‌ها). */
export function paginate(n) {
  if (n <= MAX_SINGLE) return [n];
  const pages = [];
  let rem = n;
  while (rem > MAX_SINGLE) { pages.push(MAX_SINGLE); rem -= MAX_SINGLE; }
  if (rem > BASE_ROWS) { pages.push(rem - BASE_ROWS); rem = BASE_ROWS; }
  pages.push(rem);
  return pages;
}

function fitFont(text, capacity, fs) {
  const len = [...String(text)].length;
  return len > capacity ? Math.max(5.5, fs * capacity / len) : fs;
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
const blankRow = (cols, rowMm) => `<tr style="height:${rowMm}mm">${cols.map(() => '<td>&nbsp;</td>').join('')}</tr>`;

function headerBlock(d) {
  return `<div class="hdr">
  <div class="hc company">${esc(d.company_title)}</div>
  <div class="hc title">${esc(d.invoice_title)}</div>
  <div class="hc meta"><table><tr><td class="lbl">شماره فاکتور:</td><td class="val">${toFaDigits(d.number)}</td></tr>
    <tr><td class="lbl">تاریخ:</td><td class="val">${toFaDigits(d.jdate)}</td></tr></table></div>
</div>`;
}

function party(title, p, second) {
  return `<div class="party"><div class="vt"><span>${title.replace(' ', '<br>')}</span></div><div class="pbody">
    <div class="prow"><div class="pc w5"><b>نام شخص حقیقی / حقوقی:</b> ${esc(p.name)}</div>
      <div class="pc w3"><b>شناسه ملی:</b> <span>${formatDigitsText(esc(p.national_id))}</span></div>
      <div class="pc w2 last"><b>تلفن تماس:</b> <span>${formatDigitsText(esc(p.phone))}</span></div></div>
    <div class="prow">${second}</div></div></div>`;
}

function totalsBlock(d, cols) {
  const t = d.totals;
  const rows = [];
  const hasExtra = t.discount > 0 || t.taxPercent > 0;
  if (hasExtra) rows.push(['جمع کل:', t.subtotal]);
  if (t.discount > 0) rows.push(['تخفیف:', t.discount]);
  if (t.taxPercent > 0) {
    rows.push(['درصد مالیات:', null, `${formatNumber(t.taxPercent)}٪`]);
    rows.push(['مبلغ مالیات:', t.taxAmount]);
  }
  rows.push(['مبلغ قابل پرداخت:', t.payable, null, true]);
  const wordSpan = cols.findIndex((c) => c.k === 'price'); // ستون‌های قبل از «مبلغ واحد»
  const remarkW = cols[cols.length - 1].w;
  const body = rows.map((r, i) => {
    const bold = r[3] ? ' b' : '';
    const first = i === 0
      ? `<td class="words" colspan="${wordSpan}" rowspan="${rows.length}"><b>جمع کل (حروف):</b> ${esc(d.words)}</td>` : '';
    const last = i === 0 ? `<td class="rem" rowspan="${rows.length}"></td>` : '';
    return `<tr>${first}<td class="tl${bold}">${r[0]}</td><td class="tv${bold}">${r[2] ?? formatNumber(r[1])}</td>${last}</tr>`;
  }).join('');
  return `<table class="tot"><colgroup>${cols.map((c) => `<col style="width:${c.w}mm">`).join('')}</colgroup>${body}</table>`;
}

function itemsTable(d, cols, rows, startIdx, { first, rowMm, fs, padTo, titleSuffix }) {
  const head = { row: 'ردیف', code: 'کد کالا', desc: 'شرح کالا یا خدمات', qty: 'مقدار', unit: 'واحد', price: 'مبلغ واحد (ریال)', total: 'مبلغ کل (ریال)', remark: 'توضیحات' };
  let body = rows.map((it, i) => itemRow(it, startIdx + i + 1, cols, fs, rowMm)).join('');
  for (let i = rows.length; i < padTo; i++) body += blankRow(cols, rowMm);
  return `<table class="items" style="font-size:${fs}pt"><colgroup>${cols.map((c) => `<col style="width:${c.w}mm">`).join('')}</colgroup>
  <tr class="ttl"><td colspan="${cols.length}">مشخصات کالا یا خدمات مورد معامله${titleSuffix || ''}</td></tr>
  <tr class="hd">${cols.map((c) => `<td>${head[c.k]}</td>`).join('')}</tr>${body}</table>`;
}

const CSS = `
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${FONT_STACK};font-size:9pt;color:#000;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:281mm;height:193mm;overflow:hidden;position:relative;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.gap{height:1.6mm}
.hdr{display:flex;height:13mm;border:1.4pt solid #000}
.hc{display:flex;align-items:center;justify-content:center;border-left:.5pt solid #000}
.hc:last-child{border-left:0}
.company{width:70mm;font-size:11pt;font-weight:700}
.title{flex:1;font-size:15pt;font-weight:700}
.meta{width:70mm;padding:0}
.meta table{width:100%;height:100%;border-collapse:collapse}
.meta td{padding:0 2mm;font-size:9.5pt;height:50%}
.meta .lbl{text-align:right;width:50%}.meta .val{text-align:left}
.meta tr+tr td{border-top:.5pt solid #000}
.party{display:flex;border:1.4pt solid #000;height:13.5mm}
.vt{width:9mm;flex:none;border-left:.5pt solid #000;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:7.5pt;overflow:hidden;background:#fff}
.vt span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;line-height:1.25;text-align:center}
.pbody{flex:1;display:flex;flex-direction:column}
.prow{flex:1;display:flex;align-items:center}
.prow+.prow{border-top:.5pt solid #000}
.pc{padding:0 2mm;height:100%;display:flex;align-items:center;gap:1.5mm;border-left:.5pt solid #000;white-space:nowrap;overflow:hidden}
.pc.last{border-left:0}.pc.full{flex:1;border-left:0;white-space:normal}
.w5{flex:5}.w3{flex:3}.w2{flex:2}
.pc b{font-weight:700}
table{border-collapse:collapse}
.items{width:281mm;table-layout:fixed;border:1.4pt solid #000}
.items td{border:.4pt solid #000;padding:0 1.5mm;line-height:1.1;overflow:hidden;white-space:nowrap}
.items td.c{text-align:center}.items td.r{text-align:right}
.items tr.ttl td{background:#D6DCE4;text-align:center;font-weight:700;height:5.8mm;font-size:9.5pt;border-bottom:.8pt solid #000}
.items tr.hd td{text-align:center;font-weight:700;height:6mm}
.tot{width:281mm;table-layout:fixed;border:1.4pt solid #000}
.tot td{border:0;padding:0 1.5mm;height:5.4mm;line-height:1.1}
.tot td.words{vertical-align:top;padding:1.5mm 2mm;white-space:normal;line-height:1.5;font-size:9.5pt;min-height:11mm}
.tot td.tl{text-align:right;border-right:.4pt solid #000;border-left:.4pt solid #000}
.tot td.tv{text-align:center;border-left:.4pt solid #000}
.tot td.b{font-weight:700;font-size:10pt}
.notes{border:1.4pt solid #000;min-height:7mm;max-height:26mm;overflow:hidden;padding:1.2mm 2mm;line-height:1.5;white-space:pre-wrap}
.sign{display:flex;border:1.4pt solid #000;height:18mm}
.sign>div{flex:1;padding:1.2mm 2mm;position:relative;font-weight:700}
.sign>div+div{border-right:.5pt solid #000}
.sign img{position:absolute;max-height:15mm;max-width:38mm;top:1.5mm;right:25mm;mix-blend-mode:multiply;opacity:.92}
`;

/**
 * d = { number, jdate, company_title, invoice_title, seller{name,national_id,phone,address},
 *       buyer{name,national_id,phone,address,reg_no}, items[], totals, words, notes, show_code, stamp_data_uri }
 */
export function renderInvoiceHtml(d, { embedFonts = false } = {}) {
  const cols = COLS(!!d.show_code);
  const items = d.items;
  const pages = paginate(items.length);
  const single = pages.length === 1;
  const sellerBox = party('مشخصات فروشنده', d.seller, `<div class="pc full"><b>نشانی:</b> ${esc(d.seller.address)}</div>`);
  const buyerBox = party('مشخصات خریدار', d.buyer,
    `<div class="pc w5 full" style="flex:8"><b>نشانی:</b> ${esc(d.buyer.address)}</div><div class="pc w2" style="flex:3;border-right:.5pt solid #000;border-left:0"><b>شماره ثبت:</b> ${formatDigitsText(esc(d.buyer.reg_no))}</div>`);
  const stampImg = d.stamp_data_uri ? `<img src="${d.stamp_data_uri}" alt="">` : '';
  const footer = `${totalsBlock(d, cols)}<div class="gap"></div>
    <div class="notes"><b>توضیحات:</b> ${esc(d.notes)}</div><div class="gap"></div>
    <div class="sign"><div>مهر و امضاء فروشنده:${stampImg}</div><div>مهر و امضاء خریدار:</div></div>`;

  let out = '';
  let start = 0;
  pages.forEach((count, pi) => {
    const rows = items.slice(start, start + count);
    const isFirst = pi === 0;
    const isLast = pi === pages.length - 1;
    let rowMm = ROW_MM;
    let padTo = 0;
    if (single) {
      padTo = Math.max(BASE_ROWS, rows.length);
      rowMm = Math.min(ROW_MM, (PAGE_MM - TOP_FIXED_MM - footerMm(d) - SAFETY_MM) / padTo);
    } else {
      const used = (isFirst ? TOP_FIXED_MM : 11.8 + 1.6) + (isLast ? footerMm(d) : 0);
      rowMm = Math.min(ROW_MM, (PAGE_MM - used - SAFETY_MM - 3) / count);
      padTo = isLast ? Math.max(count, BASE_ROWS) : count;
      if (isLast) rowMm = Math.min(rowMm, (PAGE_MM - used - SAFETY_MM - 3) / padTo);
    }
    rowMm = Math.max(rowMm, 3.2);
    const fs = Math.min(9, Math.max(6, rowMm * 1.55));
    out += `<div class="page">`;
    if (isFirst) out += `${headerBlock(d)}<div class="gap"></div>${sellerBox}<div class="gap"></div>${buyerBox}<div class="gap"></div>`;
    out += itemsTable(d, cols, rows, start, { first: isFirst, rowMm, fs, padTo, titleSuffix: isFirst ? '' : ` — ادامه (فاکتور شماره ${toFaDigits(d.number)})` });
    out += `<div class="gap"></div>`;
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
