// بررسی نسخه‌ی جدید از GitHub Releases و به‌روزرسانی یک‌کلیکی (فقط نسخه‌ی exe).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { unzipSync } from 'fflate';
import { ROOT, SEA } from './paths.js';

const REPO = process.env.UPDATE_REPO || 'sherman-co/factormaker';
const API = (process.env.UPDATE_API || 'https://api.github.com').replace(/\/+$/, '');
const TEST_MODE = !!process.env.UPDATE_API; // آدرس سفارشی فقط برای آزمون
const ASSET_RE = process.env.UPDATE_ASSET_PATTERN ? new RegExp(process.env.UPDATE_ASSET_PATTERN) : /win-x64\.zip$/i;
const CAN_AUTO = SEA && (process.platform === 'win32' || TEST_MODE);
const EXE_NAME = process.platform === 'win32' ? 'FactorMaker.exe' : 'FactorMaker';
const ALLOWED_HOSTS = /(^|\.)(github\.com|githubusercontent\.com)$/;

export function cmpVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

async function latestRelease() {
  const res = await fetch(`${API}/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FactorMaker-updater' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'هنوز نسخه‌ای منتشر نشده است' : `پاسخ ناموفق از GitHub (${res.status})`);
  return res.json();
}

export async function checkUpdate(current) {
  let rel;
  try { rel = await latestRelease(); } catch (e) {
    return { current, error: e.name === 'TimeoutError' || e.cause ? 'اتصال به GitHub برقرار نشد (اینترنت یا فیلترشکن را بررسی کنید)' : e.message, canAutoUpdate: false };
  }
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  const asset = (rel.assets || []).find((a) => ASSET_RE.test(a.name));
  return {
    current, latest, newer: !!latest && cmpVersions(latest, current) > 0, url: rel.html_url, notes: rel.body || '', published: rel.published_at,
    asset: asset ? { name: asset.name, size: asset.size } : null,
    canAutoUpdate: CAN_AUTO && !!asset, runningFromSource: !SEA,
  };
}

async function download(url, expectedSha) {
  const u = new URL(url);
  if (!TEST_MODE && !(u.protocol === 'https:' && ALLOWED_HOSTS.test(u.hostname))) throw new Error('آدرس دانلود مجاز نیست');
  const res = await fetch(url, { headers: { 'User-Agent': 'FactorMaker-updater' }, redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`دانلود ناموفق (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedSha) {
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha !== expectedSha.replace(/^sha256:/, '')) throw new Error('هش فایل دانلودشده با GitHub نمی‌خواند؛ به‌روزرسانی لغو شد');
  }
  return buf;
}

/** دانلود، اعتبارسنجی، آماده‌سازی و اجرای اسکریپت جایگزینی. پس از برگشت، فراخوان باید برنامه را ببندد. */
export async function installUpdate({ backup }) {
  if (!CAN_AUTO) throw new Error('به‌روزرسانی خودکار فقط در نسخه‌ی exe ویندوز ممکن است');
  const rel = await latestRelease();
  const asset = (rel.assets || []).find((a) => ASSET_RE.test(a.name));
  if (!asset) throw new Error('فایل نسخه‌ی ویندوز در Release پیدا نشد');
  const buf = await download(asset.browser_download_url, asset.digest);

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
  return { version: String(rel.tag_name || '').replace(/^v/, '') };
}
