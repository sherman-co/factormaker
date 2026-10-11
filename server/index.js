import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const url = `http://127.0.0.1:${port}`;

let created;
try {
  created = createApp(dataDir);
} catch (e) {
  console.error('\nERROR: could not start the app / خطا در راه‌اندازی:\n', e);
  process.exit(1);
}
const { app, firstAdmin } = created;

const server = app.listen(port, host, () => {
  console.log('\n==============================================');
  console.log(`  SERVER IS RUNNING - open this address in your browser:`);
  console.log(`  ${url}`);
  console.log(`  Data folder: ${dataDir}`);
  if (firstAdmin) console.log(`  First login -> user: ${firstAdmin.username}   password: ${firstAdmin.password}  (change it in Settings)`);
  console.log('  Do NOT close this window while using the app.');
  console.log('==============================================\n');
  if (process.env.OPEN_BROWSER === '1') exec(process.platform === 'win32' ? `start "" ${url}` : `xdg-open ${url}`);
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `\nERROR: port ${port} is already in use. Close the other window of this app, or run with a different PORT.\n` : e);
  process.exit(1);
});
