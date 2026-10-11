import { get, post, put, del } from '../api.js';
import { h, toast, modal, bindDigitsText, digitsValue, confirmBox } from '../ui.js';
import { toFaDigits } from '/shared/format.js';

export async function customersPage(root) {
  let q = '';
  const tbody = h('tbody');
  async function load() {
    const rows = await get('/api/customers?q=' + encodeURIComponent(q));
    tbody.replaceChildren(...rows.map((c) => h('tr', {},
      h('td', {}, c.name), h('td', { class: 'num' }, toFaDigits(c.national_id)), h('td', { class: 'num' }, toFaDigits(c.phone)),
      h('td', {}, c.address), h('td', { class: 'num' }, toFaDigits(c.reg_no)),
      h('td', { style: 'white-space:nowrap' },
        h('button', { class: 'btn small', onclick: () => edit(c) }, 'ویرایش'), ' ',
        h('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmBox(`مشتری «${c.name}» حذف شود؟ (فاکتورهای قبلی تغییری نمی‌کنند.)`, 'حذف')) { await del('/api/customers/' + c.id); load(); }
        } }, 'حذف')))));
  }
  function edit(c) {
    const f = {
      name: h('input', { value: c?.name || '' }),
      national_id: bindDigitsText(h('input', { value: toFaDigits(c?.national_id || '') })),
      phone: bindDigitsText(h('input', { value: toFaDigits(c?.phone || '') })),
      reg_no: bindDigitsText(h('input', { value: toFaDigits(c?.reg_no || '') })),
      address: h('textarea', { rows: 2 }, c?.address || ''),
    };
    const err = h('div', { class: 'err' });
    const fld = (l, el) => h('div', { class: 'field' }, h('label', {}, l), el);
    const m = modal(c ? 'ویرایش مشتری' : 'مشتری جدید', h('div', {},
      fld('نام شخص حقیقی / حقوقی', f.name),
      h('div', { class: 'row', style: 'margin:10px 0' }, fld('شناسه ملی', f.national_id), fld('تلفن', f.phone), fld('شماره ثبت', f.reg_no)),
      fld('نشانی', f.address), err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: async () => {
          const body = { name: f.name.value, national_id: digitsValue(f.national_id), phone: digitsValue(f.phone), reg_no: digitsValue(f.reg_no), address: f.address.value };
          try { if (c) await put('/api/customers/' + c.id, body); else await post('/api/customers', body); m.close(); toast('ذخیره شد', 'ok'); load(); } catch (e) { err.textContent = e.message; }
        } }, 'ذخیره'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'انصراف'))));
    f.name.focus();
  }
  const search = h('input', { placeholder: 'جست‌وجوی نام یا شناسه ملی...', oninput: (e) => { q = e.target.value; clearTimeout(search._t); search._t = setTimeout(load, 200); } });
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'card' },
    h('div', { class: 'row', style: 'margin-bottom:12px;align-items:center' },
      h('h1', { style: 'margin:0;flex:none' }, 'مشتریان'), h('div', { style: 'flex:1;min-width:220px' }, search),
      h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ مشتری جدید')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['نام', 'شناسه ملی', 'تلفن', 'نشانی', 'شماره ثبت', ''].map((t) => h('th', {}, t)))), tbody)))));
  load();
}
