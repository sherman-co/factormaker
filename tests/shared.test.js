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
  assert.equal(amountToWords(45321700000), 'چهل و پنج میلیارد و سیصد و بیست و یک میلیون و هفتصد هزار ریال');
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
  assert.equal(groupOfCode('999'), 'متفرقه');
  assert.equal(groupOfCode('1050', { 1000: 'ویژه' }), '۱۰۰۰ - ویژه');
});

test('محاسبه‌ی جمع‌ها', () => {
  const items = [{ qty: 10, unit_price: 1000000 }, { qty: 2.5, unit_price: 400000 }, { qty: 3, unit_price: 1234567 }];
  const t = calcTotals(items, 0, 0);
  assert.equal(t.subtotal, 10000000 + 1000000 + 3703701);
  assert.equal(t.payable, t.subtotal);
  const t2 = calcTotals(items, 100, 9);
  assert.equal(t2.taxAmount, Math.round((t.subtotal - 100) * 0.09));
  assert.equal(t2.payable, t.subtotal - 100 + t2.taxAmount);
});
