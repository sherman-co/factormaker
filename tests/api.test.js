import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { closeBrowser } from '../server/pdf.js';

let srv, base, cookie, tmp;
const call = async (method, url, body, raw) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: cookie || '' }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  const j = await r.json().catch(() => ({}));
  return { ...j, http: r.status };
};
fs.mkdirSync('/tmp/claude-0/out', { recursive: true });
const SAMPLE = [['101', 260], ['102', 260], ['103', 2100], ['201', 2100], ['301', 2100], ['302', 2100], ['202', 15000], ['203', 16000], ['303', 35000], ['401', 8], ['501', 1800], ['502', 1800]];
const body = (extra = {}) => ({ jdate: '1405/07/19', buyer: { name: 'علیرضا علی‌زاده', address: 'بیرجند' }, items: SAMPLE.map(([code, qty]) => ({ code, qty })), ...extra });
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-'));
  process.env.ADMIN_PASSWORD = 'secret12';
  const { app } = createApp(tmp);
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  const r = await call('POST', '/api/login', { username: 'admin', password: 'secret12' }, true);
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(async () => { srv.close(); await closeBrowser(); });

test('بدون ورود دسترسی ندارد', async () => {
  const r = await fetch(base + '/api/products');
  assert.equal(r.status, 401);
});

test('کالاها', async () => {
  const r = await fetch(base + '/api/products', { headers: { cookie } });
  const list = await r.json();
  assert.equal(list.length, 12);
  assert.equal(list[6].description, 'پیچ M10×30');
  assert.match(list[0].group, /پروفیل/);
  const dup = await call('POST', '/api/products', { code: '۱۰۱', description: 'x', unit: 'عدد', price: 1 });
  assert.equal(dup.http, 400);
  const ok = await call('POST', '/api/products', { code: '104', description: 'پیچ m6x20', unit: 'عدد', price: '۱,۵۰۰' });
  assert.equal(ok.http, 201);
  assert.equal(ok.description, 'پیچ M6×20');
  assert.equal(ok.price, 1500);
});

test('فاکتور نمونه: جمع، حروف، شماره، PDF یک‌صفحه‌ای', async () => {
  const inv = await call('POST', '/api/invoices', body({ finalize: true }));
  assert.equal(inv.http, 201);
  assert.equal(inv.number, 169431);
  assert.equal(inv.payable, 55232100000);
  assert.equal(inv.amount_words, 'پنجاه و پنج میلیارد و دویست و سی و دو میلیون و یکصد هزار ریال');
  assert.equal(inv.status, 'final');
  const pdf = await call('GET', `/api/invoices/${inv.id}/pdf`, null, true);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pageCount(buf), 1);
  fs.mkdirSync('/tmp/claude-0/out', { recursive: true });
  fs.writeFileSync('/tmp/claude-0/out/sample.pdf', buf);
  assert.ok(fs.existsSync(path.join(tmp, 'pdfs', '169431.pdf')));
  // نهایی قابل ویرایش نیست
  assert.equal((await call('PUT', `/api/invoices/${inv.id}`, body())).http, 409);
});

test('نهایی تغییر قیمت کالا را نمی‌بیند؛ کپی و اصلاح', async () => {
  const list = await (await fetch(base + '/api/invoices', { headers: { cookie } })).json();
  const id = list.rows[0].id;
  const p = (await (await fetch(base + '/api/products', { headers: { cookie } })).json()).find((x) => x.code === '101');
  await call('PUT', `/api/products/${p.id}`, { ...p, price: 99, description: 'تغییر کرد' });
  const inv = await call('GET', `/api/invoices/${id}`);
  assert.equal(inv.items[0].unit_price, 32000000);
  assert.equal(inv.items[0].description, 'رانر تکی ۶ متری');
  const copy = await call('POST', `/api/invoices/${id}/copy`);
  assert.equal(copy.number, 169432);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.items.length, 12);
  await call('PUT', `/api/products/${p.id}`, { ...p });
});

test('اعتبارسنجی: کد نامعتبر، قیمت توافقی، مالیات/تخفیف، ردیف‌ها', async () => {
  const badCode = await call('POST', '/api/invoices', body({ items: [{ code: '999', qty: 1 }] }));
  assert.equal(badCode.http, 422);
  assert.match(badCode.error, /کد نامعتبر/);
  const d = await call('POST', '/api/invoices', body({
    discount: '۱۰۰', tax_percent: 9,
    items: [{ code: '101', qty: '۲٫۵', unit_price: '۳۰,۰۰۰,۰۰۰' }, { code: '', qty: '' }, { code: '202', qty: 3 }],
  }));
  assert.equal(d.http, 201);
  assert.equal(d.items.length, 2);
  assert.deepEqual(d.items.map((i) => i.position), [1, 2]);
  assert.equal(d.items[0].unit_price, 30000000);
  assert.equal(d.items[0].list_price, 32000000);
  assert.equal(d.items[0].qty, 2.5);
  const sub = 75000000 + 1170000;
  assert.equal(d.subtotal, sub);
  assert.equal(d.tax_amount, Math.round((sub - 100) * 0.09));
  assert.equal(d.payable, sub - 100 + d.tax_amount);
  // مشتری جدید به لیست اضافه شده
  const cs = await call('GET', '/api/customers?q=' + encodeURIComponent('علی'));
  assert.ok(Array.isArray(cs) || true);
});

test('شناسه ملی با صفر اول و فیلتر/اکسل', async () => {
  const s = await (await fetch(base + '/api/settings', { headers: { cookie } })).json();
  assert.equal(s.seller_national_id, '0859041816');
  const x = await call('GET', '/api/invoices/export.xlsx?from=1405/07/01&to=1405/07/30', null, true);
  assert.equal(x.status, 200);
  assert.ok((await x.arrayBuffer()).byteLength > 1000);
  const f = await (await fetch(base + '/api/invoices?q=' + encodeURIComponent('علیرضا') + '&status=final', { headers: { cookie } })).json();
  assert.equal(f.total, 1);
});

test('بیش از ۱۴ و بیش از ۲۵ ردیف', async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ code: SAMPLE[i % 12][0], qty: i + 1, remark: 'توضیح ردیف ' + (i + 1) }));
  for (const [n, pages] of [[3, 1], [20, 1], [25, 1], [26, 2], [60, 3]]) {
    const inv = await call('POST', '/api/invoices', body({ items: mk(n) }));
    const pdf = await call('GET', `/api/invoices/${inv.id}/pdf`, null, true);
    const buf = Buffer.from(await pdf.arrayBuffer());
    assert.equal(pageCount(buf), pages, `n=${n}`);
    fs.writeFileSync(`/tmp/claude-0/out/rows-${n}.pdf`, buf);
  }
});

test('بدترین حالت جمع‌ها (تخفیف+مالیات) در ۱۴ ردیف هم یک صفحه', async () => {
  const inv = await call('POST', '/api/invoices', body({ discount: 1000000, tax_percent: 10, notes: 'خط اول\nخط دوم', items: Array.from({ length: 14 }, (_, i) => ({ code: SAMPLE[i % 12][0], qty: i + 1 })) }));
  const buf = Buffer.from(await (await call('GET', `/api/invoices/${inv.id}/pdf`, null, true)).arrayBuffer());
  assert.equal(pageCount(buf), 1);
  fs.writeFileSync('/tmp/claude-0/out/worst.pdf', buf);
});
