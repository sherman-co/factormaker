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
const must = (c, m) => { if (!c) { console.error('UPDATE SMOKE FAIL:', m); process.exit(1); } console.log('ok -', m); };

// بسته‌ی «نسخه‌ی جدید»: همان فایل‌ها با package.json نسخه‌ی ۹٫۹٫۹
const files = {};
const walk = (d, rel = 'FactorMaker') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'data' && rel === 'FactorMaker') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, rel + '/' + e.name); else files[rel + '/' + e.name] = new Uint8Array(fs.readFileSync(p)); } };
walk(src);
files['FactorMaker/package.json'] = new Uint8Array(Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')), version: '9.9.9' })));
const zip = Buffer.from(zipSync(files, { level: 1 }));
const sha = crypto.createHash('sha256').update(zip).digest('hex');
const mockPort = 3150; const appPort = 3151;
const mock = http.createServer((req, res) => {
  if (req.url.startsWith('/repos/')) {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'http://x', body: 'test', assets: [{ name: 'new.zip', size: zip.length, digest: 'sha256:' + sha, browser_download_url: `http://127.0.0.1:${mockPort}/new.zip` }] }));
  }
  res.setHeader('content-type', 'application/zip'); res.end(zip);
}).listen(mockPort);

const base = `http://127.0.0.1:${appPort}`;
const env = { ...process.env, PORT: String(appPort), ADMIN_PASSWORD: 'upd-pass-1', OPEN_BROWSER: '0', UPDATE_API: `http://127.0.0.1:${mockPort}`, UPDATE_ASSET_PATTERN: 'new\\.zip$' };
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
