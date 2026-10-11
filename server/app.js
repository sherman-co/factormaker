import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { openDb, tx, getSettings, DEFAULT_SETTINGS } from './db.js';
import { ensureAdmin, login, logout, userFromToken, parseCookies, setPassword, hashPw } from './auth.js';
import { renderInvoiceHtml, stampDataUri } from './print.js';
import { htmlToPdf } from './pdf.js';
import { FONTS_DIR, VAZIR_FILE, fontCss } from './fonts.js';
import { toEnDigits, parseNumber, normalizeText, calcTotals, lineTotal, amountToWords, groupOfCode } from '../shared/format.js';
import { todayJalali, isValidJalaliString } from '../shared/jdate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE = 'fm_session';
const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m, extra) => new HttpError(400, m, extra);

const clean = (s) => String(s ?? '').trim();
const digitsText = (s) => toEnDigits(clean(s)); // شناسه ملی/تلفن: متن با ارقام انگلیسی، صفر اول حفظ

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'stamp_file' && k !== 'last_invoice_number');
const PAY_LABELS = { card: ['شماره کارت', 'card_number'], sheba: ['شماره شبا', 'sheba'], account: ['شماره حساب', 'account_number'] };

export function createApp(dataDir) {
  const db = openDb(dataDir);
  const firstAdmin = ensureAdmin(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '6mb' }));

  // ---------- فایل‌های ثابت ----------
  app.use('/fonts', express.static(FONTS_DIR));
  app.get('/fonts.css', (_q, r) => r.type('css').send(fontCss()));
  app.get('/vendor/vazirmatn.woff2', (_q, r) => r.sendFile(VAZIR_FILE));
  app.get('/vendor/jalaali.js', (_q, r) => r.sendFile(path.join(root, 'node_modules/jalaali-js/dist/index.js')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use(express.static(path.join(root, 'public')));

  // ---------- احراز هویت ----------
  const tokenOf = (req) => parseCookies(req.headers.cookie)[COOKIE];
  app.post('/api/login', (req, res) => {
    const r = login(db, req.body?.username, req.body?.password, req.ip);
    if (r.error) throw new HttpError(401, r.error);
    res.setHeader('Set-Cookie', `${COOKIE}=${r.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}`);
    res.json({ user: r.user });
  });
  app.post('/api/logout', (req, res) => {
    logout(db, tokenOf(req));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });
  app.get('/api/version', (_q, res) => res.json({ version: VERSION }));
  app.get('/api/me', (req, res) => {
    const u = userFromToken(db, tokenOf(req));
    if (!u) throw new HttpError(401, 'وارد نشده‌اید');
    res.json({ user: u });
  });
  app.use('/api', (req, _res, next) => {
    const u = userFromToken(db, tokenOf(req));
    if (!u) throw new HttpError(401, 'ابتدا وارد شوید');
    req.user = u;
    next();
  });
  app.post('/api/change-password', (req, res) => {
    const { old_password, new_password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (hashPw(String(old_password || ''), u.salt) !== u.password_hash) throw bad('رمز فعلی اشتباه است');
    if (String(new_password || '').length < 6) throw bad('رمز جدید باید حداقل ۶ نویسه باشد');
    setPassword(db, u.username, String(new_password));
    res.json({ ok: true });
  });

  app.get('/api/today', (_req, res) => res.json({ jdate: todayJalali() }));

  // ---------- تنظیمات ----------
  const publicSettings = () => {
    const s = getSettings(db);
    return { ...s, has_stamp: !!(s.stamp_file && fs.existsSync(path.join(dataDir, 'stamps', s.stamp_file))) };
  };
  app.get('/api/settings', (_q, res) => res.json(publicSettings()));
  app.put('/api/settings', (req, res) => {
    const b = req.body || {};
    const up = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const vals = {};
    for (const k of SETTING_KEYS) if (k in b) vals[k] = clean(b[k]);
    if ('seller_national_id' in vals) vals.seller_national_id = digitsText(vals.seller_national_id);
    if ('seller_phone' in vals) vals.seller_phone = digitsText(vals.seller_phone);
    if ('default_tax_percent' in vals) {
      const n = parseNumber(vals.default_tax_percent);
      if (n === null || n < 0 || n > 100) throw bad('درصد مالیات نامعتبر است');
      vals.default_tax_percent = String(n);
    }
    if ('validity_hours' in vals) {
      const n = parseNumber(vals.validity_hours);
      if (n === null || n <= 0) throw bad('مدت اعتبار نامعتبر است');
      vals.validity_hours = String(n);
    }
    if ('card_number' in vals) vals.card_number = digitsText(vals.card_number).replace(/\D/g, '');
    if ('account_number' in vals) vals.account_number = digitsText(vals.account_number);
    if ('sheba' in vals) vals.sheba = digitsText(vals.sheba).replace(/[\s-]/g, '').toUpperCase();
    for (const k of ['show_code_in_print', 'stamp_in_pdf']) if (k in b) vals[k] = b[k] === true || b[k] === '1' || b[k] === 1 ? '1' : '0';
    if ('last_invoice_number' in b) {
      const n = parseNumber(b.last_invoice_number);
      if (n === null || !Number.isInteger(n) || n < 0) throw bad('شماره آخرین فاکتور نامعتبر است');
      vals.last_invoice_number = String(n);
    }
    tx(db, () => { for (const [k, v] of Object.entries(vals)) up.run(k, v); });
    res.json(publicSettings());
  });
  app.post('/api/settings/stamp', (req, res) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(req.body?.data || '');
    if (!m) throw bad('فقط فایل PNG پذیرفته می‌شود');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw bad('حجم تصویر بیش از ۳ مگابایت است');
    if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw bad('فایل PNG معتبر نیست');
    const name = `stamp-${Date.now()}.png`;
    fs.writeFileSync(path.join(dataDir, 'stamps', name), buf);
    db.prepare("UPDATE settings SET value=? WHERE key='stamp_file'").run(name);
    res.json(publicSettings());
  });
  app.delete('/api/settings/stamp', (_q, res) => {
    db.prepare("UPDATE settings SET value='' WHERE key='stamp_file'").run();
    res.json(publicSettings());
  });
  app.get('/api/settings/stamp', (_q, res) => {
    const f = getSettings(db).stamp_file;
    const p = f && path.join(dataDir, 'stamps', f);
    if (!p || !fs.existsSync(p)) throw new HttpError(404, 'مهری ثبت نشده است');
    res.type('png').sendFile(p);
  });

  // ---------- کالاها ----------
  const productOut = (p) => ({ ...p, active: !!p.active, group: groupOfCode(p.code) });
  function validateProduct(b, id) {
    const code = toEnDigits(clean(b.code));
    if (!/^\d{3,}$/.test(code)) throw bad('کد کالا باید عددی و حداقل ۳ رقم باشد');
    const description = normalizeText(b.description);
    if (!description) throw bad('شرح کالا الزامی است');
    const unit = normalizeText(b.unit);
    if (!unit) throw bad('واحد الزامی است');
    const price = parseNumber(b.price);
    if (price === null || price < 0 || !Number.isInteger(Math.round(price))) throw bad('مبلغ واحد نامعتبر است');
    const dup = db.prepare('SELECT id FROM products WHERE code=? AND id IS NOT ?').get(code, id ?? null);
    if (dup) throw bad('این کد قبلاً ثبت شده است');
    return { code, description, unit, price: Math.round(price), active: b.active === false ? 0 : 1 };
  }
  app.get('/api/products', (req, res) => {
    const q = toEnDigits(clean(req.query.q)).toLowerCase();
    let rows = db.prepare('SELECT * FROM products ORDER BY CAST(code AS INTEGER)').all();
    if (req.query.active === '1') rows = rows.filter((r) => r.active);
    if (q) rows = rows.filter((r) => r.code.includes(q) || r.description.toLowerCase().includes(q) || groupOfCode(r.code).includes(q));
    res.json(rows.map(productOut));
  });
  app.post('/api/products', (req, res) => {
    const p = validateProduct(req.body || {});
    const r = db.prepare('INSERT INTO products(code,description,unit,price,active) VALUES (?,?,?,?,?)').run(p.code, p.description, p.unit, p.price, p.active);
    res.status(201).json(productOut(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid)));
  });
  app.put('/api/products/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM products WHERE id=?').get(id)) throw new HttpError(404, 'کالا پیدا نشد');
    const p = validateProduct(req.body || {}, id);
    db.prepare('UPDATE products SET code=?,description=?,unit=?,price=?,active=? WHERE id=?').run(p.code, p.description, p.unit, p.price, p.active, id);
    res.json(productOut(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
  });
  // حذف کامل وجود ندارد؛ فقط غیرفعال‌سازی (در PUT). برای کالای بدون سابقه حذف مجاز است.
  app.delete('/api/products/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.params.id));
    if (!p) throw new HttpError(404, 'کالا پیدا نشد');
    if (db.prepare('SELECT 1 FROM invoice_items WHERE product_code=? LIMIT 1').get(p.code)) {
      throw new HttpError(409, 'این کالا در فاکتور استفاده شده و حذف نمی‌شود؛ آن را غیرفعال کنید.');
    }
    db.prepare('DELETE FROM products WHERE id=?').run(p.id);
    res.json({ ok: true });
  });

  // ---------- مشتریان ----------
  function validateCustomer(b) {
    const name = normalizeText(b.name);
    if (!name) throw bad('نام مشتری الزامی است');
    return { name, national_id: digitsText(b.national_id), phone: digitsText(b.phone), address: clean(b.address), reg_no: digitsText(b.reg_no) };
  }
  app.get('/api/customers', (req, res) => {
    const q = clean(req.query.q);
    const rows = q
      ? db.prepare("SELECT * FROM customers WHERE name LIKE ? ESCAPE '\\' OR national_id LIKE ? ESCAPE '\\' ORDER BY name LIMIT 200")
        .all(`%${q.replace(/[%_\\]/g, '\\$&')}%`, `%${toEnDigits(q).replace(/[%_\\]/g, '\\$&')}%`)
      : db.prepare('SELECT * FROM customers ORDER BY name LIMIT 1000').all();
    res.json(rows);
  });
  app.post('/api/customers', (req, res) => {
    const c = validateCustomer(req.body || {});
    const r = db.prepare('INSERT INTO customers(name,national_id,phone,address,reg_no) VALUES (?,?,?,?,?)').run(c.name, c.national_id, c.phone, c.address, c.reg_no);
    res.status(201).json(db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid));
  });
  app.put('/api/customers/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customers WHERE id=?').get(id)) throw new HttpError(404, 'مشتری پیدا نشد');
    const c = validateCustomer(req.body || {});
    db.prepare('UPDATE customers SET name=?,national_id=?,phone=?,address=?,reg_no=? WHERE id=?').run(c.name, c.national_id, c.phone, c.address, c.reg_no, id);
    res.json(db.prepare('SELECT * FROM customers WHERE id=?').get(id));
  });
  app.delete('/api/customers/:id', (req, res) => {
    db.prepare('DELETE FROM customers WHERE id=?').run(Number(req.params.id)); // فاکتورها نسخه خودشان را دارند
    res.json({ ok: true });
  });

  // ---------- فاکتورها ----------
  const nextNumber = () => {
    const last = Number(getSettings(db).last_invoice_number) || 0;
    const max = db.prepare('SELECT MAX(number) m FROM invoices').get().m || 0;
    return Math.max(last, max) + 1;
  };
  app.get('/api/invoices/next-number', (_q, res) => res.json({ number: nextNumber() }));

  /** اعتبارسنجی بدنه فاکتور و تبدیل به مقادیر نهایی (قیمت/شرح از جدول کالاها). */
  function normalizeInvoice(b, { final, existing }) {
    const errors = [];
    const jdate = toEnDigits(clean(b.jdate));
    if (!isValidJalaliString(jdate)) errors.push('تاریخ نامعتبر است (قالب ۱۴۰۵/۰۷/۱۹)');
    const buyer = {
      name: normalizeText(b.buyer?.name), national_id: digitsText(b.buyer?.national_id), phone: digitsText(b.buyer?.phone),
      address: clean(b.buyer?.address), reg_no: digitsText(b.buyer?.reg_no),
    };
    if (final && !buyer.name) errors.push('نام خریدار الزامی است');
    const items = [];
    const rawItems = Array.isArray(b.items) ? b.items : [];
    rawItems.forEach((r, i) => {
      const code = toEnDigits(clean(r.code));
      const empty = !code && (r.qty === '' || r.qty == null) && !clean(r.remark);
      if (empty) return;
      const row = items.length + 1;
      const p = code && db.prepare('SELECT * FROM products WHERE code=?').get(code);
      if (!p) { errors.push(`ردیف ${i + 1}: کد نامعتبر`); return; }
      const oldRow = existing?.status === 'final' && existing.items.find((x) => x.product_code === code);
      if (!p.active && !oldRow) { errors.push(`ردیف ${i + 1}: کالای ${code} غیرفعال است`); return; }
      const qty = parseNumber(r.qty);
      if (qty === null || qty <= 0 || qty > 1e9) { errors.push(`ردیف ${i + 1}: مقدار نامعتبر`); return; }
      const price = r.unit_price === '' || r.unit_price == null ? p.price : parseNumber(r.unit_price);
      if (price === null || price < 0 || price > 1e13) { errors.push(`ردیف ${i + 1}: مبلغ واحد نامعتبر`); return; }
      // در ویرایش فاکتور نهایی، ردیف‌های قبلی شرح/واحد/قیمت لیستِ لحظه‌ی ثبت را نگه می‌دارند
      const old = existing?.status === 'final' && existing.items.find((x) => x.product_code === code);
      items.push({
        position: row, code, description: old ? old.description : p.description, unit: old ? old.unit : p.unit, qty, unit_price: Math.round(price), list_price: old ? old.list_price : p.price,
        line_total: lineTotal(qty, Math.round(price)), remark: clean(r.remark),
      });
    });
    if (!items.length) errors.push('حداقل یک ردیف کالا لازم است');
    const discount = b.discount === '' || b.discount == null ? 0 : parseNumber(b.discount);
    if (discount === null || discount < 0 || discount > 1e15) errors.push('مبلغ تخفیف نامعتبر است');
    const taxPct = b.tax_percent === '' || b.tax_percent == null ? 0 : parseNumber(b.tax_percent);
    if (taxPct === null || taxPct < 0 || taxPct > 100) errors.push('درصد مالیات نامعتبر است');
    const totals = errors.length ? null : calcTotals(items, discount, taxPct);
    if (totals && totals.discount > totals.subtotal) errors.push('تخفیف از جمع کل بیشتر است');
    if (errors.length) throw new HttpError(422, errors[0], { errors });
    const doc_type = b.doc_type === 'invoice' ? 'invoice' : 'proforma';
    const pay = {};
    for (const k of Object.keys(PAY_LABELS)) pay[k] = !!b.pay?.[k];
    return { jdate, buyer, items, totals, doc_type, pay, notes: clean(b.notes), with_stamp: !!b.with_stamp, customer_id: b.customer_id ? Number(b.customer_id) : null };
  }

  function resolveCustomer(n) {
    if (!n.buyer.name) return null;
    let c = n.customer_id && db.prepare('SELECT * FROM customers WHERE id=?').get(n.customer_id);
    if (!c) c = db.prepare('SELECT * FROM customers WHERE name=?').get(n.buyer.name);
    if (c) return c.id;
    return db.prepare('INSERT INTO customers(name,national_id,phone,address,reg_no) VALUES (?,?,?,?,?)')
      .run(n.buyer.name, n.buyer.national_id, n.buyer.phone, n.buyer.address, n.buyer.reg_no).lastInsertRowid;
  }

  function sellerSnapshot(s) {
    return { ...sellerFrom(s), company_title: s.company_title, title_proforma: s.invoice_title, title_sale: s.invoice_title_sale, show_code: s.show_code_in_print === '1', holder: s.account_holder };
  }
  /** فهرست خطوط پرداخت؛ مقدار قبلی ذخیره‌شده در همان فاکتور حفظ می‌شود. */
  function payList(flags, oldJson, s) {
    const old = oldJson ? JSON.parse(oldJson) : [];
    const out = [];
    for (const [k, [label, key]] of Object.entries(PAY_LABELS)) {
      if (!flags[k]) continue;
      const prev = old.find((x) => x.key === k);
      const value = prev?.value || s[key];
      if (value) out.push({ key: k, label, value });
    }
    if (out.length && s.account_holder) out.push({ key: 'holder', label: 'به نام', value: s.account_holder });
    return out;
  }
  function sellerFrom(s) {
    return { name: s.seller_name, national_id: s.seller_national_id, phone: s.seller_phone, address: s.seller_address };
  }

  function saveInvoice(id, n, { final, copiedFrom, existing }) {
    const now = new Date().toISOString();
    const s = getSettings(db);
    const stampOk = n.with_stamp && s.stamp_file && fs.existsSync(path.join(dataDir, 'stamps', s.stamp_file));
    return tx(db, () => {
      const customerId = resolveCustomer(n);
      const t = n.totals;
      const words = amountToWords(t.payable);
      const f = {
        jdate: n.jdate, customer_id: customerId, ...Object.fromEntries(Object.entries(n.buyer).map(([k, v]) => ['buyer_' + k, v])),
        subtotal: t.subtotal, discount: t.discount, tax_percent: t.taxPercent, tax_amount: t.taxAmount, payable: t.payable,
        amount_words: words, notes: n.notes, with_stamp: stampOk ? 1 : 0, stamp_file: stampOk ? s.stamp_file : null,
        status: final ? 'final' : 'draft', doc_type: n.doc_type, pay_json: JSON.stringify(payList(n.pay, existing?.pay_json, s)),
        seller_json: final ? (existing?.seller_json || JSON.stringify(sellerSnapshot(s))) : null,
        finalized_at: final ? (existing?.finalized_at || now) : null, updated_at: now,
      };
      if (id) {
        const cols = Object.keys(f);
        db.prepare(`UPDATE invoices SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`).run(...cols.map((c) => f[c]), id);
        db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(id);
      } else {
        const cols = ['number', 'created_at', 'copied_from', ...Object.keys(f)];
        const vals = [nextNumber(), now, copiedFrom ?? null, ...Object.values(f)];
        id = db.prepare(`INSERT INTO invoices(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid;
      }
      const ins = db.prepare(`INSERT INTO invoice_items(invoice_id,position,product_code,description,qty,unit,unit_price,list_price,line_total,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const it of n.items) ins.run(id, it.position, it.code, it.description, it.qty, it.unit, it.unit_price, it.list_price, it.line_total, it.remark);
      return Number(id);
    });
  }

  function loadInvoice(id) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
    if (!inv) throw new HttpError(404, 'فاکتور پیدا نشد');
    inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY position').all(id);
    return inv;
  }

  function renderData(inv, { stampFile } = {}) {
    const s = getSettings(db);
    const snap = inv.seller_json ? JSON.parse(inv.seller_json) : null;
    const seller = snap || sellerSnapshot(s);
    const sf = stampFile ?? inv.stamp_file;
    return {
      number: inv.number, jdate: inv.jdate, company_title: seller.company_title,
      invoice_title: inv.doc_type === 'invoice' ? (seller.title_sale || s.invoice_title_sale) : (seller.title_proforma || seller.invoice_title || s.invoice_title),
      pay: inv.pay_json ? JSON.parse(inv.pay_json) : [],
      seller: { name: seller.name, national_id: seller.national_id, phone: seller.phone, address: seller.address },
      buyer: { name: inv.buyer_name, national_id: inv.buyer_national_id, phone: inv.buyer_phone, address: inv.buyer_address, reg_no: inv.buyer_reg_no },
      items: inv.items.map((i) => ({ code: i.product_code, description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price, line_total: i.line_total, remark: i.remark })),
      totals: { subtotal: inv.subtotal, discount: inv.discount, taxPercent: inv.tax_percent, taxAmount: inv.tax_amount, payable: inv.payable },
      words: inv.amount_words, notes: inv.notes, show_code: seller.show_code,
      stamp_data_uri: sf && inv.with_stamp ? stampDataUri(path.join(dataDir, 'stamps', sf)) : null,
    };
  }

  const safeName = (s) => String(s).replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const pdfFileName = (inv) => `${inv.number} - ${safeName(inv.buyer_name) || 'بدون نام'}.pdf`;
  const sendPdf = (res, buf, name, inline) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="invoice.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buf);
  };

  async function finalizeWithPdf(id) {
    const inv = loadInvoice(id);
    try {
      const pdf = await htmlToPdf(renderInvoiceHtml(renderData(inv), { embedFonts: true }));
      const file = `${inv.number}.pdf`;
      fs.writeFileSync(path.join(dataDir, 'pdfs', file), pdf);
      db.prepare('UPDATE invoices SET pdf_file=? WHERE id=?').run(file, id);
    } catch (e) {
      // ساخت PDF شکست خورد: فاکتور را به پیش‌نویس برگردان تا ناقص نهایی نشود
      db.prepare("UPDATE invoices SET status='draft', seller_json=NULL, finalized_at=NULL WHERE id=?").run(id);
      throw new HttpError(500, 'ساخت PDF ناموفق بود و فاکتور به‌صورت پیش‌نویس ماند: ' + e.message);
    }
  }

  const summary = (id) => {
    const inv = loadInvoice(id);
    return { ...inv, seller: inv.seller_json ? JSON.parse(inv.seller_json) : { ...sellerFrom(getSettings(db)) } };
  };

  app.post('/api/invoices', async (req, res) => {
    const final = req.body?.finalize === true;
    const n = normalizeInvoice(req.body || {}, { final });
    const id = saveInvoice(null, n, { final, copiedFrom: req.body?.copied_from });
    if (final) await finalizeWithPdf(id);
    res.status(201).json(summary(id));
  });
  app.put('/api/invoices/:id', async (req, res) => {
    const id = Number(req.params.id);
    const cur = loadInvoice(id);
    // نهایی‌ها هم قابل ویرایش‌اند (PDF دوباره ساخته می‌شود)؛ to_draft برای برگرداندن به پیش‌نویس
    const final = req.body?.to_draft === true ? false : (req.body?.finalize === true || cur.status === 'final');
    const n = normalizeInvoice(req.body || {}, { final, existing: cur });
    saveInvoice(id, n, { final, existing: cur });
    if (final) await finalizeWithPdf(id);
    res.json(summary(id));
  });
  app.delete('/api/invoices/:id', (req, res) => {
    const inv = loadInvoice(Number(req.params.id));
    db.prepare('DELETE FROM invoices WHERE id=?').run(inv.id);
    if (inv.pdf_file) fs.rmSync(path.join(dataDir, 'pdfs', inv.pdf_file), { force: true });
    res.json({ ok: true });
  });
  app.post('/api/invoices/:id/copy', (req, res) => {
    const src = loadInvoice(Number(req.params.id));
    const id = tx(db, () => {
      const now = new Date().toISOString();
      const s = getSettings(db);
      const newId = db.prepare(`INSERT INTO invoices(number,jdate,status,doc_type,pay_json,customer_id,buyer_name,buyer_national_id,buyer_phone,buyer_address,buyer_reg_no,
        subtotal,discount,tax_percent,tax_amount,payable,amount_words,notes,copied_from,created_at,updated_at) VALUES (?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(nextNumber(), todayJalali(), src.doc_type, src.pay_json, src.customer_id, src.buyer_name, src.buyer_national_id, src.buyer_phone, src.buyer_address, src.buyer_reg_no,
          src.subtotal, src.discount, src.tax_percent, src.tax_amount, src.payable, src.amount_words, src.notes, src.id, now, now).lastInsertRowid;
      const ins = db.prepare(`INSERT INTO invoice_items(invoice_id,position,product_code,description,qty,unit,unit_price,list_price,line_total,remark) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const i of src.items) ins.run(newId, i.position, i.product_code, i.description, i.qty, i.unit, i.unit_price, i.list_price, i.line_total, i.remark);
      return Number(newId);
    });
    res.status(201).json(summary(id));
  });

  app.get('/api/invoices/export.xlsx', async (req, res) => {
    const rows = queryInvoices(req.query, { all: true }).rows;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('فاکتورها', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'شماره', key: 'number', width: 12 }, { header: 'نوع', key: 'type', width: 12 }, { header: 'تاریخ', key: 'jdate', width: 12 },
      { header: 'خریدار', key: 'buyer_name', width: 28 }, { header: 'شناسه ملی خریدار', key: 'nid', width: 18 },
      { header: 'جمع کل (ریال)', key: 'subtotal', width: 20 }, { header: 'تخفیف (ریال)', key: 'discount', width: 16 },
      { header: 'مالیات (ریال)', key: 'tax_amount', width: 16 }, { header: 'مبلغ قابل پرداخت (ریال)', key: 'payable', width: 24 },
      { header: 'وضعیت', key: 'status', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow({ ...r, type: r.doc_type === 'invoice' ? 'فاکتور' : 'پیش‌فاکتور', nid: r.buyer_national_id, status: r.status === 'final' ? 'نهایی' : 'پیش‌نویس' });
    }
    for (const k of ['subtotal', 'discount', 'tax_amount', 'payable']) ws.getColumn(k).numFmt = '#,##0';
    ws.getColumn('nid').numFmt = '@';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="invoices.xlsx"; filename*=UTF-8''${encodeURIComponent('فهرست-فاکتورها.xlsx')}`);
    await wb.xlsx.write(res);
    res.end();
  });

  function queryInvoices(q, { all = false } = {}) {
    const where = [];
    const args = [];
    const text = clean(q.q);
    if (text) {
      where.push("(buyer_name LIKE ? ESCAPE '\\' OR CAST(number AS TEXT) LIKE ?)");
      args.push(`%${text.replace(/[%_\\]/g, '\\$&')}%`, `%${toEnDigits(text).replace(/[%_\\]/g, '\\$&')}%`);
    }
    const from = toEnDigits(clean(q.from)); const to = toEnDigits(clean(q.to));
    if (from) { where.push('jdate >= ?'); args.push(from); }
    if (to) { where.push('jdate <= ?'); args.push(to); }
    if (q.status === 'draft' || q.status === 'final') { where.push('status = ?'); args.push(q.status); }
    if (q.doc_type === 'proforma' || q.doc_type === 'invoice') { where.push('doc_type = ?'); args.push(q.doc_type); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM invoices ${w}`).get(...args).c;
    const page = Math.max(1, Number(q.page) || 1);
    const size = 25;
    const rows = db.prepare(`SELECT id,number,jdate,doc_type,buyer_name,buyer_national_id,subtotal,discount,tax_amount,payable,status,copied_from FROM invoices ${w}
      ORDER BY number DESC ${all ? '' : `LIMIT ${size} OFFSET ${(page - 1) * size}`}`).all(...args);
    return { rows, total, page, size };
  }
  app.get('/api/invoices', (req, res) => res.json(queryInvoices(req.query)));

  app.post('/api/invoices/preview-html', (req, res) => {
    const n = normalizeInvoice(req.body || {}, { final: false });
    const s = getSettings(db);
    const stampFile = n.with_stamp ? s.stamp_file : null;
    const number = req.body?.number ? Number(toEnDigits(req.body.number)) : nextNumber();
    const inv = {
      number, jdate: n.jdate, doc_type: n.doc_type, pay_json: JSON.stringify(payList(n.pay, null, s)), buyer_name: n.buyer.name, buyer_national_id: n.buyer.national_id, buyer_phone: n.buyer.phone,
      buyer_address: n.buyer.address, buyer_reg_no: n.buyer.reg_no, items: n.items.map((i) => ({ ...i, product_code: i.code })),
      subtotal: n.totals.subtotal, discount: n.totals.discount, tax_percent: n.totals.taxPercent, tax_amount: n.totals.taxAmount,
      payable: n.totals.payable, amount_words: amountToWords(n.totals.payable), notes: n.notes, with_stamp: !!stampFile, stamp_file: stampFile,
    };
    res.type('html').send(renderInvoiceHtml(renderData(inv)));
  });

  app.get('/api/invoices/:id', (req, res) => res.json(summary(Number(req.params.id))));

  app.get('/api/invoices/:id/pdf', async (req, res) => {
    const inv = loadInvoice(Number(req.params.id));
    const inline = req.query.inline === '1';
    if (inv.status === 'final' && inv.pdf_file && fs.existsSync(path.join(dataDir, 'pdfs', inv.pdf_file))) {
      return sendPdf(res, fs.readFileSync(path.join(dataDir, 'pdfs', inv.pdf_file)), pdfFileName(inv), inline);
    }
    const pdf = await htmlToPdf(renderInvoiceHtml(renderData(inv), { embedFonts: true }));
    sendPdf(res, pdf, pdfFileName(inv), inline);
  });

  // ---------- بکاپ ----------
  app.get('/api/backup', (_req, res) => {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = path.join(dataDir, 'backups', `factormaker-${stamp}.db`);
    if (fs.existsSync(file)) fs.rmSync(file);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    res.download(file, path.basename(file));
  });

  // ---------- خطاها ----------
  app.use('/api', (_q, _r, next) => next(new HttpError(404, 'یافت نشد')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'درخواست نامعتبر' });
    if (/UNIQUE/.test(err.message || '')) return res.status(400).json({ error: 'مقدار تکراری' });
    console.error(err);
    res.status(500).json({ error: 'خطای داخلی سرور' });
  });

  return { app, db, firstAdmin, dataDir };
}
