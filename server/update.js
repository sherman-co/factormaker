// بررسی نسخه‌ی جدید از GitHub Releases و به‌روزرسانی یک‌کلیکی (فقط نسخه‌ی exe).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fetch } from 'undici';
import { proxyDispatcher } from './share.js';
import { unzipSync } from 'fflate';
import { ROOT, SEA } from './paths.js';

// بدون استفاده از API گیت‌هاب (که سهمیه‌ی ۶۰ درخواست در ساعت برای هر IP دارد و پشت فیلترشکن‌ها زود ۴۰۳ می‌دهد):
// نسخه از ریدایرکت صفحه‌ی releases/latest خوانده می‌شود و فایل از لینک مستقیم دانلود می‌شود.
const REPO = process.env.UPDATE_REPO || 'sherman-co/factormaker';
const BASE = (process.env.UPDATE_BASE || `https://github.com/${REPO}`).replace(/\/+$/, '');
const API = (process.env.UPDATE_API || 'https://api.github.com').replace(/\/+$/, ''); // فقط وقتی توکن داده شده (مخزن خصوصی)
const TEST_MODE = !!(process.env.UPDATE_BASE || process.env.UPDATE_API); // آدرس سفارشی فقط برای آزمون
const ASSET_NAME = process.env.UPDATE_ASSET_NAME || 'FactorMaker-win-x64.zip';
const CAN_AUTO = SEA && (process.platform === 'win32' || TEST_MODE || !!process.env.UPDATE_ALLOW_ANY);
const EXE_NAME = process.platform === 'win32' ? 'FactorMaker.exe' : 'FactorMaker';
const UA = { 'User-Agent': 'FactorMaker-updater' };

export function cmpVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

const HELP = ' — اگر GitHub از اینترنت شما بسته است، «پروکسی» را در «تنظیمات ← اشتراک‌گذاری» تعریف و «استفاده برای به‌روزرسانی» را تیک بزنید، یا از «صفحه‌ی دانلود» دستی بگیرید.';

function friendly(e) {
  if (e.userMessage) return e.userMessage;
  const code = e.cause?.code || e.code || '';
  if (e.name === 'TimeoutError') return 'زمان اتصال به GitHub تمام شد' + HELP;
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'آدرس GitHub پیدا نشد (اینترنت قطع است یا فیلتر شده)' + HELP;
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|UND_ERR/.test(code) || /fetch failed|socks|proxy/i.test(e.message)) return `اتصال به GitHub برقرار نشد${code ? ' (' + code + ')' : ''}` + HELP;
  if (/CERT|TLS|SSL/i.test(code + e.message)) return 'خطای گواهی امنیتی هنگام اتصال به GitHub (ساعت سیستم یا آنتی‌ویروس/فیلترشکن را بررسی کنید)';
  return e.message;
}
const httpError = (status, withToken) => Object.assign(new Error(`GitHub پاسخ ${status} داد`), {
  userMessage: withToken
    ? (status === 401 || status === 403 || status === 404 ? `GitHub توکن را نپذیرفت یا اجازه‌ی خواندن مخزن را ندارد (${status}). توکن را بررسی کنید: دسترسی «Contents: Read-only» روی همین مخزن و منقضی نشده باشد.` : `GitHub پاسخ ${status} داد` + HELP)
    : (status === 404 ? 'نسخه‌ای پیدا نشد. اگر مخزن GitHub «خصوصی» است، توکن GitHub را در همین بخش وارد کنید (یا مخزن را عمومی کنید).'
      : status === 403 || status === 429 ? `GitHub موقتاً درخواست‌ها را محدود کرده (${status}) — چند دقیقه بعد دوباره امتحان کنید یا پروکسی/فیلترشکن را عوض کنید.` : `GitHub پاسخ ${status} داد` + HELP),
});

// ---- مخزن عمومی: بدون API و بدون سهمیه (ریدایرکت صفحه‌ی releases/latest + لینک مستقیم دانلود)
async function latestWeb(proxy) {
  const res = await fetch(`${BASE}/releases/latest`, { redirect: 'manual', headers: UA, dispatcher: proxyDispatcher(proxy), signal: AbortSignal.timeout(20_000) });
  const loc = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && loc) {
    const m = /\/releases\/tag\/([^/?#]+)$/.exec(decodeURIComponent(loc));
    if (m) return { version: m[1].replace(/^v/, ''), notes: '', url: `${BASE}/releases/download/v${m[1].replace(/^v/, '')}/${ASSET_NAME}` };
  }
  throw httpError(res.status, false);
}

// ---- مخزن خصوصی: با توکن فقط‌خواندنی از API
const apiHeaders = (token, accept = 'application/vnd.github+json') => ({ ...UA, Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' });
async function latestApi(token, proxy) {
  const res = await fetch(`${API}/repos/${REPO}/releases/latest`, { headers: apiHeaders(token), dispatcher: proxyDispatcher(proxy), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw httpError(res.status, true);
  const rel = await res.json();
  const asset = (rel.assets || []).find((a) => a.name === ASSET_NAME);
  if (!asset) throw Object.assign(new Error('asset'), { userMessage: `فایل ${ASSET_NAME} در آخرین Release پیدا نشد` });
  return { version: String(rel.tag_name || '').replace(/^v/, ''), notes: rel.body || '', url: `${API}/repos/${REPO}/releases/assets/${asset.id}`, apiDownload: true, digest: asset.digest };
}

const latest = ({ token, proxy }) => (token ? latestApi(token, proxy) : latestWeb(proxy));

export async function checkUpdate(current, { proxy, token } = {}) {
  let rel;
  try { rel = await latest({ token, proxy }); } catch (e) { return { current, error: friendly(e), canAutoUpdate: false, url: `${BASE}/releases`, needsToken: !token }; }
  return {
    current, latest: rel.version, newer: cmpVersions(rel.version, current) > 0, url: `${BASE}/releases/tag/v${rel.version}`, notes: rel.notes,
    asset: { name: ASSET_NAME }, canAutoUpdate: CAN_AUTO, runningFromSource: !SEA, viaToken: !!token,
  };
}

async function download(rel, { token, proxy }) {
  const res = await fetch(rel.url, {
    headers: rel.apiDownload ? apiHeaders(token, 'application/octet-stream') : UA, redirect: 'follow',
    dispatcher: proxyDispatcher(proxy), signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok) throw httpError(res.status, !!token);
  return Buffer.from(await res.arrayBuffer());
}

/** هش SHA-256: از digest دارایی (API) یا فایل .sha256 کنار Release؛ اگر نبود null (نسخه‌های قدیمی). */
async function expectedSha(rel, { proxy }) {
  if (rel.digest) return rel.digest.replace(/^sha256:/, '').toLowerCase();
  if (rel.apiDownload) return null;
  try {
    const res = await fetch(rel.url + '.sha256', { headers: UA, redirect: 'follow', dispatcher: proxyDispatcher(proxy), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const m = /\b([a-fA-F0-9]{64})\b/.exec(await res.text());
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

/** دانلود، اعتبارسنجی، آماده‌سازی و اجرای اسکریپت جایگزینی. پس از برگشت، فراخوان باید برنامه را ببندد. */
export async function installUpdate({ backup, proxy, token }) {
  if (!CAN_AUTO) throw new Error('به‌روزرسانی خودکار فقط در نسخه‌ی exe ویندوز ممکن است');
  let version; let buf;
  try {
    const rel = await latest({ token, proxy });
    version = rel.version;
    buf = await download(rel, { token, proxy });
    const sha = await expectedSha(rel, { proxy });
    if (sha && crypto.createHash('sha256').update(buf).digest('hex') !== sha) throw new Error('هش فایل دانلودشده با مقدار منتشرشده نمی‌خواند؛ به‌روزرسانی لغو شد');
  } catch (e) { throw new Error(friendly(e)); }

  const stage = path.join(ROOT, 'update-tmp');
  fs.rmSync(stage, { recursive: true, force: true });
  const files = unzipSync(new Uint8Array(buf));
  const names = Object.keys(files);
  const top = names.find((n) => n.endsWith('/' + EXE_NAME) || n === EXE_NAME);
  if (!top) throw new Error('فایل zip معتبر نیست (برنامه‌ی اجرایی داخل آن نیست)');
  const prefix = top.slice(0, top.length - EXE_NAME.length);
  const newDir = path.join(stage, 'new');
  for (const n of names) {
    if (!n.startsWith(prefix) || n.endsWith('/')) continue;
    const rel2 = n.slice(prefix.length);
    if (!rel2 || rel2.startsWith('data/') || rel2.includes('..')) continue; // هرگز روی data نمی‌نویسیم
    const dest = path.join(newDir, rel2);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[n]);
  }
  if (!fs.existsSync(path.join(newDir, EXE_NAME))) throw new Error('آماده‌سازی فایل‌ها ناموفق بود');
  try { fs.chmodSync(path.join(newDir, EXE_NAME), 0o755); } catch { /* ignore */ }

  backup?.(); // نسخه‌ی پشتیبان دیتابیس قبل از تغییر

  const log = path.join(ROOT, 'data', 'update.log');
  if (process.platform === 'win32') {
    const script = path.join(stage, 'apply.cmd');
    // نکته‌ها: «timeout» بدون کنسول کار نمی‌کند (ping استفاده شد)؛ پاک کردن پوشه‌ی موقت (که خود اسکریپت داخل آن است) باید آخرین خط باشد،
    // وگرنه cmd خطوط بعدی را پیدا نمی‌کند و برنامه‌ی جدید اجرا نمی‌شود.
    fs.writeFileSync(script, [
      '@echo off',
      `echo [%date% %time%] update started (old process ${process.pid}) >> "${log}"`,
      // چند ثانیه صبر تا برنامه‌ی فعلی بسته شود؛ اگر فایل exe هنوز قفل بود، خود robocopy تا آزاد شدن دوباره تلاش می‌کند
      'ping -n 4 127.0.0.1 >nul',
      `robocopy "${newDir}" "${ROOT}" /E /R:90 /W:1 /NFL /NDL /NJH /NJS /NP >> "${log}" 2>&1`,
      'set RC=%ERRORLEVEL%',
      `echo [%date% %time%] robocopy exit code %RC% >> "${log}"`,
      `if %RC% GEQ 8 (echo UPDATE FAILED >> "${log}" & exit /b 1)`,
      `start "" "${path.join(ROOT, EXE_NAME)}"`,
      `echo [%date% %time%] new version started >> "${log}"`,
      `rmdir /s /q "${stage}"`,
      '',
    ].join('\r\n'));
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    const script = path.join(stage, 'apply.sh');
    fs.writeFileSync(script, [
      '#!/bin/sh',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      `cp -R "${newDir}/." "${ROOT}/" >> "${log}" 2>&1 || { echo "UPDATE FAILED" >> "${log}"; exit 1; }`,
      `rm -rf "${stage}"`,
      `cd "${ROOT}" && nohup "./${EXE_NAME}" >> "${log}" 2>&1 &`,
      '',
    ].join('\n'), { mode: 0o755 });
    spawn('sh', [script], { detached: true, stdio: 'ignore' }).unref();
  }
  return { version };
}
