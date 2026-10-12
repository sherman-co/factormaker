import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { closeBrowser } from '../server/pdf.js';

// قاعده‌ی مهم: تغییر کالا/قیمت/فروشنده هیچ‌وقت فاکتورهای قبلی را عوض نمی‌کند
let srv; let base; let cookie; let tmp;
const call = async (method, url, body, raw) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: cookie || '' }, body: body ? JSON.stringify(body) : undefined });
  return raw ? r : { ...(await r.json().catch(() => ({}))), http: r.status };
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-snap-'));
  process.env.ADMIN_PASSWORD = 'secret12';
  const { app } = createApp(tmp);
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  cookie = (await call('POST', '/api/login', { username: 'admin', password: 'secret12' }, true)).headers.get('set-cookie').split(';')[0];
  await call('PUT', '/api/settings', { seller_name: 'فروشنده قدیمی', seller_phone: '0911', company_title: 'شرکت قدیمی' });
  await call('POST', '/api/products', { code: '101', description: 'کالای قدیمی', unit: 'عدد', price: 1000 });
  await call('POST', '/api/products', { code: '102', description: 'کالای دوم', unit: 'متر', price: 5000 });
});
after(async () => { srv.close(); await closeBrowser(); });

const items = [{ code: '101', qty: 3 }, { code: '102', qty: 2 }];
const body = (extra = {}) => ({ jdate: '1405/07/20', buyer: { name: 'خریدار' }, items, ...extra });
const rowsOf = (inv) => inv.items.map((i) => [i.product_code, i.description, i.unit, i.unit_price, i.list_price, i.line_total]);

test('بعد از تغییر کالا و قیمت، فاکتور نهایی و پیش‌نویس و PDF قبلی عوض نمی‌شوند', async () => {
  const fin = await call('POST', '/api/invoices', body({ finalize: true }));
  const draft = await call('POST', '/api/invoices', body());
  const finRows = rowsOf(fin); const draftRows = rowsOf(draft);

  // قیمت، شرح و واحد کالا و مشخصات فروشنده عوض می‌شود
  const prods = await (await call('GET', '/api/products', null, true)).json();
  for (const p of prods) await call('PUT', `/api/products/${p.id}`, { ...p, price: p.price * 10, description: p.description + ' (جدید)', unit: 'کیلو' });
  await call('PUT', '/api/settings', { seller_name: 'فروشنده‌ی جدید', company_title: 'شرکت جدید' });

  const finAfter = await call('GET', `/api/invoices/${fin.id}`);
  assert.deepEqual(rowsOf(finAfter), finRows);
  assert.equal(finAfter.payable, fin.payable);
  assert.equal(finAfter.seller.name, 'فروشنده قدیمی');
  assert.deepEqual(rowsOf(await call('GET', `/api/invoices/${draft.id}`)), draftRows);

  // ذخیره‌ی دوباره (بدون تغییر ردیف‌ها) هم شرح/واحد/قیمت را عوض نمی‌کند، چه نهایی چه پیش‌نویس
  const sameBody = (inv) => body({ items: inv.items.map((i) => ({ code: i.product_code, qty: i.qty, unit_price: i.unit_price })) });
  const finSaved = await call('PUT', `/api/invoices/${fin.id}`, sameBody(fin));
  assert.deepEqual(rowsOf(finSaved), finRows);
  const draftSaved = await call('PUT', `/api/invoices/${draft.id}`, sameBody(draft));
  assert.deepEqual(rowsOf(draftSaved), draftRows, 'پیش‌نویس ذخیره‌شده‌ی قبلی هم باید شرح/واحد قبلی را نگه دارد');
  assert.equal(draftSaved.payable, draft.payable);

  assert.ok(fs.existsSync(path.join(tmp, 'pdfs', `${fin.number}.pdf`)));
  // فاکتور جدید با قیمت جدید ساخته می‌شود
  const fresh = await call('POST', '/api/invoices', body());
  assert.equal(fresh.items[0].unit_price, 10000);
  assert.equal(fresh.items[0].description, 'کالای قدیمی (جدید)');
  // کپی از فاکتور قدیمی همان قیمت قدیمی را دارد (کپی از روی نسخه‌ی ذخیره‌شده)
  const copy = await call('POST', `/api/invoices/${fin.id}/copy`);
  assert.deepEqual(rowsOf(copy).map((r) => r[3]), finRows.map((r) => r[3]));
});

test('کالای غیرفعال یا حذف‌شده، فاکتور قدیمی را خراب نمی‌کند', async () => {
  const fin = await call('POST', '/api/invoices', body({ finalize: true, items: [{ code: '102', qty: 1 }] }));
  const p = (await (await call('GET', '/api/products', null, true)).json()).find((x) => x.code === '102');
  await call('PUT', `/api/products/${p.id}`, { ...p, active: false });
  assert.equal((await call('DELETE', `/api/products/${p.id}`)).http, 409); // استفاده‌شده در فاکتور؛ حذف نمی‌شود
  const edit = await call('PUT', `/api/invoices/${fin.id}`, body({ items: [{ code: '102', qty: 4, unit_price: fin.items[0].unit_price }] }));
  assert.equal(edit.http, 200); // ویرایش فاکتور قدیمی با کالای غیرفعال‌شده مجاز است
  assert.equal(edit.items[0].description, fin.items[0].description);
});
