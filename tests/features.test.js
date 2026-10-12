import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import ExcelJS from 'exceljs';

// سرور ساختگی: هم API پیام‌رسان‌ها و هم GitHub (فقط برای آزمون)
const received = [];
let mock; let mockBase;
let app; let srv; let base; let cookie; let closeBrowser; let tmp;
const SECRET = 'SECRET-TOKEN-123';

before(async () => {
  mock = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (req.url.startsWith('/repos/')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'http://x/r', body: 'نکات', assets: [{ name: 'FactorMaker-win-x64.zip', size: 10, digest: 'sha256:00', browser_download_url: 'http://x/a.zip' }] }));
    }
    let fields = {};
    if ((req.headers['content-type'] || '').startsWith('multipart/')) {
      const fd = await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData();
      for (const [k, v] of fd.entries()) fields[k] = typeof v === 'string' ? v : { name: v.name, size: v.size };
    } else if (body.length) fields = JSON.parse(body.toString());
    received.push({ url: req.url, fields });
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('BADTOKEN')) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, description: 'Unauthorized: BADTOKEN is wrong' })); }
    res.end(JSON.stringify({ ok: true, result: {} }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockBase = `http://127.0.0.1:${mock.address().port}`;
  process.env.UPDATE_API = mockBase;
  process.env.ADMIN_PASSWORD = 'secret12';
  const { createApp } = await import('../server/app.js');
  ({ closeBrowser } = await import('../server/pdf.js'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-feat-'));
  ({ app } = createApp(tmp));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'secret12' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(async () => { srv.close(); mock.close(); await closeBrowser?.(); });

const call = async (method, url, body, raw) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  return { ...(await r.json().catch(() => ({}))), http: r.status };
};
const toB64 = (buf) => Buffer.from(buf).toString('base64');

async function xlsxOf(rows, header = ['کد کالا', 'شرح کالا', 'واحد', 'مبلغ واحد (ریال)', 'فعال']) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('s');
  ws.addRow(header); for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('ورود کالا از Excel: نمونه، پیش‌نمایش، ورود، تکراری، به‌روزرسانی', async () => {
  const sample = Buffer.from(await (await call('GET', '/api/products/template.xlsx', null, true)).arrayBuffer());
  const dry = await call('POST', '/api/products/import', { data: toB64(sample), dryRun: true });
  assert.equal(dry.summary.new, 11);
  assert.equal(dry.summary.error, 0);
  const before0 = await (await call('GET', '/api/products', null, true)).json();
  assert.equal(before0.length, 0);
  const done = await call('POST', '/api/products/import', { data: toB64(sample) });
  assert.equal(done.summary.new, 11);
  const after1 = await (await call('GET', '/api/products', null, true)).json();
  assert.equal(after1.length, 11);
  assert.equal(after1.find((p) => p.code === '999').active, false);
  assert.equal(after1.find((p) => p.code === '301').description, 'پیچ M10×30');
  // دوباره: از قبل موجود
  assert.equal((await call('POST', '/api/products/import', { data: toB64(sample), dryRun: true })).summary.skip, 11);
  // به‌روزرسانی قیمت با ارقام فارسی
  const upd = await xlsxOf([['۱۰۱', 'پروفیل نمونه الف ۶ متری', 'شاخه', '۱,۸۰۰,۰۰۰', 'بله']]);
  const r = await call('POST', '/api/products/import', { data: toB64(upd), mode: 'update' });
  assert.equal(r.summary.update, 1);
  assert.equal((await (await call('GET', '/api/products', null, true)).json()).find((p) => p.code === '101').price, 1800000);
});

test('ورود کالا از Excel: ردیف خطادار و فایل نامعتبر', async () => {
  const bad = await xlsxOf([['12', 'کد کوتاه', 'عدد', 100], ['700', 'خوب', 'عدد', 100], ['700', 'تکراری', 'عدد', 100], ['701', '', 'عدد', 100]]);
  const dry = await call('POST', '/api/products/import', { data: toB64(bad), dryRun: true });
  assert.equal(dry.summary.error, 3);
  assert.equal(dry.summary.new, 1);
  assert.equal((await call('POST', '/api/products/import', { data: toB64(bad) })).http, 400); // بدون نادیده گرفتن خطاها
  assert.equal((await call('POST', '/api/products/import', { data: toB64(bad), ignoreErrors: true })).summary.new, 1);
  assert.equal((await call('POST', '/api/products/import', { data: toB64(Buffer.from('not excel')) })).http, 400);
  const noHeader = await xlsxOf([['a', 'b']], ['x', 'y']);
  assert.match((await call('POST', '/api/products/import', { data: toB64(noHeader) })).error, /ردیف عنوان/);
  assert.equal((await call('GET', '/api/products/export.xlsx', null, true)).status, 200);
});

test('اشتراک‌گذاری: تلگرام و بله با سرور ساختگی؛ توکن نشت نمی‌کند', async () => {
  const put = await call('PUT', '/api/settings', {
    tg_enabled: true, tg_token: SECRET, tg_chat: '111, 222', tg_base: mockBase,
    bale_enabled: true, bale_token: 'BADTOKEN', bale_chat: '333', bale_base: mockBase,
    theme_color: '#112233',
  });
  assert.equal(put.tg_has_token, true);
  assert.equal(put.tg_token, undefined);
  assert.ok(!JSON.stringify(put).includes('eitaa'));
  assert.ok(!JSON.stringify(await call('GET', '/api/settings')).includes(SECRET));
  await call('PUT', '/api/settings', { tg_token: '' }); // خالی = بدون تغییر
  assert.equal((await call('GET', '/api/settings')).tg_has_token, true);

  const inv = await call('POST', '/api/invoices', {
    jdate: '1405/07/20', buyer: { name: 'خریدار' }, items: [{ code: '101', qty: 2 }], finalize: true, share: { platforms: ['telegram'] },
  });
  assert.equal(inv.http, 201);
  assert.deepEqual(inv.share_results.map((x) => [x.platform, x.ok]), [['telegram', true]]);
  const tg = received.filter((r) => r.url.startsWith(`/bot${SECRET}/sendDocument`));
  assert.deepEqual(tg.map((r) => r.fields.chat_id), ['111', '222']);
  assert.match(tg[0].fields.document.name, /\.pdf$/);
  assert.ok(tg[0].fields.document.size > 1000);
  assert.match(tg[0].fields.caption, /پیش‌فاکتور شماره/);

  const r = await call('POST', '/api/share', { kind: 'products-xlsx', platforms: ['bale', 'telegram'] });
  assert.equal(r.results.find((x) => x.platform === 'bale').ok, false);
  assert.ok(!JSON.stringify(r).includes('BADTOKEN'));
  assert.equal(r.results.find((x) => x.platform === 'telegram').ok, true);
  assert.equal((await call('POST', '/api/share', { kind: 'invoices-xlsx', platforms: ['telegram'], query: {} })).results[0].ok, true);
  assert.equal((await call('POST', '/api/share/test', { platform: 'telegram' })).results[0].ok, true);
  assert.ok(received.some((x) => x.url.startsWith(`/bot${SECRET}/sendMessage`)));
  assert.equal((await call('POST', '/api/share', { kind: 'products-xlsx', platforms: ['eitaa'] })).results[0].ok, false); // دیگر پشتیبانی نمی‌شود
  await call('PUT', '/api/settings', { tg_enabled: false });
  assert.equal((await call('POST', '/api/share', { kind: 'products-xlsx', platforms: ['telegram'] })).results[0].ok, false);
  await call('PUT', '/api/settings', { tg_enabled: true });
  assert.equal((await call('POST', '/api/share', { kind: 'products-xlsx', platforms: [] })).http, 400);
});

test('پروکسی: HTTP (CONNECT) و SOCKS5؛ آدرس نامعتبر؛ فقط پلتفرم تیک‌خورده', async () => {
  const hits = { http: 0, socks: 0 };
  // پروکسی HTTP ساده با CONNECT
  const httpProxy = http.createServer((_q, r) => { r.statusCode = 405; r.end(); });
  httpProxy.on('connect', (req, clientSocket, head) => {
    hits.http++;
    const [host, port] = req.url.split(':');
    const up = net.connect(Number(port), host, () => { clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(clientSocket); clientSocket.pipe(up); });
    up.on('error', () => clientSocket.destroy()); clientSocket.on('error', () => up.destroy());
  });
  await new Promise((r) => httpProxy.listen(0, '127.0.0.1', r));
  // پروکسی SOCKS5 بدون احراز هویت
  const socks = net.createServer((c) => {
    c.once('data', () => {
      c.write(Buffer.from([5, 0]));
      c.once('data', (req) => {
        hits.socks++;
        let host; let off;
        if (req[3] === 1) { host = [...req.subarray(4, 8)].join('.'); off = 8; } else { const n = req[4]; host = req.subarray(5, 5 + n).toString(); off = 5 + n; }
        const port = req.readUInt16BE(off);
        const up = net.connect(port, host, () => { c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); up.pipe(c); c.pipe(up); });
        up.on('error', () => c.destroy()); c.on('error', () => up.destroy());
      });
    });
    c.on('error', () => {});
  });
  await new Promise((r) => socks.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await call('PUT', '/api/settings', { proxy_url: 'not a url' })).http, 400);
    assert.equal((await call('PUT', '/api/settings', { proxy_url: 'ftp://x:1' })).http, 400);
    const send = async () => { const r = (await call('POST', '/api/share', { kind: 'products-xlsx', platforms: ['telegram'] })).results[0]; if (!r.ok) console.error('SEND RESULT', JSON.stringify(r)); return r; };

    // بدون تیک «استفاده از پروکسی»، پروکسی استفاده نمی‌شود
    await call('PUT', '/api/settings', { proxy_url: `http://127.0.0.1:${httpProxy.address().port}`, tg_use_proxy: false });
    assert.equal((await send()).ok, true); assert.equal(hits.http, 0);

    await call('PUT', '/api/settings', { tg_use_proxy: true });
    assert.equal((await send()).ok, true); assert.ok(hits.http >= 1, 'HTTP proxy used');

    await call('PUT', '/api/settings', { proxy_url: `socks5://127.0.0.1:${socks.address().port}` });
    assert.equal((await send()).ok, true); assert.ok(hits.socks >= 1, 'SOCKS5 proxy used');

    // پروکسی خراب: خطای فارسی و بدون نشت
    await call('PUT', '/api/settings', { proxy_url: 'http://127.0.0.1:1' });
    const bad = await send();
    assert.equal(bad.ok, false);
    assert.match(bad.error, /پروکسی/);
  } finally {
    await call('PUT', '/api/settings', { proxy_url: '', tg_use_proxy: false });
    httpProxy.close(); socks.close();
  }
});

test('دسته‌بندی‌ها و کد گروه', async () => {
  const groups = await (await call('GET', '/api/groups', null, true)).json();
  assert.deepEqual(groups.slice(0, 2).map((g) => g.code), [100, 200]);
  assert.equal(groups.find((g) => g.code === 300).count, 2); // پیچ‌های نمونه
  assert.equal((await call('POST', '/api/groups', { code: 150, name: 'x' })).http, 400);   // مضرب ۱۰۰ نیست
  assert.equal((await call('POST', '/api/groups', { code: 300, name: 'تکراری' })).http, 400);
  assert.equal((await call('POST', '/api/groups', { code: 700, name: '' })).http, 400);
  assert.equal((await call('POST', '/api/groups', { code: '۷۰۰', name: 'یراق‌آلات' })).http, 201);
  // کالا با گروه تازه‌تعریف‌شده و کالا با گروه تعریف‌نشده
  await call('POST', '/api/products', { code: '701', description: 'کالای گروه تازه', unit: 'عدد', price: 1 });
  await call('POST', '/api/products', { code: '801', description: 'کالای بدون گروه', unit: 'عدد', price: 1 });
  const list = await (await call('GET', '/api/products', null, true)).json();
  assert.equal(list.find((p) => p.code === '701').group, '۷۰۰ - یراق‌آلات');
  assert.equal(list.find((p) => p.code === '801').group, 'متفرقه');
  assert.equal(list.find((p) => p.code === '801').group_code, 800);
  // ویرایش نام و حذف: کالاها «متفرقه» می‌شوند
  assert.ok((await (await call('PUT', '/api/groups/700', { name: 'یراق' }, true)).json()).some((g) => g.name === 'یراق'));
  await call('DELETE', '/api/groups/700');
  assert.equal((await (await call('GET', '/api/products', null, true)).json()).find((p) => p.code === '701').group, 'متفرقه');
  assert.equal((await call('PUT', '/api/groups/999', { name: 'x' })).http, 404);
});

test('لوگو، حالت سربرگ و رنگ پوسته', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await call('POST', '/api/settings/logo', { data: 'data:image/png;base64,' + png.toString('base64') })).has_logo, true);
  assert.equal((await call('POST', '/api/settings/logo', { data: 'data:image/png;base64,AAAA' })).http, 400);
  assert.equal((await call('PUT', '/api/settings', { theme_color: 'red' })).http, 400);
  assert.equal((await call('PUT', '/api/settings', { header_mode: 'x' })).http, 400);
  const body = { jdate: '1405/07/20', buyer: { name: 'خ' }, items: [{ code: '101', qty: 1 }] };
  const html = async () => (await (await call('POST', '/api/invoices/preview-html', body, true)).text());
  await call('PUT', '/api/settings', { company_title: 'شرکت نمونه', header_mode: 'name' });
  const h1 = await html(); assert.ok(!h1.includes('class="logo"')); assert.ok(h1.includes('شرکت نمونه'));
  await call('PUT', '/api/settings', { header_mode: 'logo' });
  assert.ok((await html()).includes('class="logo"'));
  assert.equal((await call('DELETE', '/api/settings/logo')).header_mode, 'name');
});

test('بررسی نسخه‌ی جدید (GitHub ساختگی)', async () => {
  const u = await call('GET', '/api/update/check');
  assert.equal(u.latest, '9.9.9');
  assert.equal(u.newer, true);
  assert.equal(u.canAutoUpdate, false); // خارج از exe خودکار نیست
  assert.equal(u.runningFromSource, true);
  assert.equal((await call('POST', '/api/update/install', { confirm: true })).http, 400);
  assert.equal((await call('POST', '/api/update/install', {})).http, 400);
  const { cmpVersions } = await import('../server/update.js');
  assert.equal(cmpVersions('1.10.0', '1.9.9'), 1);
  assert.equal(cmpVersions('v1.2.2', '1.2.2'), 0);
});
