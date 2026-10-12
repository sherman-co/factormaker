import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zipSync } from 'fflate';
import { createApp } from '../server/app.js';
import { closeBrowser } from '../server/pdf.js';

const servers = [];
async function start(adminPassword) {
  process.env.ADMIN_PASSWORD = adminPassword;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-bk-'));
  const { app } = createApp(dir);
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const login = async (pw) => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: pw }) });
    return r.ok ? r.headers.get('set-cookie').split(';')[0] : null;
  };
  const cookie = await login(adminPassword);
  const call = async (method, url, body, raw) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return raw ? r : { ...(await r.json().catch(() => ({}))), http: r.status };
  };
  const restore = async (buf) => { const r = await fetch(base + '/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', cookie }, body: buf }); return { http: r.status, ...(await r.json()) }; };
  return { dir, base, cookie, call, login, restore };
}
after(async () => { for (const s of servers) s.close(); await closeBrowser(); });

let A; let zip;
before(async () => {
  A = await start('passA-1234');
  await A.call('PUT', '/api/settings', { seller_name: 'فروشنده‌ی بکاپ', last_invoice_number: 500, seller_phone: '0912' });
  await A.call('POST', '/api/products', { code: '101', description: 'کالای بکاپ', unit: 'عدد', price: 1234 });
  await A.call('POST', '/api/customers', { name: 'مشتری بکاپ', national_id: '0012345678' });
  await A.call('POST', '/api/groups', { code: 900, name: 'گروه من' });
  await A.call('POST', '/api/payment-accounts', { title: 'حساب', card: '6037000000000000' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await A.call('POST', '/api/settings/stamp', { data: 'data:image/png;base64,' + png.toString('base64') });
  await A.call('POST', '/api/change-password', { old_password: 'passA-1234', new_password: 'newPass-999' });
  A.cookie = await A.login('newPass-999');
  const call = async (m, u, b) => { const r = await fetch(A.base + u, { method: m, headers: { 'Content-Type': 'application/json', cookie: A.cookie }, body: b ? JSON.stringify(b) : undefined }); return { ...(await r.json().catch(() => ({}))), http: r.status }; };
  A.call = call;
  const inv = await call('POST', '/api/invoices', { jdate: '1405/07/20', buyer: { name: 'مشتری بکاپ' }, items: [{ code: '101', qty: 5 }], finalize: true, with_stamp: true });
  A.inv = inv;
  const r = await fetch(A.base + '/api/backup/full', { headers: { cookie: A.cookie } });
  assert.equal(r.headers.get('content-type'), 'application/zip');
  zip = Buffer.from(await r.arrayBuffer());
});

test('بکاپ کامل zip شامل دیتابیس، PDF و مهر است', async () => {
  const { unzipSync } = await import('fflate');
  const names = Object.keys(unzipSync(new Uint8Array(zip)));
  assert.ok(names.includes('factormaker.db'));
  assert.ok(names.some((n) => /^pdfs\/.*\.pdf$/.test(n)));
  assert.ok(names.some((n) => /^stamps\/.*\.png$/.test(n)));
});

test('بازیابی zip در نصب تازه: همه‌چیز (رمز، تنظیمات، کالا، فاکتور، PDF، مهر) برمی‌گردد', async () => {
  const B = await start('passB-1234');
  const before = await B.call('GET', '/api/data-info');
  assert.equal(before.invoices, 0);
  const r = await B.restore(zip);
  assert.equal(r.http, 200);
  assert.equal(r.invoices, 1); assert.equal(r.products, 1); assert.equal(r.customers, 1); assert.ok(r.files >= 2);
  // نشست قبلی باطل است؛ رمز نصب A معتبر است، رمز قبلی B نه
  assert.equal((await fetch(B.base + '/api/products', { headers: { cookie: B.cookie } })).status, 401);
  assert.equal(await B.login('passB-1234'), null);
  const cookie = await B.login('newPass-999');
  assert.ok(cookie);
  const get = async (u) => (await fetch(B.base + u, { headers: { cookie } })).json();
  assert.equal((await get('/api/settings')).seller_name, 'فروشنده‌ی بکاپ');
  assert.equal((await get('/api/products'))[0].price, 1234);
  assert.ok((await get('/api/groups')).some((g) => g.code === 900));
  assert.equal((await get('/api/payment-accounts')).length, 1);
  const inv = await get(`/api/invoices/${A.inv.id}`);
  assert.equal(inv.payable, A.inv.payable);
  assert.equal(inv.number, A.inv.number);
  const info = await get('/api/data-info');
  assert.equal(info.invoices, 1); assert.ok(info.pdfs >= 1);
  const pdf = await fetch(B.base + `/api/invoices/${A.inv.id}/pdf`, { headers: { cookie } });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok(fs.existsSync(path.join(B.dir, 'pdfs', `${A.inv.number}.pdf`)));
  assert.equal((await get('/api/settings')).has_stamp, true);
  // از وضعیت قبلی نصب B بکاپ خودکار ساخته شده
  assert.ok(fs.readdirSync(path.join(B.dir, 'backups')).some((f) => f.startsWith('before-restore')));
  // شماره‌گذاری از همان‌جا ادامه می‌یابد
  assert.equal((await (await fetch(B.base + '/api/invoices/next-number', { headers: { cookie } })).json()).number, A.inv.number + 1);
});

test('بازیابی فقط فایل .db (بدون PDF) و بکاپ نسخه‌ی قدیمی بدون ستون‌های جدید', async () => {
  // ۱) .db خام از همین نسخه
  const raw = await (await fetch(A.base + '/api/backup', { headers: { cookie: A.cookie } })).arrayBuffer();
  const B = await start('passB-1234');
  const r = await B.restore(Buffer.from(raw));
  assert.equal(r.http, 200); assert.equal(r.invoices, 1); assert.equal(r.files, 0);
  const cookie = await B.login('newPass-999');
  const pdf = await fetch(B.base + `/api/invoices/${A.inv.id}/pdf`, { headers: { cookie } }); // PDF نبود: از روی نسخه‌ی ذخیره‌شده دوباره ساخته می‌شود
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');

  // ۲) دیتابیس شبیه نسخه‌ی ۱.۰: بدون doc_type/pay_json/product_groups/payment_accounts و فیلدهای اضافی
  const old = path.join(os.tmpdir(), `fm-old-${Date.now()}.db`);
  const o = new DatabaseSync(old);
  o.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, salt TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, code TEXT, description TEXT, unit TEXT, price INTEGER, active INTEGER);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, national_id TEXT, phone TEXT, address TEXT, reg_no TEXT);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, number INTEGER, jdate TEXT, status TEXT, buyer_name TEXT, payable INTEGER, notes TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, position INTEGER, product_code TEXT, description TEXT, qty REAL, unit TEXT, unit_price INTEGER, list_price INTEGER, line_total INTEGER, remark TEXT);
    INSERT INTO settings VALUES ('seller_name','فروشنده‌ی قدیمی');
    INSERT INTO products VALUES (1,'555','کالای قدیمی','عدد',777,1);
    INSERT INTO invoices VALUES (1,169430,'1405/05/01','final','خریدار قدیمی',7770,'','2026-01-01','2026-01-01');
    INSERT INTO invoice_items VALUES (1,1,1,'555','کالای قدیمی',10,'عدد',777,777,7770,''), (2,99,1,'x','یتیم',1,'عدد',1,1,1,'');`);
  o.close();
  const C = await start('passC-1234');
  const r2 = await C.restore(fs.readFileSync(old));
  assert.equal(r2.http, 200); assert.equal(r2.invoices, 1);
  assert.ok(r2.defaultAdmin?.password, 'بکاپ کاربر نداشت؛ مدیر پیش‌فرض ساخته شد');
  const cookie2 = await C.login(r2.defaultAdmin.password);
  const get2 = async (u) => (await fetch(C.base + u, { headers: { cookie: cookie2 } })).json();
  const inv = await get2('/api/invoices/1');
  assert.equal(inv.number, 169430); assert.equal(inv.doc_type, 'proforma'); assert.equal(inv.items.length, 1); // ردیف یتیم حذف شد
  assert.equal((await get2('/api/settings')).seller_name, 'فروشنده‌ی قدیمی');
  assert.ok((await get2('/api/groups')).length >= 1); // دسته‌بندی‌های پیش‌فرض ساخته شد
  assert.equal((await get2('/api/products'))[0].group, '۵۰۰ - توری‌ها'); // کد ۵۵۵ ← گروه ۵۰۰ (دسته‌های پیش‌فرض بعد از بازیابی ساخته شد)
});

test('فایل نامعتبر رد می‌شود؛ مسیر خطرناک داخل zip نوشته نمی‌شود', async () => {
  const B = await start('passB-1234');
  assert.equal((await B.restore(Buffer.from('hello world, not a backup'))).http, 400);
  assert.equal((await B.restore(Buffer.from(zipSync({ 'a.txt': new Uint8Array([1]) })))).http, 400); // بدون factormaker.db
  const emptyDb = path.join(os.tmpdir(), `fm-empty-${Date.now()}.db`); new DatabaseSync(emptyDb).close();
  assert.equal((await B.restore(fs.readFileSync(emptyDb))).http, 400);
  // zip-slip
  const marker = path.join(os.tmpdir(), 'fm-evil.pdf'); fs.rmSync(marker, { force: true });
  const files = { 'factormaker.db': new Uint8Array(fs.readFileSync(path.join(A.dir, 'factormaker.db'))) };
  const raw = await (await fetch(A.base + '/api/backup', { headers: { cookie: A.cookie } })).arrayBuffer();
  files['factormaker.db'] = new Uint8Array(raw);
  files['../../fm-evil.pdf'] = new Uint8Array([1]); files['pdfs/../../fm-evil.pdf'] = new Uint8Array([1]); files['pdfs/ok.pdf'] = new Uint8Array([1, 2]);
  const r = await B.restore(Buffer.from(zipSync(files)));
  assert.equal(r.http, 200);
  assert.ok(!fs.existsSync(marker));
  assert.ok(fs.existsSync(path.join(B.dir, 'pdfs', 'ok.pdf')));
});
