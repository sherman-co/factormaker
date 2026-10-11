import { get, post, put, del } from '../api.js';
import { h, toast, modal, bindNumber, numValue, setNum, bindDigitsText, digitsValue, confirmBox } from '../ui.js';
import { formatNumber, toFaDigits, toEnDigits, groupOfCode } from '/shared/format.js';

export async function productsPage(root) {
  let rows = [];
  let q = '';
  let onlyActive = false;
  const tbody = h('tbody');
  const count = h('span', { class: 'muted' });

  async function load() {
    rows = await get('/api/products?q=' + encodeURIComponent(q) + (onlyActive ? '&active=1' : ''));
    tbody.replaceChildren(...rows.map((p) => h('tr', {},
      h('td', { class: 'num' }, toFaDigits(p.code)),
      h('td', {}, p.description),
      h('td', {}, p.unit),
      h('td', { class: 'num' }, formatNumber(p.price)),
      h('td', {}, p.group),
      h('td', {}, h('span', { class: 'tag ' + (p.active ? 'final' : 'off') }, p.active ? 'فعال' : 'غیرفعال')),
      h('td', { style: 'white-space:nowrap' },
        h('button', { class: 'btn small', onclick: () => edit(p) }, 'ویرایش'), ' ',
        h('button', { class: 'btn small', onclick: () => toggle(p) }, p.active ? 'غیرفعال کردن' : 'فعال کردن'), ' ',
        h('button', { class: 'btn small danger', onclick: () => remove(p) }, 'حذف')))));
    count.textContent = toFaDigits(rows.length) + ' کالا';
  }

  async function toggle(p) {
    await put('/api/products/' + p.id, { ...p, active: !p.active });
    load();
  }
  async function remove(p) {
    if (!(await confirmBox(`کالای «${p.description}» حذف شود؟ (اگر در فاکتوری استفاده شده باشد حذف نمی‌شود و باید غیرفعال کنید.)`, 'حذف'))) return;
    try { await del('/api/products/' + p.id); toast('حذف شد', 'ok'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  function edit(p) {
    const code = bindDigitsText(h('input', { value: p ? toFaDigits(p.code) : '' }));
    const desc = h('input', { value: p?.description || '' });
    const unit = h('input', { value: p?.unit || 'عدد' });
    const price = bindNumber(h('input'));
    setNum(price, p?.price ?? 0);
    const active = h('input', { type: 'checkbox', checked: p ? p.active : true });
    const err = h('div', { class: 'err' });
    const m = modal(p ? 'ویرایش کالا' : 'کالای جدید', h('div', {},
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, 'کد کالا (مثلاً ۱۰۱)'), code),
        h('div', { class: 'field', style: 'flex:2' }, h('label', {}, 'گروه'), h('input', { disabled: true, id: 'grp', value: p ? p.group : '' }))),
      h('div', { class: 'field', style: 'margin-top:10px' }, h('label', {}, 'شرح کالا'), desc),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('div', { class: 'field' }, h('label', {}, 'واحد'), unit),
        h('div', { class: 'field' }, h('label', {}, 'مبلغ واحد (ریال)'), price)),
      h('label', { style: 'display:block;margin-top:10px' }, active, ' فعال'),
      err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const body = { code: digitsValue(code), description: desc.value, unit: unit.value, price: numValue(price), active: active.checked };
            if (p) await put('/api/products/' + p.id, body); else await post('/api/products', body);
            m.close(); toast('ذخیره شد', 'ok'); load();
          } catch (e) { err.textContent = e.message; }
        } }, 'ذخیره'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'انصراف'))));
    code.addEventListener('input', () => { m.box.querySelector('#grp').value = digitsValue(code) ? groupOfCode(digitsValue(code)) : ''; });
    code.focus();
  }

  const search = h('input', { placeholder: 'جست‌وجو با کد، شرح یا گروه...', oninput: (e) => { q = e.target.value; clearTimeout(search._t); search._t = setTimeout(load, 200); } });
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'card' },
    h('div', { class: 'row', style: 'margin-bottom:12px;align-items:center' },
      h('h1', { style: 'margin:0;flex:none' }, 'کالاها'),
      h('div', { style: 'flex:1;min-width:220px' }, search),
      h('label', {}, h('input', { type: 'checkbox', onchange: (e) => { onlyActive = e.target.checked; load(); } }), ' فقط فعال‌ها'),
      count,
      h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ کالای جدید')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['کد کالا', 'شرح کالا', 'واحد', 'مبلغ واحد (ریال)', 'گروه', 'وضعیت', ''].map((t) => h('th', {}, t)))),
      tbody)))));
  load();
}
