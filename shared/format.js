// منطق مشترک بین سرور و مرورگر: ارقام، مبلغ به حروف، محاسبه جمع‌ها

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

/** هر رقم فارسی/عربی را به انگلیسی تبدیل می‌کند. */
export function toEnDigits(s) {
  return String(s ?? '')
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
}

/** هر رقم انگلیسی را به فارسی تبدیل می‌کند. */
export function toFaDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, (d) => FA[d]);
}

/** متن ورودی (با ارقام فارسی، جداکننده‌ها) را به عدد تبدیل می‌کند؛ نامعتبر → null. */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = toEnDigits(input).replace(/[,٬،\s]/g, '').replace(/[٫/]/g, '.');
  if (s === '' || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** عدد → رشته با ارقام فارسی و جداکننده هزارگان. */
export function formatNumber(n, { decimals = 4 } = {}) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  const num = Number(n);
  const neg = num < 0 ? '-' : '';
  const fixed = Math.abs(num).toFixed(decimals);
  let [int, frac = ''] = fixed.split('.');
  frac = frac.replace(/0+$/, '');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return toFaDigits(neg + int + (frac ? '.' + frac : '')).replace('.', '٫');
}

/** رشته شناسه/تلفن را با ارقام فارسی نمایش می‌دهد (بدون حذف صفر اول). */
export function formatDigitsText(s) {
  return toFaDigits(s ?? '');
}

// ---------- مبلغ به حروف ----------
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];

function below1000(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r >= 20) {
    parts.push(TENS[Math.floor(r / 10)]);
    if (r % 10) parts.push(ONES[r % 10]);
  } else if (r >= 10) parts.push(TEENS[r - 10]);
  else if (r) parts.push(ONES[r]);
  return parts.join(' و ');
}

// n < 1e9 : میلیون، هزار
function below1e9(n) {
  const parts = [];
  const m = Math.floor(n / 1e6);
  const t = Math.floor((n % 1e6) / 1000);
  const r = n % 1000;
  if (m) parts.push(below1000(m) + ' میلیون');
  if (t) parts.push(below1000(t) + ' هزار');
  if (r) parts.push(below1000(r));
  return parts.join(' و ');
}

/** عدد صحیح نامنفی → حروف (بدون «ریال»). مرتبه‌ها: هزار، میلیون، میلیارد، هزار میلیارد. */
export function numberToWords(n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n) || n < 0) throw new RangeError('عدد نامعتبر');
  if (n === 0) return 'صفر';
  if (n >= 1e9) {
    const big = Math.floor(n / 1e9); // تعداد میلیارد؛ مثلاً ۱۰۰۰ → «یک هزار میلیارد»
    const rest = n % 1e9;
    return below1e9(big) + ' میلیارد' + (rest ? ' و ' + below1e9(rest) : '');
  }
  return below1e9(n);
}

export function amountToWords(n) {
  return numberToWords(n) + ' ریال';
}

// ---------- محاسبات فاکتور ----------
export function lineTotal(qty, price) {
  return Math.round(Number(qty || 0) * Number(price || 0));
}

/** items: [{qty, unit_price}] */
export function calcTotals(items, discount = 0, taxPercent = 0) {
  const subtotal = items.reduce((s, it) => s + lineTotal(it.qty, it.unit_price), 0);
  const disc = Math.round(Number(discount) || 0);
  const taxable = subtotal - disc;
  const taxAmount = Math.round(taxable * (Number(taxPercent) || 0) / 100);
  return { subtotal, discount: disc, taxPercent: Number(taxPercent) || 0, taxAmount, payable: taxable + taxAmount };
}

// ---------- کدها ----------
export const GROUPS = { 1: 'پروفیل‌ها', 2: 'اتصالات', 3: 'پیچ‌ها', 4: 'مواد شیمیایی', 5: 'توری‌ها' };

/** گروه از روی رقم صدگان کد. */
export function groupOfCode(code) {
  const n = Number(toEnDigits(code));
  if (!Number.isFinite(n)) return 'سایر';
  const h = Math.floor(n / 100);
  return GROUPS[h] ? `${toFaDigits(h * 100)} - ${GROUPS[h]}` : 'سایر';
}

/** نگارش یکدست: × به‌جای x بین ارقام، M بزرگ در پیچ. */
export function normalizeText(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\d)\s*[xX]\s*(\d)/g, '$1×$2')
    .replace(/([۰-۹])\s*[xX]\s*([۰-۹])/g, '$1×$2')
    .replace(/\bm(\d)/g, 'M$1');
}

export const isValidJDate = (s) => /^\d{4}\/\d{2}\/\d{2}$/.test(s || '');
