import test from 'node:test';
import assert from 'node:assert/strict';
import { amountToWords, calcTotals, parseNumber, formatNumber, toEnDigits, normalizeText, groupOfCode } from '../shared/format.js';
import { gregorianToJString, todayJalali } from '../shared/jdate.js';

test('تبدیل تاریخ', () => {
  assert.equal(gregorianToJString(2026, 10, 11), '1405/07/19');
  assert.equal(todayJalali(new Date('2026-10-11T12:00:00Z')), '1405/07/19');
  // نیمه‌شب تهران (UTC+3:30): ۲۰:۳۰ UTC روز قبل هنوز همان روز تهران نیست
  assert.equal(todayJalali(new Date('2026-10-10T21:00:00Z')), '1405/07/19');
});

test('مبلغ به حروف', () => {
  assert.equal(amountToWords(0), 'صفر ریال');
  assert.equal(amountToWords(1000), 'یک هزار ریال');
  assert.equal(amountToWords(100000), 'یکصد هزار ریال');
  assert.equal(amountToWords(55232100000), 'پنجاه و پنج میلیارد و دویست و سی و دو میلیون و یکصد هزار ریال');
  assert.equal(amountToWords(1500000000), 'یک میلیارد و پانصد میلیون ریال');
  assert.equal(amountToWords(1000000000000), 'یک هزار میلیارد ریال');
  assert.equal(amountToWords(12), 'دوازده ریال');
});

test('ارقام و اعداد', () => {
  assert.equal(parseNumber('۱,۲۳۴٫۵'), 1234.5);
  assert.equal(parseNumber('1٬500'), 1500);
  assert.equal(parseNumber('abc'), null);
  assert.equal(toEnDigits('۰۸۵۹'), '0859');
  assert.equal(formatNumber(32000000), '۳۲,۰۰۰,۰۰۰');
  assert.equal(normalizeText('پیچ m10x30'), 'پیچ M10×30');
  assert.equal(groupOfCode('۳۰۲'), '۳۰۰ - پیچ‌ها');
});

test('فاکتور نمونه', () => {
  const items = [[260, 32e6], [260, 69e6], [2100, 410000], [2100, 1380000], [2100, 77000], [2100, 44000],
    [15000, 390000], [16000, 69000], [35000, 25000], [8, 1.5e9], [1800, 1520000], [1800, 1330000]]
    .map(([qty, unit_price]) => ({ qty, unit_price }));
  const t = calcTotals(items, 0, 0);
  assert.equal(t.payable, 55232100000);
  assert.equal(calcTotals(items, 100, 9).taxAmount, Math.round((55232100000 - 100) * 0.09));
});
