// بکاپ‌گیری از دیتابیس:  npm run backup
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dbFile = path.join(dataDir, 'factormaker.db');
if (!fs.existsSync(dbFile)) { console.error('دیتابیس پیدا نشد: ' + dbFile); process.exit(1); }
fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const out = path.join(dataDir, 'backups', `factormaker-${stamp}.db`);
const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log('بکاپ ساخته شد: ' + out);
