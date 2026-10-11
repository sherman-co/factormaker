import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  company_title: '',
  invoice_title: 'پیش‌فاکتور فروش کالا و خدمات',
  invoice_title_sale: 'فاکتور فروش کالا و خدمات',
  seller_name: '',
  seller_national_id: '',
  seller_phone: '',
  seller_address: '',
  last_invoice_number: '0', // شماره آخرین فاکتور صادرشده؛ فاکتور بعدی = این عدد + ۱
  default_tax_percent: '0',
  validity_hours: '24',
  default_notes: 'مدت اعتبار این پیش‌فاکتور ۲۴ ساعت از تاریخ صدور است.',
  show_code_in_print: '0',
  stamp_in_pdf: '0',
  stamp_file: '',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, description TEXT NOT NULL, unit TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, national_id TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', reg_no TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, number INTEGER UNIQUE NOT NULL, jdate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  customer_id INTEGER,
  buyer_name TEXT NOT NULL DEFAULT '', buyer_national_id TEXT NOT NULL DEFAULT '', buyer_phone TEXT NOT NULL DEFAULT '',
  buyer_address TEXT NOT NULL DEFAULT '', buyer_reg_no TEXT NOT NULL DEFAULT '',
  seller_json TEXT,               -- در لحظه ثبت نهایی ذخیره می‌شود
  subtotal INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0, tax_amount INTEGER NOT NULL DEFAULT 0, payable INTEGER NOT NULL DEFAULT 0,
  amount_words TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  with_stamp INTEGER NOT NULL DEFAULT 0, stamp_file TEXT, pdf_file TEXT,
  copied_from INTEGER, finalized_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, product_code TEXT NOT NULL, description TEXT NOT NULL, qty REAL NOT NULL,
  unit TEXT NOT NULL, unit_price INTEGER NOT NULL, list_price INTEGER NOT NULL, line_total INTEGER NOT NULL,
  remark TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS payment_accounts (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, holder TEXT NOT NULL DEFAULT '', card TEXT NOT NULL DEFAULT '',
  sheba TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id, position);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(jdate);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const d of ['pdfs', 'stamps', 'backups']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'factormaker.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const cols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
  if (!cols.includes('doc_type')) db.exec("ALTER TABLE invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'proforma'");
  if (!cols.includes('pay_json')) db.exec('ALTER TABLE invoices ADD COLUMN pay_json TEXT');
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  // انتقال شماره کارت/شبای قدیمی تنظیمات به فهرست حساب‌ها (فقط یک بار، اگر فهرست خالی است)
  if (db.prepare('SELECT COUNT(*) c FROM payment_accounts').get().c === 0) {
    const old = Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key IN ('card_number','sheba','account_number','account_holder')").all().map((r) => [r.key, r.value]));
    if (old.card_number || old.sheba || old.account_number) {
      db.prepare('INSERT INTO payment_accounts(title,holder,card,sheba,account) VALUES (?,?,?,?,?)')
        .run('حساب اصلی', old.account_holder || '', old.card_number || '', old.sheba || '', old.account_number || '');
    }
  }
  return db;
}

/** اجرای چند دستور در یک تراکنش. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
}
