// آزمون به‌روزرسانی یک‌کلیکی با GitHub ساختگی:  node scripts/update-smoke.mjs
// پیش‌نیاز: node scripts/build-exe.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { zipSync } from 'fflate';

const exeName = process.platform === 'win32' ? 'FactorMaker.exe' : 'FactorMaker';
const src = path.resolve('release/FactorMaker');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-upd-'));
const app = path.join(work, 'app');
fs.cpSync(src, app, { recursive: true, filter: (f) => !/[\\/]data([\\/]|$)/.test(f.slice(src.length)) }); // بدون data مانده از آزمون قبلی
const must = (c, m) => { if (!c) throw new Error('UPDATE SMOKE FAIL: ' + m); console.log('ok -', m); };

// بسته‌ی «نسخه‌ی جدید»: همان فایل‌ها با package.json نسخه‌ی ۹٫۹٫۹
const files = {};
const walk = (d, rel = 'FactorMaker') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'data' && rel === 'FactorMaker') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, rel + '/' + e.name); else files[rel + '/' + e.name] = new Uint8Array(fs.readFileSync(p)); } };
walk(src);
files['FactorMaker/package.json'] = new Uint8Array(Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')), version: '9.9.9' })));
const zip = Buffer.from(zipSync(files, { level: 1 }));
const sha = crypto.createHash('sha256').update(zip).digest('hex');
const mockPort = 3150; const appPort = 3151;
const tokenMode = process.env.SMOKE_MODE === 'token'; // مخزن خصوصی: API با توکن
const mock = http.createServer((req, res) => {
  if (req.url === '/repos/sherman-co/factormaker/releases/latest') {
    if (req.headers.authorization !== 'Bearer smoke-token') { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ tag_name: 'v9.9.9', body: 'x', assets: [{ id: 5, name: 'FactorMaker-win-x64.zip', digest: 'sha256:' + sha }] }));
  }
  if (req.url === '/repos/sherman-co/factormaker/releases/assets/5') {
    if (req.headers.authorization !== 'Bearer smoke-token' || req.headers.accept !== 'application/octet-stream') { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'application/octet-stream'); return res.end(zip);
  }
  if (tokenMode) { res.statusCode = 404; return res.end(); } // وب برای مخزن خصوصی ۴۰۴ است
  if (req.url === '/repo/releases/latest') { res.statusCode = 302; res.setHeader('location', `http://127.0.0.1:${mockPort}/repo/releases/tag/v9.9.9`); return res.end(); }
  if (req.url === '/repo/releases/download/v9.9.9/FactorMaker-win-x64.zip.sha256') return res.end(`${sha}  FactorMaker-win-x64.zip\n`);
  if (req.url === '/repo/releases/download/v9.9.9/FactorMaker-win-x64.zip') { res.setHeader('content-type', 'application/zip'); return res.end(zip); }
  res.statusCode = 404; res.end();
}).listen(mockPort);

const base = `http://127.0.0.1:${appPort}`;
const env = { ...process.env, PORT: String(appPort), ADMIN_PASSWORD: 'upd-pass-1', OPEN_BROWSER: '0', UPDATE_BASE: `http://127.0.0.1:${mockPort}/repo`, UPDATE_API: `http://127.0.0.1:${mockPort}` };
const outFd = fs.openSync(path.join(work, 'exe.log'), 'a');
const child = spawn(path.join(app, exeName), [], { cwd: app, env, stdio: ['ignore', outFd, outFd], detached: false });
const version = async () => { try { return (await (await fetch(base + '/api/version', { signal: AbortSignal.timeout(1500) })).json()).version; } catch { return null; } };
const wait = async (pred, sec) => { for (let i = 0; i < sec; i++) { const v = await version(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, 1000)); } return await version(); };
let code = 0;
try {
  const v0 = await wait((v) => !!v, 30);
  must(v0 && v0 !== '9.9.9', 'old version running: ' + v0);
  const l = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'upd-pass-1' }) });
  const cookie = l.headers.get('set-cookie').split(';')[0];
  const H = { 'Content-Type': 'application/json', cookie };
  await fetch(base + '/api/products', { method: 'POST', headers: H, body: JSON.stringify({ code: '101', description: 'باقی می‌ماند', unit: 'عدد', price: 5 }) });
  if (tokenMode) {
    const bad = await (await fetch(base + '/api/update/check', { headers: H })).json();
    must(bad.error && /توکن/.test(bad.error), 'private repo without token -> helpful error');
    await fetch(base + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ update_token: 'smoke-token' }) });
  }
  const chk = await (await fetch(base + '/api/update/check', { headers: H })).json();
  must(chk.newer && chk.canAutoUpdate, 'update available + auto-update allowed');
  const inst = await fetch(base + '/api/update/install', { method: 'POST', headers: H, body: JSON.stringify({ confirm: true }) });
  must(inst.ok, 'install accepted');
  const v1 = await wait((v) => v === '9.9.9', 40);
  must(v1 === '9.9.9', 'new version running: ' + v1);
  const l2 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'upd-pass-1' }) });
  const list = await (await fetch(base + '/api/products', { headers: { cookie: l2.headers.get('set-cookie').split(';')[0] } })).json();
  must(list.length === 1 && list[0].code === '101', 'data preserved');
  must(fs.readdirSync(path.join(app, 'data', 'backups')).some((f) => f.startsWith('pre-update')), 'pre-update backup created');
  console.log('UPDATE SMOKE OK');
} catch (e) {
  console.error(e); code = 1;
  for (const f of [path.join(work, 'exe.log'), path.join(app, 'data', 'update.log')]) {
    console.error(`----- ${path.basename(f)} -----`); try { console.error(fs.readFileSync(f, 'utf8')); } catch { console.error('(no file)'); }
  }
  try { console.error('----- files in app dir -----', fs.readdirSync(app).join(', '), '| stage:', fs.existsSync(path.join(app, 'update-tmp')) ? fs.readdirSync(path.join(app, 'update-tmp')).join(', ') : '(gone)'); } catch { /* ignore */ }
}
finally {
  mock.close();
  // پروسه‌ی نسخه‌ی جدید فرزند ما نیست؛ با پورت پیدا و بسته می‌شود
  try { child.kill(); } catch { /* gone */ }
  try { await fetch(base + '/api/version'); if (process.platform === 'win32') spawn('taskkill', ['/F', '/IM', exeName], { stdio: 'ignore' }); else spawn('pkill', ['-x', exeName], { stdio: 'ignore' }); } catch { /* not running */ }
  setTimeout(() => process.exit(code), 800);
}
