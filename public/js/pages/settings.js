import { get, put, post, del } from '../api.js';
import { h, toast, modal, confirmBox, bindNumber, numValue, setNum, bindDigitsText, digitsValue, download } from '../ui.js';
import { toFaDigits } from '/shared/format.js';
import { buildExtraSettings } from './settings-extra.js';

export async function settingsPage(root) {
  const s = await get('/api/settings');
  const ver = (await get('/api/version')).version;
  const fld = (l, el, hint) => h('div', { class: 'field' }, h('label', {}, l), el, hint ? h('small', { class: 'muted' }, hint) : null);
  const f = {
    company_title: h('input', { value: s.company_title }),
    invoice_title: h('input', { value: s.invoice_title }),
    invoice_title_sale: h('input', { value: s.invoice_title_sale }),
    seller_name: h('input', { value: s.seller_name }),
    seller_national_id: bindDigitsText(h('input', { value: toFaDigits(s.seller_national_id) })),
    seller_phone: bindDigitsText(h('input', { value: toFaDigits(s.seller_phone) })),
    seller_address: h('textarea', { rows: 2 }, s.seller_address),
    last_invoice_number: bindNumber(h('input')),
    default_tax_percent: bindNumber(h('input'), { decimal: true }),
    validity_hours: bindNumber(h('input'), { decimal: true }),
    default_notes: h('textarea', { rows: 2 }, s.default_notes),
    show_code: h('input', { type: 'checkbox', checked: s.show_code_in_print === '1' }),
    stamp_in_pdf: h('input', { type: 'checkbox', checked: s.stamp_in_pdf === '1' }),
  };
  setNum(f.last_invoice_number, Number(s.last_invoice_number));
  setNum(f.default_tax_percent, Number(s.default_tax_percent));
  setNum(f.validity_hours, Number(s.validity_hours));

  async function save(silent = false) {
    try {
      await put('/api/settings', {
        ...extra.collect(),
        company_title: f.company_title.value, invoice_title: f.invoice_title.value, invoice_title_sale: f.invoice_title_sale.value,
        seller_name: f.seller_name.value,
        seller_national_id: digitsValue(f.seller_national_id), seller_phone: digitsValue(f.seller_phone), seller_address: f.seller_address.value,
        last_invoice_number: numValue(f.last_invoice_number), default_tax_percent: numValue(f.default_tax_percent) ?? 0,
        validity_hours: numValue(f.validity_hours) ?? 24, default_notes: f.default_notes.value,
        show_code_in_print: f.show_code.checked, stamp_in_pdf: f.stamp_in_pdf.checked,
      });
      if (silent !== true) toast('تنظیمات ذخیره شد', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // مدت اعتبار → متن پیش‌فرض توضیحات
  const applyValidity = h('button', { class: 'btn small', onclick: () => {
    const n = numValue(f.validity_hours) ?? 24;
    f.default_notes.value = `مدت اعتبار این پیش‌فاکتور ${toFaDigits(n)} ساعت از تاریخ صدور است.`;
  } }, 'ساخت متن توضیحات از مدت اعتبار');

  const extra = buildExtraSettings(s, { version: ver, onSaved: save });
  const stampBox = h('div');
  function paintStamp(has) {
    stampBox.replaceChildren(
      has ? h('img', { src: '/api/settings/stamp?t=' + Date.now(), style: 'max-height:110px;background:#f1f3f6;border:1px solid var(--line);border-radius:6px;padding:4px;display:block;margin-bottom:8px' }) : h('p', { class: 'muted' }, 'مهری بارگذاری نشده است.'),
      h('input', { type: 'file', accept: 'image/png', onchange: (e) => {
        const file = e.target.files[0]; if (!file) return;
        const rd = new FileReader();
        rd.onload = async () => { try { const r = await post('/api/settings/stamp', { data: rd.result }); toast('مهر ذخیره شد', 'ok'); paintStamp(r.has_stamp); } catch (er) { toast(er.message, 'error'); } };
        rd.readAsDataURL(file);
      } }), ' ',
      has ? h('button', { class: 'btn small danger', onclick: async () => { const r = await del('/api/settings/stamp'); paintStamp(r.has_stamp); } }, 'حذف مهر') : null);
  }
  paintStamp(s.has_stamp);

  // ---------- حساب‌های بانکی ----------
  const accBody = h('tbody');
  async function loadAccounts() {
    const rows = await get('/api/payment-accounts');
    accBody.replaceChildren(...(rows.length ? rows.map((a) => h('tr', {},
      h('td', {}, a.title), h('td', {}, a.holder),
      h('td', { class: 'num' }, toFaDigits(a.card.replace(/(\d{4})(?=\d)/g, '$1-'))),
      h('td', { class: 'num' }, toFaDigits(a.sheba)), h('td', { class: 'num' }, toFaDigits(a.account)),
      h('td', { style: 'white-space:nowrap' },
        h('button', { class: 'btn small', onclick: () => editAccount(a) }, 'ویرایش'), ' ',
        h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox(`حساب «${a.title}» حذف شود؟ (فاکتورهای قبلی تغییری نمی‌کنند.)`, 'حذف')) { await del('/api/payment-accounts/' + a.id); loadAccounts(); } } }, 'حذف'))))
      : [h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'هنوز حسابی ثبت نشده است.'))]));
  }
  function editAccount(a) {
    const f2 = {
      title: h('input', { value: a?.title || '', placeholder: 'مثلاً: حساب اصلی، حساب شرکت' }), holder: h('input', { value: a?.holder || '' }),
      card: bindDigitsText(h('input', { value: toFaDigits(a?.card || ''), placeholder: '۱۶ رقم' })),
      sheba: bindDigitsText(h('input', { value: toFaDigits(a?.sheba || ''), placeholder: 'IR + ۲۴ رقم' })),
      account: bindDigitsText(h('input', { value: toFaDigits(a?.account || '') })),
    };
    const err = h('div', { class: 'err' });
    const m = modal(a ? 'ویرایش حساب' : 'حساب جدید', h('div', {},
      h('div', { class: 'row' }, fld('عنوان حساب', f2.title), fld('نام صاحب حساب', f2.holder)),
      h('div', { class: 'row', style: 'margin-top:10px' }, fld('شماره کارت', f2.card), fld('شماره شبا', f2.sheba), fld('شماره حساب', f2.account)), err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: async () => {
          const body = { title: f2.title.value, holder: f2.holder.value, card: digitsValue(f2.card), sheba: digitsValue(f2.sheba), account: digitsValue(f2.account) };
          try { if (a) await put('/api/payment-accounts/' + a.id, body); else await post('/api/payment-accounts', body); m.close(); toast('ذخیره شد', 'ok'); loadAccounts(); } catch (e) { err.textContent = e.message; }
        } }, 'ذخیره'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'انصراف'))));
    f2.title.focus();
  }
  const accountsCard = h('div', { class: 'card' },
    h('div', { class: 'row', style: 'align-items:center;margin-bottom:8px' }, h('h2', { style: 'margin:0;flex:1' }, 'حساب‌های بانکی (کارت / شبا)'),
      h('button', { class: 'btn primary', onclick: () => editAccount(null) }, '+ حساب جدید')),
    h('p', { class: 'muted', style: 'margin:0 0 8px' }, 'هر چند حساب بخواهید ثبت کنید؛ در فرم هر فاکتور انتخاب می‌کنید کدام حساب (و کدام شماره‌ها) چاپ شود.'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ['عنوان', 'صاحب حساب', 'شماره کارت', 'شماره شبا', 'شماره حساب', ''].map((t) => h('th', {}, t)))), accBody)));
  loadAccounts();

  // ---------- داده‌ها و بکاپ ----------
  const info = await get('/api/data-info');
  const restoreInput = h('input', { type: 'file', accept: '.zip,.db', style: 'max-width:100%' });
  const restoreMsg = h('div', { style: 'margin-top:8px' });
  const dataCard = h('div', { class: 'card' }, h('h2', {}, 'داده‌ها و بکاپ'),
    h('div', { style: 'background:#f7f9fb;border:1px solid var(--line);border-radius:8px;padding:10px 12px;line-height:1.9' },
      h('div', {}, h('b', {}, 'پوشه‌ی داده‌ی این برنامه: '), h('span', { style: 'direction:ltr;display:inline-block;word-break:break-all' }, info.dataDir)),
      h('div', {}, `در حال حاضر: ${toFaDigits(info.invoices)} فاکتور، ${toFaDigits(info.products)} کالا، ${toFaDigits(info.customers)} مشتری، ${toFaDigits(info.pdfs)} فایل PDF — حجم دیتابیس ${toFaDigits((info.dbSize / 1048576).toFixed(1))} مگابایت`),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'اگر بعد از جابه‌جایی برنامه اطلاعات قبلی را نمی‌بینید، این مسیر را بررسی کنید: برنامه فقط همین پوشه را می‌خواند.')),
    h('h3', { style: 'margin:14px 0 6px;font-size:15px' }, 'بکاپ گرفتن'),
    h('div', { class: 'btnbar', style: 'margin-top:0' },
      h('button', { class: 'btn primary', onclick: () => download('/api/backup/full') }, 'دانلود بکاپ کامل (zip: همه‌چیز + PDFها + مهر + لوگو)'),
      h('button', { class: 'btn', onclick: () => download('/api/backup') }, 'فقط دیتابیس (.db)')),
    h('h3', { style: 'margin:16px 0 6px;font-size:15px' }, 'بازیابی (برگرداندن بکاپ)'),
    h('p', { class: 'muted', style: 'margin:0 0 8px' }, 'فایل zip بکاپ کامل یا فایل .db را انتخاب کنید. تمام اطلاعات فعلی (فاکتورها، کالاها، مشتریان، تنظیمات، رمز عبور) با محتوای بکاپ جایگزین می‌شود؛ قبلش خودکار از وضعیت فعلی در data/backups بکاپ گرفته می‌شود. بکاپ نسخه‌های قدیمی‌تر برنامه هم پذیرفته می‌شود.'),
    h('div', { class: 'row', style: 'align-items:center' }, restoreInput,
      h('button', { class: 'btn danger', onclick: async (e) => {
        const f = restoreInput.files[0];
        if (!f) { toast('ابتدا فایل بکاپ را انتخاب کنید', 'error'); return; }
        if (!(await confirmBox(`اطلاعات فعلی با «${f.name}» جایگزین شود؟ (از وضعیت فعلی خودکار بکاپ گرفته می‌شود. بعد از بازیابی باید با رمز عبورِ موجود در بکاپ دوباره وارد شوید.)`, 'بله، بازیابی کن'))) return;
        e.target.disabled = true; restoreMsg.replaceChildren(h('span', { class: 'muted' }, 'در حال بازیابی...'));
        try {
          const res = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || 'بازیابی ناموفق بود');
          restoreMsg.replaceChildren(h('div', { style: 'color:var(--ok)' }, `✔ بازیابی شد: ${toFaDigits(d.invoices)} فاکتور، ${toFaDigits(d.products)} کالا، ${toFaDigits(d.customers)} مشتری${d.defaultAdmin ? ` — در بکاپ کاربری نبود؛ ورود: admin / ${d.defaultAdmin.password}` : ''}. چند ثانیه دیگر صفحه‌ی ورود باز می‌شود...`));
          setTimeout(() => { location.hash = '#/'; location.reload(); }, d.defaultAdmin ? 8000 : 2500);
        } catch (er) { restoreMsg.replaceChildren(h('div', { class: 'err' }, er.message)); e.target.disabled = false; }
      } }, 'بازیابی')),
    restoreMsg);

  // تغییر رمز
  const op = h('input', { type: 'password' }); const np = h('input', { type: 'password' });
  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'card' }, h('h1', {}, 'تنظیمات'),
      h('h2', {}, 'مشخصات فروشنده و عنوان‌ها'),
      h('div', { class: 'row' }, fld('عنوان شرکت (سربرگ)', f.company_title), fld('عنوان پیش‌فاکتور', f.invoice_title), fld('عنوان فاکتور', f.invoice_title_sale)),
      h('div', { class: 'row', style: 'margin-top:10px' }, fld('نام فروشنده', f.seller_name), fld('شناسه ملی', f.seller_national_id), fld('تلفن', f.seller_phone)),
      h('div', { style: 'margin-top:10px' }, fld('نشانی فروشنده', f.seller_address)),
      h('h2', { style: 'margin-top:20px' }, 'شماره‌گذاری، مالیات و توضیحات'),
      h('div', { class: 'row' },
        fld('شماره آخرین فاکتور صادرشده', f.last_invoice_number, 'فاکتور بعدی یک عدد بیشتر خواهد بود.'),
        fld('درصد پیش‌فرض مالیات بر ارزش افزوده', f.default_tax_percent), fld('مدت اعتبار (ساعت)', f.validity_hours)),
      h('div', { style: 'margin-top:10px' }, fld('متن پیش‌فرض توضیحات', f.default_notes), h('div', { style: 'margin-top:6px' }, applyValidity)),
      h('div', { style: 'margin-top:12px' }, h('label', {}, f.show_code, ' نمایش ستون «کد کالا» در نسخه چاپی/PDF')),
      h('div', { class: 'btnbar' }, h('button', { class: 'btn primary', onclick: save }, 'ذخیره تنظیمات'))),
    accountsCard,
    ...extra.cards,
    h('div', { class: 'card' }, h('h2', {}, 'تصویر مهر شرکت'),
      h('p', { class: 'muted' }, 'فایل PNG با پس‌زمینه شفاف بارگذاری کنید.'), stampBox,
      h('div', { style: 'margin-top:10px' }, h('label', {}, f.stamp_in_pdf, ' درج مهر در PDF (پیش‌فرض برای فاکتورهای جدید)')),
      h('div', { class: 'btnbar' }, h('button', { class: 'btn primary', onclick: save }, 'ذخیره'))),
    dataCard,
    h('div', { class: 'card' }, h('h2', {}, 'تغییر رمز عبور'),
      h('div', { class: 'row' }, fld('رمز فعلی', op), fld('رمز جدید (حداقل ۶ نویسه)', np),
        h('button', { class: 'btn', onclick: async () => {
          try { await post('/api/change-password', { old_password: op.value, new_password: np.value }); toast('رمز تغییر کرد', 'ok'); op.value = np.value = ''; } catch (e) { toast(e.message, 'error'); }
        } }, 'تغییر رمز')))));
}
