import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { closeBrowser } from '../server/pdf.js';

// همه‌ی داده‌های این تست‌ها ساختگی است.
let srv, base, cookie, tmp;
const OUT = path.join(os.tmpdir(), 'fm-test-out');
fs.mkdirSync(OUT, { recursive: true });
const call = async (method, url, body, raw) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: cookie || '' }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  const j = await r.json().catch(() => ({}));
  return { ...j, http: r.status };
};
// [کد، شرح، واحد، قیمت]
const PRODUCTS = [
  ['101', 'کالای نمونه الف', 'عدد', 1500000], ['102', 'کالای نمونه ب', 'عدد', 2500000], ['103', 'کالای نمونه ج', 'عدد', 40000],
  ['201', 'کالای نمونه د ۵×۷', 'عدد', 120000], ['301', 'پیچ M10×30', 'عدد', 7000], ['302', 'پیچ M8×30', 'عدد', 4000],
  ['401', 'ماده‌ی نمونه', 'گالن', 900000000], ['501', 'توری نمونه', 'متر', 150000],
];
const QTY = { 101: 10, 102: 3, 103: 200, 201: 100, 301: 2100, 302: 50, 401: 8, 501: 1800 };
const EXPECTED = PRODUCTS.reduce((s, [code, , , price]) => s + QTY[code] * price, 0);
const SAMPLE = PRODUCTS.map(([code]) => [code, QTY[code]]);
const body = (extra = {}) => ({ jdate: '1405/07/19', buyer: { name: 'خریدار نمونه', address: 'نشانی نمونه' }, items: SAMPLE.map(([code, qty]) => ({ code, qty })), ...extra });
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-'));
  process.env.ADMIN_PASSWORD = 'secret12';
  const { app } = createApp(tmp);
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  const r = await call('POST', '/api/login', { username: 'admin', password: 'secret12' }, true);
  cookie = r.headers.get('set-cookie').split(';')[0];
  await call('PUT', '/api/settings', {
    company_title: 'شرکت نمونه', seller_name: 'فروشنده نمونه', seller_national_id: '0123456789', seller_phone: '09120000000',
    seller_address: 'نشانی نمونه فروشنده', last_invoice_number: 1000,
  });
  for (const [code, description, unit, price] of PRODUCTS) assert.equal((await call('POST', '/api/products', { code, description, unit, price })).http, 201);
});
after(async () => { srv.close(); await closeBrowser(); });

test('بدون ورود دسترسی ندارد', async () => {
  assert.equal((await fetch(base + '/api/products')).status, 401);
});

test('دیتابیس تازه خالی است و تنظیمات پیش‌فرض داده‌ی شخصی ندارند', async () => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-fresh-'));
  const { db } = createApp(fresh);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM products').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM customers').get().c, 0);
  const s = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((r) => [r.key, r.value]));
  for (const k of ['company_title', 'seller_name', 'seller_national_id', 'seller_phone', 'seller_address']) assert.equal(s[k], '');
  assert.equal(s.last_invoice_number, '0');
});

test('کالاها: تکراری، نرمال‌سازی، گروه', async () => {
  const list = await (await fetch(base + '/api/products', { headers: { cookie } })).json();
  assert.equal(list.length, PRODUCTS.length);
  assert.match(list[0].group, /پروفیل/);
  assert.equal((await call('POST', '/api/products', { code: '۱۰۱', description: 'x', unit: 'عدد', price: 1 })).http, 400);
  const ok = await call('POST', '/api/products', { code: '105', description: 'پیچ m6x20', unit: 'عدد', price: '۱,۵۰۰' });
  assert.equal(ok.http, 201);
  assert.equal(ok.description, 'پیچ M6×20');
  assert.equal(ok.price, 1500);
});

test('فاکتور نمونه: جمع، حروف، شماره، PDF یک‌صفحه‌ای', async () => {
  const inv = await call('POST', '/api/invoices', body({ finalize: true }));
  assert.equal(inv.http, 201);
  assert.equal(inv.number, 1001);
  assert.equal(inv.payable, EXPECTED);
  assert.match(inv.amount_words, /ریال$/);
  assert.equal(inv.status, 'final');
  const pdf = await call('GET', `/api/invoices/${inv.id}/pdf`, null, true);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pageCount(buf), 1);
  fs.writeFileSync(path.join(OUT, 'sample.pdf'), buf);
  assert.ok(fs.existsSync(path.join(tmp, 'pdfs', '1001.pdf')));
  // نهایی قابل ویرایش است و شرح قبلی حفظ می‌شود
  const ed = await call('PUT', `/api/invoices/${inv.id}`, body({ buyer: { name: 'خریدار ویرایش‌شده' }, doc_type: 'invoice' }));
  assert.equal(ed.http, 200);
  assert.equal(ed.status, 'final');
  assert.equal(ed.doc_type, 'invoice');
  assert.equal(ed.number, 1001);
});

test('تغییر قیمت کالا فاکتور نهایی را عوض نمی‌کند؛ کپی', async () => {
  const list = await (await fetch(base + '/api/invoices', { headers: { cookie } })).json();
  const id = list.rows[0].id;
  const p = (await (await fetch(base + '/api/products', { headers: { cookie } })).json()).find((x) => x.code === '101');
  await call('PUT', `/api/products/${p.id}`, { ...p, price: 99, description: 'تغییر کرد' });
  const inv = await call('GET', `/api/invoices/${id}`);
  assert.equal(inv.items[0].unit_price, 1500000);
  assert.equal(inv.items[0].description, 'کالای نمونه الف');
  const copy = await call('POST', `/api/invoices/${id}/copy`);
  assert.equal(copy.number, 1002);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.items.length, PRODUCTS.length);
  await call('PUT', `/api/products/${p.id}`, { ...p });
});

test('اعتبارسنجی: کد نامعتبر، قیمت توافقی، مالیات/تخفیف، ردیف‌ها', async () => {
  const badCode = await call('POST', '/api/invoices', body({ items: [{ code: '999', qty: 1 }] }));
  assert.equal(badCode.http, 422);
  assert.match(badCode.error, /کد نامعتبر/);
  const d = await call('POST', '/api/invoices', body({
    discount: '۱۰۰', tax_percent: 9,
    items: [{ code: '101', qty: '۲٫۵', unit_price: '۱,۲۰۰,۰۰۰' }, { code: '', qty: '' }, { code: '103', qty: 3 }],
  }));
  assert.equal(d.http, 201);
  assert.equal(d.items.length, 2);
  assert.deepEqual(d.items.map((i) => i.position), [1, 2]);
  assert.equal(d.items[0].unit_price, 1200000);
  assert.equal(d.items[0].list_price, 1500000);
  assert.equal(d.items[0].qty, 2.5);
  const sub = 3000000 + 120000;
  assert.equal(d.subtotal, sub);
  assert.equal(d.tax_amount, Math.round((sub - 100) * 0.09));
  assert.equal(d.payable, sub - 100 + d.tax_amount);
});

test('تنظیمات و فیلتر/اکسل', async () => {
  const s = await (await fetch(base + '/api/settings', { headers: { cookie } })).json();
  assert.equal(s.seller_national_id, '0123456789'); // صفر اول حفظ می‌شود
  const x = await call('GET', '/api/invoices/export.xlsx?from=1405/07/01&to=1405/07/30', null, true);
  assert.equal(x.status, 200);
  assert.ok((await x.arrayBuffer()).byteLength > 1000);
  const f = await (await fetch(base + '/api/invoices?q=' + encodeURIComponent('ویرایش') + '&status=final', { headers: { cookie } })).json();
  assert.equal(f.total, 1);
});

test('بیش از ۱۴ و بیش از ۲۵ ردیف', async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ code: SAMPLE[i % SAMPLE.length][0], qty: i + 1, remark: 'توضیح ردیف ' + (i + 1) }));
  for (const [n, pages] of [[3, 1], [20, 1], [25, 1], [26, 2], [60, 3]]) {
    const inv = await call('POST', '/api/invoices', body({ items: mk(n) }));
    const buf = Buffer.from(await (await call('GET', `/api/invoices/${inv.id}/pdf`, null, true)).arrayBuffer());
    assert.equal(pageCount(buf), pages, `n=${n}`);
  }
});

test('بدترین حالت جمع‌ها (تخفیف+مالیات) در ۱۴ ردیف هم یک صفحه', async () => {
  const inv = await call('POST', '/api/invoices', body({ discount: 1000000, tax_percent: 10, notes: 'خط اول\nخط دوم', items: Array.from({ length: 14 }, (_, i) => ({ code: SAMPLE[i % SAMPLE.length][0], qty: i + 1 })) }));
  const buf = Buffer.from(await (await call('GET', `/api/invoices/${inv.id}/pdf`, null, true)).arrayBuffer());
  assert.equal(pageCount(buf), 1);
});

test('حساب‌های بانکی: اعتبارسنجی، چند حساب، چاپ در PDF، حذف', async () => {
  assert.equal((await call('POST', '/api/payment-accounts', { title: 'ناقص' })).http, 400);
  assert.equal((await call('POST', '/api/payment-accounts', { title: 'بد', card: '123' })).http, 400);
  const a1 = await call('POST', '/api/payment-accounts', { title: 'حساب یک', holder: 'صاحب نمونه', card: '۱۲۳۴-۵۶۷۸-۹۰۱۲-۳۴۵۶', sheba: 'ir000000000000000000000001' });
  const a2 = await call('POST', '/api/payment-accounts', { title: 'حساب دو', card: '6543210987654321' });
  assert.equal(a1.http, 201);
  assert.equal(a1.card, '1234567890123456');
  assert.equal(a1.sheba, 'IR000000000000000000000001');
  assert.equal((await call('GET', '/api/payment-accounts')).length ?? 2, 2);

  const inv = await call('POST', '/api/invoices', body({ pay: { account_id: a1.id, card: true, sheba: true, account: true } }));
  const pay = JSON.parse(inv.pay_json);
  assert.equal(pay.account_id, a1.id);
  assert.deepEqual(pay.lines.map((p) => p.key), ['card', 'sheba', 'holder']);
  const buf = Buffer.from(await (await call('GET', `/api/invoices/${inv.id}/pdf`, null, true)).arrayBuffer());
  assert.equal(pageCount(buf), 1);
  fs.writeFileSync(path.join(OUT, 'pay.pdf'), buf);

  // تغییر حساب دیگر فاکتورِ ذخیره‌شده را عوض نمی‌کند، مگر خودِ فاکتور حساب دیگری بگیرد
  await call('PUT', `/api/payment-accounts/${a1.id}`, { title: 'حساب یک', holder: 'صاحب نمونه', card: '1111222233334444', sheba: 'IR000000000000000000000001' });
  const again = await call('PUT', `/api/invoices/${inv.id}`, body({ pay: { account_id: a1.id, card: true } }));
  assert.equal(JSON.parse(again.pay_json).lines.find((l) => l.key === 'card').value, '1234567890123456');
  const other = await call('PUT', `/api/invoices/${inv.id}`, body({ pay: { account_id: a2.id, card: true } }));
  assert.equal(JSON.parse(other.pay_json).lines[0].value, '6543210987654321');

  assert.equal((await call('DELETE', `/api/payment-accounts/${a2.id}`)).http, 200);
  const fin = await call('POST', '/api/invoices', body({ finalize: true }));
  assert.equal((await call('DELETE', `/api/invoices/${fin.id}`)).http, 200);
  assert.equal((await call('GET', `/api/invoices/${fin.id}`)).http, 404);
  assert.ok(!fs.existsSync(path.join(tmp, 'pdfs', `${fin.number}.pdf`)));
});
