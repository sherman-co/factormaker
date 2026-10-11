import { get, post, put, del, ApiError } from '../api.js';
import { h, toast, modal, confirmBox, bindNumber, numValue, setNum, bindDigitsText, digitsValue, setDigits, autocomplete, bindDate, download } from '../ui.js';
import { todayJalali } from '/shared/jdate.js';
import { formatNumber, toFaDigits, toEnDigits, calcTotals, lineTotal, amountToWords } from '/shared/format.js';

export async function invoicePage(root, idParam) {
  const isNew = idParam === 'new';
  const [settings, products, today, nextNo] = await Promise.all([
    get('/api/settings'), get('/api/products'), get('/api/today'), isNew ? get('/api/invoices/next-number') : null,
  ]);
  let inv = null;
  let srcId = null;
  if (!isNew) inv = await get('/api/invoices/' + idParam);
  const readonly = inv?.status === 'final';
  const byCode = new Map(products.map((p) => [p.code, p]));
  const activeProducts = products.filter((p) => p.active);

  // ---------- فیلدهای سربرگ ----------
  const dateInput = h('input', { disabled: readonly });
  const dp = bindDate(dateInput, { today: today.jdate });
  dp.set(inv?.jdate || today.jdate);
  const buyer = {
    name: h('input', { disabled: readonly, placeholder: 'با تایپ چند حرف، از مشتریان پیشنهاد می‌شود' }),
    national_id: bindDigitsText(h('input', { disabled: readonly })), phone: bindDigitsText(h('input', { disabled: readonly })),
    reg_no: bindDigitsText(h('input', { disabled: readonly })), address: h('input', { disabled: readonly }),
  };
  let customerId = inv?.customer_id || null;
  if (inv) {
    buyer.name.value = inv.buyer_name; setDigits(buyer.national_id, inv.buyer_national_id); setDigits(buyer.phone, inv.buyer_phone);
    setDigits(buyer.reg_no, inv.buyer_reg_no); buyer.address.value = inv.buyer_address;
  }
  const fld = (l, el, style) => h('div', { class: 'field', style }, h('label', {}, l), el);

  // ---------- جدول اقلام ----------
  const tbody = h('tbody');
  let rows = [];
  const discount = bindNumber(h('input', { disabled: readonly }), { onChange: () => recalc() });
  const taxPct = bindNumber(h('input', { disabled: readonly }), { decimal: true, onChange: () => recalc() });
  const notes = h('textarea', { rows: 2, disabled: readonly });
  const withStamp = h('input', { type: 'checkbox', disabled: readonly, checked: inv ? !!inv.with_stamp : settings.stamp_in_pdf === '1' && settings.has_stamp });
  const subtotalEl = h('b'); const taxAmtEl = h('b'); const payEl = h('b'); const wordsEl = h('div', { style: 'font-weight:700;line-height:1.9' });
  const taxAmtRow = h('div', { class: 'trow' }, h('span', {}, 'مبلغ مالیات'), taxAmtEl);

  function makeRow(init = {}) {
    const r = { code: init.code || '', qty: init.qty ?? '', price: init.unit_price ?? null, priceEdited: init.unit_price != null && !!init.edited, remark: init.remark || '', stored: init.stored || null };
    const code = h('input', { disabled: readonly, placeholder: 'کد یا شرح', style: 'min-width:110px' });
    const desc = h('td', { class: 'ro' });
    const qty = bindNumber(h('input', { disabled: readonly }), { decimal: true, onChange: () => { r.qty = numValue(qty); update(); } });
    const unit = h('td', { class: 'ro', style: 'text-align:center' });
    const price = bindNumber(h('input', { disabled: readonly }), { onChange: () => { r.price = numValue(price); r.priceEdited = true; update(); } });
    const total = h('td', { class: 'ro num', style: 'text-align:right;font-weight:700' });
    const remark = h('input', { disabled: readonly, value: r.remark, oninput: () => { r.remark = remark.value; } });
    const num = h('td', { class: 'rn' });

    const prod = () => byCode.get(toEnDigits(code.value).trim());
    const update = () => {
      const p = prod();
      const raw = toEnDigits(code.value).trim();
      code.classList.toggle('bad', !!raw && !p);
      code.title = raw && !p ? 'کد نامعتبر' : '';
      const shown = p || (readonly && r.stored);
      desc.textContent = shown ? shown.description : (raw ? 'کد نامعتبر' : '');
      desc.style.color = raw && !p && !readonly ? 'var(--danger)' : '';
      unit.textContent = shown ? shown.unit : '';
      if (p && !p.active && !readonly) { desc.textContent = p.description + ' (غیرفعال)'; desc.style.color = 'var(--danger)'; code.classList.add('bad'); }
      const list = p ? p.price : (r.stored?.list_price ?? null);
      price.classList.toggle('diff', list != null && r.price != null && r.price !== list);
      price.title = price.classList.contains('diff') ? `قیمت لیست: ${formatNumber(list)}` : '';
      total.textContent = r.price != null && r.qty ? formatNumber(lineTotal(r.qty, r.price)) : '';
      recalc();
    };
    const setProduct = (p) => {
      code.value = toFaDigits(p.code); r.price = p.price; r.priceEdited = false; setNum(price, p.price); update();
    };
    code.addEventListener('input', () => {
      const p = prod();
      if (p) { r.price = p.price; setNum(price, p.price); r.priceEdited = false; }
      else { r.price = null; setNum(price, null); }
      update();
    });
    autocomplete(code, {
      search: async (q) => {
        const t = toEnDigits(q).trim().toLowerCase();
        return activeProducts.filter((p) => !t || p.code.includes(t) || p.description.toLowerCase().includes(t));
      },
      label: (p) => `${toFaDigits(p.code)} — ${p.description}`, sub: (p) => formatNumber(p.price),
      onPick: setProduct,
    });
    r.code = init.code || '';
    if (init.code) code.value = toFaDigits(init.code);
    if (init.qty != null && init.qty !== '') setNum(qty, init.qty);
    if (init.unit_price != null) setNum(price, init.unit_price);
    r.qty = init.qty ?? ''; r.price = init.unit_price ?? null;
    const act = h('td', { class: 'rowact' },
      readonly ? null : [
        h('button', { type: 'button', title: 'بالا', onclick: () => move(r, -1) }, '▲'),
        h('button', { type: 'button', title: 'پایین', onclick: () => move(r, 1) }, '▼'),
        h('button', { type: 'button', title: 'حذف ردیف', style: 'color:var(--danger)', onclick: () => removeRow(r) }, '✕')]);
    r.el = h('tr', {}, num, h('td', {}, code), desc, h('td', {}, qty), unit, h('td', {}, price), total, h('td', {}, remark), act);
    r.num = num; r.codeEl = code; r.qtyEl = qty; r.getCode = () => toEnDigits(code.value).trim(); r.update = update;
    r.getQty = () => numValue(qty); r.getPrice = () => numValue(price);
    update();
    return r;
  }
  function renumber() { rows.forEach((r, i) => { r.num.textContent = toFaDigits(i + 1); }); }
  function paintRows() { tbody.replaceChildren(...rows.map((r) => r.el)); renumber(); recalc(); }
  function addRow(init, focus) {
    const r = makeRow(init); rows.push(r); paintRows(); if (focus) r.codeEl.focus(); return r;
  }
  function removeRow(r) { rows = rows.filter((x) => x !== r); if (!rows.length) rows.push(makeRow()); paintRows(); }
  function move(r, d) {
    const i = rows.indexOf(r); const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]]; paintRows();
  }

  function currentTotals() {
    const items = rows.map((r) => ({ qty: r.getQty() || 0, unit_price: r.getPrice() || 0 }));
    return calcTotals(items, numValue(discount) || 0, numValue(taxPct) || 0);
  }
  function recalc() {
    if (!rows) return;
    const t = currentTotals();
    subtotalEl.textContent = formatNumber(t.subtotal); taxAmtEl.textContent = formatNumber(t.taxAmount);
    payEl.textContent = formatNumber(t.payable);
    wordsEl.textContent = amountToWords(Math.max(0, t.payable));
    taxAmtRow.style.display = t.taxPercent > 0 ? '' : 'none';
  }

  // مقادیر اولیه
  if (inv) {
    setNum(discount, inv.discount); setNum(taxPct, inv.tax_percent); notes.value = inv.notes;
    rows = inv.items.map((i) => makeRow({ code: i.product_code, qty: i.qty, unit_price: i.unit_price, remark: i.remark, edited: i.unit_price !== i.list_price, stored: { description: i.description, unit: i.unit, list_price: i.list_price } }));
  } else {
    setNum(discount, 0); setNum(taxPct, Number(settings.default_tax_percent)); notes.value = settings.default_notes;
    rows = Array.from({ length: 3 }, () => makeRow());
  }
  paintRows();

  // مشتری
  if (!readonly) {
    autocomplete(buyer.name, {
      search: (q) => (q.trim().length >= 1 ? get('/api/customers?q=' + encodeURIComponent(q.trim())) : Promise.resolve([])),
      label: (c) => c.name, sub: (c) => toFaDigits(c.national_id),
      onPick: (c) => {
        customerId = c.id; buyer.name.value = c.name; setDigits(buyer.national_id, c.national_id); setDigits(buyer.phone, c.phone);
        setDigits(buyer.reg_no, c.reg_no); buyer.address.value = c.address;
      },
    });
    buyer.name.addEventListener('input', () => { customerId = null; });
  }

  // ---------- ارسال ----------
  function payload(extra = {}) {
    return {
      jdate: dp.get(), customer_id: customerId, with_stamp: withStamp.checked, notes: notes.value,
      buyer: { name: buyer.name.value, national_id: digitsValue(buyer.national_id), phone: digitsValue(buyer.phone), address: buyer.address.value, reg_no: digitsValue(buyer.reg_no) },
      discount: numValue(discount) ?? 0, tax_percent: numValue(taxPct) ?? 0,
      items: rows.map((r) => ({ code: r.getCode(), qty: r.getQty() ?? '', unit_price: r.getPrice() ?? '', remark: r.remark })),
      ...extra,
    };
  }
  function showError(e) {
    toast(e.message, 'error');
    if (e.data?.errors?.length > 1) toast(e.data.errors.slice(1, 4).join(' | '), 'error');
  }
  async function save(finalize) {
    const body = payload({ finalize, ...(srcId ? { copied_from: srcId } : {}) });
    const res = inv ? await put('/api/invoices/' + inv.id, body) : await post('/api/invoices', body);
    return res;
  }
  let busy = false;
  const guard = (fn) => async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { if (e instanceof ApiError) showError(e); else { console.error(e); toast('خطای غیرمنتظره', 'error'); } } finally { busy = false; } };

  const btnDraft = h('button', { class: 'btn', onclick: guard(async () => {
    const r = await save(false); toast('پیش‌نویس ذخیره شد', 'ok'); if (!inv) location.hash = '#/invoice/' + r.id; else { inv = r; }
  }) }, 'ذخیره پیش‌نویس');
  const btnFinal = h('button', { class: 'btn primary', onclick: guard(async () => {
    if (!(await confirmBox('پس از ثبت نهایی، فاکتور قابل ویرایش نیست و PDF آن ذخیره می‌شود. ادامه می‌دهید؟', 'ثبت نهایی'))) return;
    const r = await save(true); toast('فاکتور نهایی شد', 'ok'); location.hash = '#/invoice/' + r.id; if (inv && String(inv.id) === String(r.id)) location.reload();
  }) }, 'ثبت نهایی');
  const btnPreview = h('button', { class: 'btn', onclick: guard(async () => {
    const frame = h('iframe', { style: 'flex:1;border:1px solid var(--line);border-radius:8px;width:100%' });
    if (readonly) frame.src = `/api/invoices/${inv.id}/pdf?inline=1`;
    else {
      const res = await fetch('/api/invoices/preview-html', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload({ number: inv?.number ?? nextNo?.number })) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(d.error || 'خطا', d, res.status); }
      frame.srcdoc = await res.text();
    }
    const m = modal('پیش‌نمایش چاپ', h('div', { style: 'display:flex;flex-direction:column;flex:1;gap:10px;min-height:0' },
      h('div', { class: 'actions', style: 'margin:0' },
        h('button', { class: 'btn primary', onclick: () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { toast('چاپ از همین پنجره ممکن نشد؛ PDF را دانلود کنید.', 'error'); } } }, 'چاپ'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'بستن')), frame), { wide: true });
  }) }, 'پیش‌نمایش چاپ');
  const btnPdf = h('button', { class: 'btn', onclick: guard(async () => {
    if (readonly) { download(`/api/invoices/${inv.id}/pdf`); return; }
    const r = await save(false); // ابتدا به‌صورت پیش‌نویس ذخیره می‌شود
    if (!inv) { inv = r; history.replaceState(null, '', '#/invoice/' + r.id); } else inv = r;
    download(`/api/invoices/${r.id}/pdf`); toast('پیش‌نویس ذخیره و PDF آماده شد', 'ok');
  }) }, 'دانلود PDF');
  const btnCopy = h('button', { class: 'btn', onclick: guard(async () => {
    if (!inv) { toast('ابتدا فاکتور را ذخیره کنید', 'error'); return; }
    const c = await post(`/api/invoices/${inv.id}/copy`); toast('فاکتور جدید ساخته شد', 'ok'); location.hash = '#/invoice/' + c.id;
  }) }, readonly ? 'کپی و اصلاح' : 'کپی گرفتن');
  const btnDel = inv && !readonly ? h('button', { class: 'btn danger', onclick: guard(async () => {
    if (!(await confirmBox('این پیش‌نویس حذف شود؟', 'حذف'))) return;
    await del('/api/invoices/' + inv.id); toast('حذف شد', 'ok'); location.hash = '#/';
  }) }, 'حذف پیش‌نویس') : null;

  const sellerLine = inv?.seller || { name: settings.seller_name, national_id: settings.seller_national_id, phone: settings.seller_phone, address: settings.seller_address };

  root.append(h('div', { class: 'wrap' },
    readonly ? h('div', { class: 'banner' }, `✔ فاکتور نهایی شده در ${toFaDigits(todayJalali(new Date(inv.finalized_at)))} — قابل ویرایش نیست. برای اصلاح از «کپی و اصلاح» استفاده کنید.`)
      : inv ? h('div', { class: 'banner draft' }, 'پیش‌نویس — هنوز نهایی نشده است.') : null,
    h('div', { class: 'card' },
      h('h1', {}, isNew ? 'صدور پیش‌فاکتور جدید' : `پیش‌فاکتور شماره ${toFaDigits(inv.number)}`),
      h('div', { class: 'inv-head' },
        fld('شماره فاکتور', h('input', { disabled: true, value: toFaDigits(inv?.number ?? nextNo.number) })),
        fld('تاریخ (شمسی)', dateInput)),
      h('div', { class: 'seller-box' }, h('b', {}, 'فروشنده: '), `${sellerLine.name} — شناسه ملی: ${toFaDigits(sellerLine.national_id)}`,
        sellerLine.phone ? ` — تلفن: ${toFaDigits(sellerLine.phone)}` : '', h('br'), 'نشانی: ', sellerLine.address)),
    h('div', { class: 'card' }, h('h2', {}, 'مشخصات خریدار'),
      h('div', { class: 'row' }, fld('نام شخص حقیقی / حقوقی', buyer.name, 'flex:2'), fld('شناسه ملی', buyer.national_id), fld('تلفن', buyer.phone)),
      h('div', { class: 'row', style: 'margin-top:10px' }, fld('نشانی', buyer.address, 'flex:3'), fld('شماره ثبت', buyer.reg_no))),
    h('div', { class: 'card' }, h('h2', {}, 'اقلام'),
      h('div', { class: 'tablewrap', style: 'overflow-y:visible' }, h('table', { class: 'items-table' },
        h('thead', {}, h('tr', {}, ['ردیف', 'کد کالا', 'شرح کالا', 'مقدار', 'واحد', 'مبلغ واحد (ریال)', 'مبلغ کل (ریال)', 'توضیحات', ''].map((t) => h('th', {}, t)))), tbody)),
      readonly ? null : h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => addRow({}, true) }, '+ افزودن ردیف')),
      h('div', { class: 'totals' },
        h('div', { class: 'box' }, h('b', {}, 'مبلغ به حروف'), wordsEl,
          h('div', { style: 'margin-top:10px' }, h('b', {}, 'توضیحات فاکتور'), notes),
          settings.has_stamp ? h('label', { style: 'display:block;margin-top:8px' }, withStamp, ' درج مهر در PDF') : null),
        h('div', { class: 'box' },
          h('div', { class: 'trow' }, h('span', {}, 'جمع کل'), subtotalEl),
          h('div', { class: 'trow' }, h('span', {}, 'تخفیف (ریال)'), discount),
          h('div', { class: 'trow' }, h('span', {}, 'درصد مالیات بر ارزش افزوده'), taxPct),
          taxAmtRow,
          h('div', { class: 'trow pay' }, h('span', {}, 'مبلغ قابل پرداخت (ریال)'), payEl))),
      h('div', { class: 'btnbar' }, readonly ? null : [btnDraft, btnFinal], btnPreview, btnPdf, btnCopy, btnDel))));
  recalc();
  if (isNew) rows[0].codeEl.focus();
}
