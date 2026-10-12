import { get, post, put, del, ApiError } from '../api.js';
import { h, toast, modal, confirmBox, bindNumber, numValue, setNum, bindDigitsText, digitsValue, setDigits, autocomplete, bindDate, download } from '../ui.js';
import { todayJalali } from '/shared/jdate.js';
import { pending } from '../state.js';
import { openShare, autoShareBox, reportShare } from '../share.js';
import { formatNumber, toFaDigits, toEnDigits, calcTotals, lineTotal, amountToWords, normalizeSearch, groupOfCode, DOC_TYPES } from '/shared/format.js';

export async function invoicePage(root, idParam) {
  const isNew = idParam === 'new';
  const [settings, products, today, nextNo, accounts] = await Promise.all([
    get('/api/settings'), get('/api/products'), get('/api/today'), isNew ? get('/api/invoices/next-number') : null, get('/api/payment-accounts'),
  ]);
  let inv = null;
  let srcId = null;
  if (!isNew) inv = await get('/api/invoices/' + idParam);
  const readonly = false;
  const isFinal = inv?.status === 'final';
  let docType = inv?.doc_type || 'proforma';
  const savedPayRaw = inv?.pay_json ? JSON.parse(inv.pay_json) : null;
  const savedPay = savedPayRaw && (Array.isArray(savedPayRaw) ? { account_id: null, lines: savedPayRaw } : savedPayRaw);
  const byCode = new Map(products.map((p) => [p.code, p]));
  const storedByCode = new Map((inv?.status === 'final' ? inv.items : []).map((i) => [i.product_code, { description: i.description, unit: i.unit, list_price: i.list_price, price: i.price, active: true }]));
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
  const payChecks = {};
  const PAYS = [['card', 'شماره کارت'], ['sheba', 'شماره شبا'], ['account', 'شماره حساب']];
  const accSel = h('select', { onchange: () => paintPay() },
    h('option', { value: '' }, 'بدون درج اطلاعات پرداخت'),
    accounts.map((a) => h('option', { value: a.id, selected: savedPay?.account_id === a.id }, a.title + (a.holder ? ` — ${a.holder}` : ''))));
  const payOpts = h('div', { class: 'payopts' });
  for (const [k] of PAYS) payChecks[k] = h('input', { type: 'checkbox', checked: !!savedPay?.lines?.some((x) => x.key === k) });
  function paintPay() {
    const acc = accounts.find((a) => String(a.id) === accSel.value);
    payOpts.replaceChildren(...(acc ? PAYS.map(([k, l]) => {
      const has = !!acc[k === 'card' ? 'card' : k === 'sheba' ? 'sheba' : 'account'];
      if (!has) payChecks[k].checked = false;
      else if (!payChecks[k]._touched && !savedPay?.lines?.length) payChecks[k].checked = true;
      payChecks[k].disabled = !has;
      payChecks[k].onchange = () => { payChecks[k]._touched = true; };
      return h('label', { style: has ? '' : 'color:var(--muted)', title: has ? '' : 'برای این حساب ثبت نشده' }, payChecks[k], ' ', l);
    }) : []));
  }
  const payBox = h('div', {}, h('b', {}, 'درج اطلاعات پرداخت در فاکتور'),
    accounts.length
      ? h('div', { style: 'margin-top:6px' }, accSel, payOpts)
      : h('div', { class: 'muted', style: 'margin-top:6px' }, 'ابتدا در «تنظیمات ← حساب‌های بانکی» یک حساب ثبت کنید.'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, 'در چاپ، کادر توضیحات نصف می‌شود و این اطلاعات کنار آن می‌آید.'));
  const subtotalEl = h('b'); const taxAmtEl = h('b'); const payEl = h('b'); const wordsEl = h('div', { style: 'font-weight:700;line-height:1.9' });
  const taxAmtRow = h('div', { class: 'trow' }, h('span', {}, 'مبلغ مالیات'), taxAmtEl);

  function makeRow(init = {}) {
    const r = { code: init.code || '', qty: init.qty ?? '', price: init.unit_price ?? null, priceEdited: init.unit_price != null && !!init.edited, remark: init.remark || '', stored: init.stored || null };
    const code = h('input', { disabled: readonly, placeholder: 'کد یا نام کالا...', style: 'min-width:130px' });
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
      code.classList.toggle('bad', !!raw && !p && !st);
      code.title = raw && !p ? 'کد نامعتبر' : '';
      const st = storedByCode.get(raw);
      const shown = st || p;
      desc.textContent = shown ? shown.description : (raw ? 'کد نامعتبر' : '');
      desc.style.color = raw && !p && !readonly ? 'var(--danger)' : '';
      unit.textContent = shown ? shown.unit : '';
      if (p && !p.active && !st) { desc.textContent = p.description + ' (غیرفعال)'; desc.style.color = 'var(--danger)'; code.classList.add('bad'); }
      const list = st ? st.list_price : (p ? p.price : null);
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
        const t = normalizeSearch(q);
        const hits = activeProducts.filter((p) => !t || p.code.includes(t) || normalizeSearch(p.description).includes(t) || normalizeSearch(p.group).includes(t));
        return hits;
      },
      label: (p) => p.description, meta: (p) => toFaDigits(p.code), sub: (p) => `${formatNumber(p.price)} / ${p.unit}`,
      group: (p) => p.group,
      onPick: setProduct,
    });
    r.code = init.code || '';
    if (init.code) code.value = toFaDigits(init.code);
    if (init.code && init.unit_price == null && byCode.get(init.code)) { init.unit_price = byCode.get(init.code).price; }
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
  let prefilled = 0;
  if (inv) {
    setNum(discount, inv.discount); setNum(taxPct, inv.tax_percent); notes.value = inv.notes;
    rows = inv.items.map((i) => makeRow({ code: i.product_code, qty: i.qty, unit_price: i.unit_price, remark: i.remark, edited: i.unit_price !== i.list_price, stored: { description: i.description, unit: i.unit, list_price: i.list_price } }));
  } else {
    setNum(discount, 0); setNum(taxPct, Number(settings.default_tax_percent)); notes.value = settings.default_notes;
    if (pending.codes.length) {
      rows = pending.codes.map((code) => makeRow({ code }));
      prefilled = pending.codes.length;
      pending.codes = [];
    } else rows = Array.from({ length: 3 }, () => makeRow());
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
      jdate: dp.get(), customer_id: customerId, doc_type: docType, pay: { account_id: accSel.value || null, ...Object.fromEntries(Object.entries(payChecks).map(([k, c]) => [k, c.checked])) }, with_stamp: withStamp.checked, notes: notes.value,
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
    const platforms = (finalize || isFinal) ? autoShare.selected() : [];
    const body = payload({ finalize, ...(srcId ? { copied_from: srcId } : {}), ...(platforms.length ? { share: { platforms } } : {}) });
    const res = inv ? await put('/api/invoices/' + inv.id, body) : await post('/api/invoices', body);
    return res;
  }
  let busy = false;
  const guard = (fn) => async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { if (e instanceof ApiError) showError(e); else { console.error(e); toast('خطای غیرمنتظره', 'error'); } } finally { busy = false; } };

  const btnDraft = h('button', { class: 'btn', onclick: guard(async () => {
    const r = await save(false); toast('پیش‌نویس ذخیره شد', 'ok'); if (!inv) location.hash = '#/invoice/' + r.id; else { inv = r; }
  }) }, 'ذخیره پیش‌نویس');
  const btnFinal = h('button', { class: 'btn primary', onclick: guard(async () => {
    if (!(await confirmBox('فاکتور نهایی و PDF آن ذخیره می‌شود (بعداً هم می‌توانید آن را ویرایش کنید). ادامه می‌دهید؟', 'ثبت نهایی'))) return;
    const r = await save(true); toast('فاکتور نهایی شد', 'ok'); reportShare(r.share_results); if (inv && String(inv.id) === String(r.id)) location.reload(); else location.hash = '#/invoice/' + r.id;
  }) }, 'ثبت نهایی');
  const btnSaveFinal = h('button', { class: 'btn primary', onclick: guard(async () => {
    const r = await save(false); inv = r; toast('تغییرات ذخیره و PDF دوباره ساخته شد', 'ok'); reportShare(r.share_results);
  }) }, 'ذخیره تغییرات');
  const btnToDraft = h('button', { class: 'btn', onclick: guard(async () => {
    if (!(await confirmBox('فاکتور به حالت پیش‌نویس برگردد؟', 'برگردان'))) return;
    const body = payload({ to_draft: true }); const r = await put('/api/invoices/' + inv.id, body); toast('به پیش‌نویس برگشت', 'ok'); inv = r; location.reload();
  }) }, 'بازگشت به پیش‌نویس');
  const btnPreview = h('button', { class: 'btn', onclick: guard(async () => {
    const frame = h('iframe', { style: 'flex:1;border:1px solid var(--line);border-radius:8px;width:100%' });
    {
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
    const r = await save(false); // ذخیره (نهایی‌ها نهایی می‌مانند) و سپس PDF
    if (!inv) { inv = r; history.replaceState(null, '', '#/invoice/' + r.id); } else inv = r;
    download(`/api/invoices/${r.id}/pdf`); toast('ذخیره شد و PDF آماده است', 'ok');
  }) }, 'دانلود PDF');
  const btnShare = h('button', { class: 'btn', onclick: guard(async () => {
    const r = await save(false); // ابتدا ذخیره (نهایی‌ها نهایی می‌مانند)
    if (!inv) { inv = r; history.replaceState(null, '', '#/invoice/' + r.id); } else inv = r;
    openShare({ kind: 'invoice', id: r.id, title: `ارسال ${DOC_TYPES[docType]} ${toFaDigits(r.number)}`, phone: digitsValue(buyer.phone), caption: `${DOC_TYPES[docType]} شماره ${toFaDigits(r.number)}\n${r.buyer_name || ''}\nمبلغ قابل پرداخت: ${formatNumber(r.payable)} ریال` });
  }) }, 'ارسال');
  const btnCopy = h('button', { class: 'btn', onclick: guard(async () => {
    if (!inv) { toast('ابتدا فاکتور را ذخیره کنید', 'error'); return; }
    const c = await post(`/api/invoices/${inv.id}/copy`); toast('فاکتور جدید ساخته شد', 'ok'); location.hash = '#/invoice/' + c.id;
  }) }, 'کپی گرفتن');
  const btnDel = inv ? h('button', { class: 'btn danger', onclick: guard(async () => {
    if (!(await confirmBox(`این ${DOC_TYPES[docType]} برای همیشه حذف شود؟`, 'حذف'))) return;
    await del('/api/invoices/' + inv.id); toast('حذف شد', 'ok'); location.hash = '#/';
  }) }, 'حذف') : null;

  const docSwitch = h('div', { class: 'doc-switch' });
  const paintDoc = () => {
    docSwitch.replaceChildren(...Object.entries(DOC_TYPES).map(([k, label]) => h('button', { type: 'button', class: k === docType ? 'on' : '', onclick: () => {
      const wasDefault = notes.value.trim() === defaultNotes(docType);
      docType = k; if (wasDefault) notes.value = defaultNotes(k); paintDoc();
    } }, label)));
    const t = document.getElementById('pageTitle');
    if (t) t.textContent = isNew ? `صدور ${DOC_TYPES[docType]} جدید` : `${DOC_TYPES[docType]} شماره ${toFaDigits(inv.number)}`;
  };
  const defaultNotes = (t) => (t === 'invoice' ? settings.default_notes.replace('پیش‌فاکتور', 'فاکتور') : settings.default_notes);
  const autoShare = await autoShareBox();
  const sellerLine = inv?.seller || { name: settings.seller_name, national_id: settings.seller_national_id, phone: settings.seller_phone, address: settings.seller_address };

  root.append(h('div', { class: 'wrap' },
    !settings.seller_name ? h('div', { class: 'banner draft' }, 'مشخصات فروشنده هنوز ثبت نشده است. ', h('a', { href: '#/settings' }, 'از تنظیمات وارد کنید.')) : null,
    isFinal ? h('div', { class: 'banner' }, `✔ نهایی‌شده در ${toFaDigits(todayJalali(new Date(inv.finalized_at)))} — هر تغییری که ذخیره کنید، PDF دوباره ساخته می‌شود.`)
      : inv ? h('div', { class: 'banner draft' }, 'پیش‌نویس — هنوز نهایی نشده است.') : null,
    h('div', { class: 'card' },
      h('h1', { id: 'pageTitle' }, ''),
      h('div', { class: 'inv-head' },
        fld('نوع سند', docSwitch),
        fld('شماره', h('input', { disabled: true, value: toFaDigits(inv?.number ?? nextNo.number) })),
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
          h('div', { style: 'margin-top:12px' }, payBox),
          settings.has_stamp ? h('label', { style: 'display:block;margin-top:8px' }, withStamp, ' درج مهر در PDF') : null),
        h('div', { class: 'box' },
          h('div', { class: 'trow' }, h('span', {}, 'جمع کل'), subtotalEl),
          h('div', { class: 'trow' }, h('span', {}, 'تخفیف (ریال)'), discount),
          h('div', { class: 'trow' }, h('span', {}, 'درصد مالیات بر ارزش افزوده'), taxPct),
          taxAmtRow,
          h('div', { class: 'trow pay' }, h('span', {}, 'مبلغ قابل پرداخت (ریال)'), payEl))),
      h('div', { class: 'btnbar' }, isFinal ? [btnSaveFinal, btnToDraft] : [btnDraft, btnFinal], btnPreview, btnPdf, btnShare, btnCopy, btnDel), autoShare.el ? h('div', { style: 'margin-top:10px' }, autoShare.el) : null)));
  paintDoc();
  paintPay();
  if (prefilled) { toast(`${toFaDigits(prefilled)} کالا اضافه شد؛ مقدارها را وارد کنید`, 'ok'); rows[0]?.qtyEl.focus(); }
  recalc();
  if (isNew && !prefilled) rows[0].codeEl.focus();
}
