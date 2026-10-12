import fs from 'node:fs';
import puppeteer from 'puppeteer';

let browserPromise = null;

function findChrome() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  // مرورگرهای نصب‌شده روی سیستم
  const cands = [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    ...(fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`) : []),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return cands.find((c) => fs.existsSync(c));
}

function getBrowser() {
  if (!browserPromise) {
    const exe = findChrome();
    const args = ['--font-render-hinting=none'];
    if (process.getuid && process.getuid() === 0) args.push('--no-sandbox', '--disable-setuid-sandbox');
    browserPromise = puppeteer.launch({ headless: true, executablePath: exe, args, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }).catch((e) => {
      browserPromise = null;
      throw new Error('اجرای مرورگر برای ساخت PDF ممکن نشد: ' + e.message);
    });
  }
  return browserPromise;
}

export async function htmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready');
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (!b) return;
  // بستن نرم با مهلت کوتاه؛ اگر نشد، پروسه‌ی مرورگر کشته می‌شود تا خروج برنامه معطل نماند
  await Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
  try { b.process()?.kill('SIGKILL'); } catch { /* already closed */ }
}
