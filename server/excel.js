import ExcelJS from 'exceljs';
import { toEnDigits, parseNumber, groupOfCode } from '../shared/format.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { XLSX_MIME };

const rtlSheet = (wb, name, extra = {}) => wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }], ...extra });
const toBuffer = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());
const headStyle = (ws) => {
  const r = ws.getRow(1);
  r.font = { bold: true };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6DCE4' } };
};

export async function buildInvoicesXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = rtlSheet(wb, 'فاکتورها');
  ws.columns = [
    { header: 'شماره', key: 'number', width: 12 }, { header: 'نوع', key: 'type', width: 12 }, { header: 'تاریخ', key: 'jdate', width: 12 },
    { header: 'خریدار', key: 'buyer_name', width: 28 }, { header: 'شناسه ملی خریدار', key: 'nid', width: 18 },
    { header: 'جمع کل (ریال)', key: 'subtotal', width: 20 }, { header: 'تخفیف (ریال)', key: 'discount', width: 16 },
    { header: 'مالیات (ریال)', key: 'tax_amount', width: 16 }, { header: 'مبلغ قابل پرداخت (ریال)', key: 'payable', width: 24 },
    { header: 'وضعیت', key: 'status', width: 10 },
  ];
  headStyle(ws);
  for (const r of rows) {
    ws.addRow({ ...r, type: r.doc_type === 'invoice' ? 'فاکتور' : 'پیش‌فاکتور', nid: r.buyer_national_id, status: r.status === 'final' ? 'نهایی' : 'پیش‌نویس' });
  }
  for (const k of ['subtotal', 'discount', 'tax_amount', 'payable']) ws.getColumn(k).numFmt = '#,##0';
  ws.getColumn('nid').numFmt = '@';
  return toBuffer(wb);
}

const PRODUCT_COLUMNS = [
  { header: 'کد کالا', key: 'code', width: 12 }, { header: 'شرح کالا', key: 'description', width: 44 }, { header: 'واحد', key: 'unit', width: 12 },
  { header: 'مبلغ واحد (ریال)', key: 'price', width: 20 }, { header: 'فعال', key: 'active', width: 10 },
];

/** خروجی/نمونه با همان ستون‌هایی که ورود از Excel می‌خواند. */
export async function buildProductsXlsx(products) {
  const wb = new ExcelJS.Workbook();
  const ws = rtlSheet(wb, 'کالاها');
  ws.columns = [...PRODUCT_COLUMNS, { header: 'گروه', key: 'group', width: 18 }];
  headStyle(ws);
  for (const p of products) ws.addRow({ code: p.code, description: p.description, unit: p.unit, price: p.price, active: p.active ? 'بله' : 'خیر', group: groupOfCode(p.code) });
  ws.getColumn('price').numFmt = '#,##0';
  ws.getColumn('code').numFmt = '@';
  return toBuffer(wb);
}

/** فایل نمونه‌ی ساختگی برای ورود کالا. */
export async function buildProductsSample() {
  const wb = new ExcelJS.Workbook();
  const ws = rtlSheet(wb, 'کالاها');
  ws.columns = PRODUCT_COLUMNS;
  headStyle(ws);
  const rows = [
    ['101', 'پروفیل نمونه الف ۶ متری', 'شاخه', 1500000, 'بله'], ['102', 'پروفیل نمونه ب ۶ متری', 'شاخه', 2600000, 'بله'],
    ['103', 'نبشی نمونه ۵ سانتی‌متری', 'عدد', 45000, 'بله'], ['201', 'براکت نمونه ۵×۷ سانتی‌متر', 'عدد', 120000, 'بله'],
    ['202', 'کلیپس نمونه', 'عدد', 8500, 'بله'], ['301', 'پیچ M10×30', 'عدد', 3200, 'بله'],
    ['302', 'پیچ M8×30', 'عدد', 2100, 'بله'], ['401', 'ماده‌ی شیمیایی نمونه', 'گالن', 950000, 'بله'],
    ['501', 'توری نمونه درجه ۱', 'متر', 74000, 'بله'], ['601', 'فوم نمونه ۲ میلی‌متر', 'متر طول', 18000, 'بله'],
    ['999', 'کالای منسوخ نمونه', 'عدد', 1000, 'خیر'],
  ];
  for (const r of rows) ws.addRow(r);
  ws.getColumn('price').numFmt = '#,##0';
  ws.getColumn('code').numFmt = '@';
  const help = wb.addWorksheet('راهنما', { views: [{ rightToLeft: true }] });
  help.columns = [{ width: 100 }];
  for (const t of [
    'راهنمای ورود کالا از Excel',
    'ستون‌های لازم در ردیف اول: «کد کالا»، «شرح کالا»، «واحد»، «مبلغ واحد (ریال)»؛ ستون «فعال» اختیاری است (بله/خیر).',
    'کد باید عددی و حداقل ۳ رقم باشد؛ گروه از رقم صدگان کد تعیین می‌شود (۱۰۰ پروفیل‌ها، ۲۰۰ اتصالات، ۳۰۰ پیچ‌ها، ۴۰۰ مواد شیمیایی، ۵۰۰ توری‌ها، ۶۰۰ فوم و عایق‌ها).',
    'ارقام فارسی و انگلیسی و جداکننده‌ی هزارگان پذیرفته می‌شود. کدهای تکراری داخل فایل خطا حساب می‌شوند.',
    'همه‌ی داده‌های این فایل ساختگی است؛ ردیف‌ها را پاک کنید و کالاهای خودتان را بنویسید.',
  ]) help.addRow([t]);
  help.getRow(1).font = { bold: true };
  return toBuffer(wb);
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

const HEADERS = {
  code: (h) => /^کد/.test(h) || h === 'code',
  description: (h) => /شرح|نام کالا|^نام$|description/.test(h),
  unit: (h) => /^واحد$|unit/.test(h),
  price: (h) => /مبلغ|قیمت|price/.test(h),
  active: (h) => /^فعال|^وضعیت|active/.test(h),
};
const norm = (s) => toEnDigits(cellText(s)).replace(/\(.*?\)/g, '').replace(/[‌]/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim().toLowerCase();

/** خواندن ورک‌شیت اول: ردیف عنوان را در ۱۰ ردیف اول پیدا می‌کند. خروجی: {rows:[{row,code,description,unit,price,active}], error?} */
export async function parseProductsXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { return { error: 'فایل Excel معتبر نیست (فقط .xlsx)' }; }
  const ws = wb.worksheets[0];
  if (!ws) return { error: 'فایل Excel برگه‌ای ندارد' };
  let headerRow = 0; let cols = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const found = {};
    ws.getRow(r).eachCell((cell, c) => {
      const h = norm(cell.value);
      for (const [k, test] of Object.entries(HEADERS)) if (!(k in found) && test(h)) { found[k] = c; break; }
    });
    if ('code' in found && 'description' in found && 'price' in found) { headerRow = r; cols = found; }
  }
  if (!headerRow) return { error: 'ردیف عنوان پیدا نشد؛ ستون‌های «کد کالا»، «شرح کالا»، «واحد» و «مبلغ واحد (ریال)» لازم است (نمونه را دانلود کنید).' };
  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k) => (k in cols ? cellText(row.getCell(cols[k]).value).trim() : '');
    const item = { row: r, code: toEnDigits(get('code')).replace(/\s/g, ''), description: get('description'), unit: get('unit'), priceRaw: get('price'), activeRaw: get('active') };
    if (!item.code && !item.description && !item.priceRaw) continue;
    item.price = parseNumber(item.priceRaw);
    const a = norm(item.activeRaw);
    item.active = !a || !/^(خیر|غیرفعال|نه|0|false|no)$/.test(a);
    rows.push(item);
    if (rows.length > 5000) return { error: 'حداکثر ۵۰۰۰ ردیف در هر بار ورود مجاز است' };
  }
  return { rows };
}
