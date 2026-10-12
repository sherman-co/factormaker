// بکاپ کامل (zip: دیتابیس + PDFها + مهر + لوگو) و بازیابی از zip یا فایل .db (حتی از نسخه‌های قدیمی‌تر برنامه)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zipSync, unzipSync } from 'fflate';
import { migrate, tx } from './db.js';

const TABLES = ['users', 'settings', 'product_groups', 'products', 'customers', 'payment_accounts', 'invoices', 'invoice_items']; // ترتیب درج
const FILE_DIRS = { pdfs: /\.pdf$/i, stamps: /\.png$/i, logos: /\.(png|jpe?g)$/i };
const SQLITE_MAGIC = 'SQLite format 3\u0000';
const SAFE_NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,200}$/;

const quote = (p) => `'${p.replace(/'/g, "''")}'`;

export function buildFullBackup(db, dataDir) {
  const tmp = path.join(os.tmpdir(), `fm-snap-${process.pid}-${Date.now()}.db`);
  db.exec(`VACUUM INTO ${quote(tmp)}`);
  const files = { 'factormaker.db': new Uint8Array(fs.readFileSync(tmp)) };
  fs.rmSync(tmp, { force: true });
  for (const [dir, re] of Object.entries(FILE_DIRS)) {
    const d = path.join(dataDir, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (re.test(f) && fs.statSync(path.join(d, f)).isFile()) files[`${dir}/${f}`] = new Uint8Array(fs.readFileSync(path.join(d, f)));
  }
  files['README.txt'] = new Uint8Array(Buffer.from('FactorMaker full backup. Restore it from Settings > Data and backup > Restore. / بکاپ کامل پنل پیش‌فاکتور؛ از «تنظیمات ← داده‌ها و بکاپ ← بازیابی» برگردانید.\n'));
  return Buffer.from(zipSync(files, { level: 1 }));
}

const cols = (db, schema, t) => db.prepare(`PRAGMA ${schema}.table_info(${t})`).all().map((c) => c.name);

/**
 * بازیابی: محتوای فعلی با محتوای بکاپ جایگزین می‌شود (ستون‌های مشترک؛ پس بکاپ نسخه‌های قدیمی‌تر هم قبول است).
 * beforeReplace(): فراخوان برای گرفتن بکاپ خودکار از وضعیت فعلی. خروجی: خلاصه‌ی تعداد.
 */
export function restoreBackup(db, dataDir, buf, { beforeReplace } = {}) {
  let dbBytes = null; const extra = {};
  if (buf.subarray(0, 16).toString('latin1') === SQLITE_MAGIC) dbBytes = buf;
  else if (buf[0] === 0x50 && buf[1] === 0x4b) {
    let z;
    try { z = unzipSync(new Uint8Array(buf)); } catch { throw new Error('فایل zip خراب است'); }
    for (const [name, data] of Object.entries(z)) {
      const parts = name.split('/').filter(Boolean);
      const base = parts[parts.length - 1];
      if (!base || name.endsWith('/')) continue;
      if (base === 'factormaker.db' && parts.length <= 2) { dbBytes = Buffer.from(data); continue; }
      const dir = parts[parts.length - 2];
      if (FILE_DIRS[dir]?.test(base) && SAFE_NAME.test(base) && !base.includes('..')) extra[`${dir}/${base}`] = data;
    }
  } else throw new Error('فایل بکاپ معتبر نیست (باید zip بکاپ کامل یا فایل .db باشد)');
  if (!dbBytes) throw new Error('داخل zip فایل factormaker.db پیدا نشد');

  const tmp = path.join(os.tmpdir(), `fm-restore-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(tmp, dbBytes);
  try {
    let have;
    try {
      const probe = new DatabaseSync(tmp, { readOnly: true });
      have = new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
      probe.close();
    } catch { throw new Error('فایل دیتابیس معتبر نیست'); }
    for (const t of ['invoices', 'products', 'settings']) if (!have.has(t)) throw new Error('این فایل، بکاپ این برنامه نیست (جدول «' + t + '» ندارد)');

    beforeReplace?.();
    db.exec(`ATTACH DATABASE ${quote(tmp)} AS bk`);
    try {
      tx(db, () => {
        for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM main.${t}`);
        db.exec('DELETE FROM main.sessions');
        for (const t of TABLES) {
          if (!have.has(t)) continue;
          const common = cols(db, 'main', t).filter((c) => cols(db, 'bk', t).includes(c));
          if (!common.length) continue;
          const list = common.join(',');
          const where = t === 'invoice_items' ? ' WHERE invoice_id IN (SELECT id FROM bk.invoices)' : '';
          db.exec(`INSERT INTO main.${t} (${list}) SELECT ${list} FROM bk.${t}${where}`);
        }
      });
    } finally { db.exec('DETACH DATABASE bk'); }
  } finally { fs.rmSync(tmp, { force: true }); }

  migrate(db); // ستون‌ها/تنظیمات تازه‌ی نسخه‌ی فعلی را کامل می‌کند
  let files = 0;
  for (const [rel, data] of Object.entries(extra)) {
    const dest = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    files++;
  }
  const n = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  return { invoices: n('invoices'), products: n('products'), customers: n('customers'), files };
}

export function dataInfo(db, dataDir) {
  const n = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  const file = path.join(dataDir, 'factormaker.db');
  const count = (d) => { try { return fs.readdirSync(path.join(dataDir, d)).length; } catch { return 0; } };
  return { dataDir, dbSize: fs.existsSync(file) ? fs.statSync(file).size : 0, invoices: n('invoices'), products: n('products'), customers: n('customers'), pdfs: count('pdfs') };
}
