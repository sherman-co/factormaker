// قالب نام فایل و متن (کپشن) ارسال؛ مشترک بین سرور و پیش‌نمایش زنده در تنظیمات
import { toFaDigits, formatNumber } from './format.js';

export const FILE_SEPARATORS = [' - ', '_', '-', ' '];
export const SHARE_MODES = { caption: 'متن زیر خود فایل (کپشن)', before: 'اول متن، بعد فایل (دو پیام جدا)', none: 'فقط فایل، بدون متن' };

export const SHARE_DEFAULTS = {
  share_file_type: '0', share_file_number: '1', share_file_date: '0', share_file_buyer: '1', share_file_sep: ' - ',
  share_cap_title: '1', share_cap_date: '0', share_cap_buyer: '1', share_cap_amount: '1', share_cap_extra: '', share_mode: 'caption',
};

const on = (v) => v === '1' || v === true || v === 1;

/** گزینه‌ها را از تنظیمات (رشته‌ای) بیرون می‌کشد. */
export function shareOptions(settings) {
  const g = (k) => settings[k] ?? SHARE_DEFAULTS[k];
  return {
    file: { type: on(g('share_file_type')), number: on(g('share_file_number')), date: on(g('share_file_date')), buyer: on(g('share_file_buyer')), sep: FILE_SEPARATORS.includes(g('share_file_sep')) ? g('share_file_sep') : ' - ' },
    cap: { title: on(g('share_cap_title')), date: on(g('share_cap_date')), buyer: on(g('share_cap_buyer')), amount: on(g('share_cap_amount')), extra: String(g('share_cap_extra') || '') },
    mode: SHARE_MODES[g('share_mode')] ? g('share_mode') : 'caption',
  };
}

const safe = (s) => String(s).replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/** d = { typeLabel, number, jdate, buyer, payable }. نام فایل با ارقام انگلیسی و تاریخ با خط تیره (کاراکتر / در نام فایل مجاز نیست). */
export function buildFileName(opt, d, ext = 'pdf') {
  const f = opt.file;
  const parts = [];
  if (f.type) parts.push(d.typeLabel);
  if (f.number) parts.push(String(d.number));
  if (f.date) parts.push(String(d.jdate).replace(/\//g, '-'));
  if (f.buyer && d.buyer) parts.push(d.buyer);
  const name = safe(parts.join(f.sep)).slice(0, 120) || safe(String(d.number)) || 'invoice';
  return `${name}.${ext}`;
}

export function buildCaption(opt, d) {
  const c = opt.cap;
  const lines = [];
  if (c.title) lines.push(`${d.typeLabel} شماره ${toFaDigits(d.number)}`);
  if (c.date) lines.push(`تاریخ: ${toFaDigits(d.jdate)}`);
  if (c.buyer && d.buyer) lines.push(`خریدار: ${d.buyer}`);
  if (c.amount) lines.push(`مبلغ قابل پرداخت: ${formatNumber(d.payable)} ریال`);
  if (c.extra.trim()) lines.push(c.extra.trim());
  return lines.join('\n');
}
