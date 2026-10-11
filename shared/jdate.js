// تاریخ شمسی با کتابخانه jalaali-js (بدون تبدیل دستی)
import * as jalaali from 'jalaali-js';

const pad = (n) => String(n).padStart(2, '0');

export function gregorianToJString(gy, gm, gd) {
  const j = jalaali.toJalaali(gy, gm, gd);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

/** تاریخ «امروز» به وقت تهران. */
export function todayJalali(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  return gregorianToJString(parts[0], parts[1], parts[2]);
}

export function isValidJalaliString(s) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s || '');
  return !!m && jalaali.isValidJalaaliDate(+m[1], +m[2], +m[3]);
}
