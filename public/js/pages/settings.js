import { get, put, post, del } from '../api.js';
import { h, toast, bindNumber, numValue, setNum, bindDigitsText, digitsValue, download } from '../ui.js';
import { toFaDigits } from '/shared/format.js';

export async function settingsPage(root) {
  const s = await get('/api/settings');
  const fld = (l, el, hint) => h('div', { class: 'field' }, h('label', {}, l), el, hint ? h('small', { class: 'muted' }, hint) : null);
  const f = {
    company_title: h('input', { value: s.company_title }),
    invoice_title: h('input', { value: s.invoice_title }),
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

  async function save() {
    try {
      await put('/api/settings', {
        company_title: f.company_title.value, invoice_title: f.invoice_title.value, seller_name: f.seller_name.value,
        seller_national_id: digitsValue(f.seller_national_id), seller_phone: digitsValue(f.seller_phone), seller_address: f.seller_address.value,
        last_invoice_number: numValue(f.last_invoice_number), default_tax_percent: numValue(f.default_tax_percent) ?? 0,
        validity_hours: numValue(f.validity_hours) ?? 24, default_notes: f.default_notes.value,
        show_code_in_print: f.show_code.checked, stamp_in_pdf: f.stamp_in_pdf.checked,
      });
      toast('تنظیمات ذخیره شد', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // مدت اعتبار → متن پیش‌فرض توضیحات
  const applyValidity = h('button', { class: 'btn small', onclick: () => {
    const n = numValue(f.validity_hours) ?? 24;
    f.default_notes.value = `مدت اعتبار این پیش‌فاکتور ${toFaDigits(n)} ساعت از تاریخ صدور است.`;
  } }, 'ساخت متن توضیحات از مدت اعتبار');

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

  // تغییر رمز
  const op = h('input', { type: 'password' }); const np = h('input', { type: 'password' });
  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'card' }, h('h1', {}, 'تنظیمات'),
      h('h2', {}, 'مشخصات فروشنده و عنوان‌ها'),
      h('div', { class: 'row' }, fld('عنوان شرکت (سربرگ)', f.company_title), fld('عنوان فاکتور', f.invoice_title)),
      h('div', { class: 'row', style: 'margin-top:10px' }, fld('نام فروشنده', f.seller_name), fld('شناسه ملی', f.seller_national_id), fld('تلفن', f.seller_phone)),
      h('div', { style: 'margin-top:10px' }, fld('نشانی فروشنده', f.seller_address)),
      h('h2', { style: 'margin-top:20px' }, 'شماره‌گذاری، مالیات و توضیحات'),
      h('div', { class: 'row' },
        fld('شماره آخرین فاکتور صادرشده', f.last_invoice_number, 'فاکتور بعدی یک عدد بیشتر خواهد بود.'),
        fld('درصد پیش‌فرض مالیات بر ارزش افزوده', f.default_tax_percent), fld('مدت اعتبار (ساعت)', f.validity_hours)),
      h('div', { style: 'margin-top:10px' }, fld('متن پیش‌فرض توضیحات', f.default_notes), h('div', { style: 'margin-top:6px' }, applyValidity)),
      h('div', { style: 'margin-top:12px' }, h('label', {}, f.show_code, ' نمایش ستون «کد کالا» در نسخه چاپی/PDF')),
      h('div', { class: 'btnbar' }, h('button', { class: 'btn primary', onclick: save }, 'ذخیره تنظیمات'))),
    h('div', { class: 'card' }, h('h2', {}, 'تصویر مهر شرکت'),
      h('p', { class: 'muted' }, 'فایل PNG با پس‌زمینه شفاف بارگذاری کنید.'), stampBox,
      h('div', { style: 'margin-top:10px' }, h('label', {}, f.stamp_in_pdf, ' درج مهر در PDF (پیش‌فرض برای فاکتورهای جدید)')),
      h('div', { class: 'btnbar' }, h('button', { class: 'btn primary', onclick: save }, 'ذخیره'))),
    h('div', { class: 'card' }, h('h2', {}, 'بکاپ'),
      h('p', { class: 'muted' }, 'فایل دیتابیس را دانلود کنید. برای بکاپ کامل (شامل PDFها) کل پوشه data را کپی کنید.'),
      h('button', { class: 'btn', onclick: () => download('/api/backup') }, 'دانلود بکاپ دیتابیس')),
    h('div', { class: 'card' }, h('h2', {}, 'تغییر رمز عبور'),
      h('div', { class: 'row' }, fld('رمز فعلی', op), fld('رمز جدید (حداقل ۶ نویسه)', np),
        h('button', { class: 'btn', onclick: async () => {
          try { await post('/api/change-password', { old_password: op.value, new_password: np.value }); toast('رمز تغییر کرد', 'ok'); op.value = np.value = ''; } catch (e) { toast(e.message, 'error'); }
        } }, 'تغییر رمز')))));
}
