import path from 'node:path';
import { exec } from 'node:child_process';
import { createApp } from './app.js';
import { closeBrowser } from './pdf.js';
import { ROOT, SEA } from './paths.js';

const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const url = `http://127.0.0.1:${port}`;

/** در حالت exe، پنجره بعد از خطا نبندد تا کاربر پیام را ببیند. */
function fatal(...msg) {
  console.error(...msg);
  if (SEA && process.stdin.isTTY) {
    console.error('\nPress Enter to close this window...');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } else process.exit(1);
}

let created;
try {
  created = createApp(dataDir);
} catch (e) {
  fatal('\nERROR: could not start the app / خطا در راه‌اندازی:\n', e);
}
const { app, db, firstAdmin } = created || {};

const server = app?.listen(port, host, () => {
  console.log('\n==============================================');
  console.log('  SERVER IS RUNNING - open this address in your browser:');
  console.log(`  ${url}`);
  console.log(`  Data folder: ${dataDir}`);
  if (firstAdmin) console.log(`  First login -> user: ${firstAdmin.username}   password: ${firstAdmin.password}  (change it in Settings)`);
  console.log('  Do NOT close this window while using the app. Close it (or press Ctrl+C) to stop.');
  console.log('==============================================\n');
  if (process.env.OPEN_BROWSER === '1' || (SEA && process.env.OPEN_BROWSER !== '0')) {
    exec(process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`);
  }
});
server?.on('error', (e) => {
  fatal(e.code === 'EADDRINUSE' ? `\nERROR: port ${port} is already in use. Close the other window of this app, or run with a different PORT.\n` : e);
});

// خروج سریع و تمیز: اتصال‌ها بسته، مرورگر PDF کشته، دیتابیس بسته می‌شود
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping...');
  setTimeout(() => process.exit(0), 3000).unref(); // اگر چیزی معطل کرد، اجباری خارج شو
  server?.closeAllConnections?.();
  server?.close();
  await closeBrowser();
  try { db?.close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, shutdown);
