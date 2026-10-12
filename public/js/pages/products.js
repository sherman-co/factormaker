import { get, post, put, del } from '../api.js';
import { h, toast, modal, bindNumber, numValue, setNum, bindDigitsText, digitsValue, confirmBox, download, readFileAsDataURL } from '../ui.js';
import { openShare } from '../share.js';
import { pending } from '../state.js';
import { formatNumber, toFaDigits, toEnDigits, groupOfCode } from '/shared/format.js';

export async function productsPage(root) {
  let rows = [];
  let q = '';
  let onlyActive = false;
  const selected = new Set(); // کدهای تیک‌خورده (ماندگار بین جست‌وجوها)
  const tbody = h('tbody');
  const count = h('span', { class: 'muted' });
  const allBox = h('input', { type: 'checkbox', title: 'انتخاب همه‌ی کالاهای فعالِ نمایش‌داده‌شده', onchange: (e) => {
    for (const p of rows.filter((x) => x.active)) e.target.checked ? selected.add(p.code) : selected.delete(p.code);
    load();
  } });
  const bar = h('div', { class: 'selbar' });
  function paintBar() {
    if (!selected.size) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.replaceChildren(
      h('b', {}, toFaDigits(selected.size) + ' کالا انتخاب شد'),
      h('button', { class: 'btn primary', onclick: () => {
        pending.codes = [...selected];
        location.hash = '#/invoice/new';
      } }, 'افزودن به فاکتور جدید ←'),
      h('button', { class: 'btn', onclick: () => { selected.clear(); load(); } }, 'پاک کردن انتخاب'));
  }

  async function load() {
    rows = await get('/api/products?q=' + encodeURIComponent(q) + (onlyActive ? '&active=1' : ''));
    tbody.replaceChildren(...rows.map((p) => h('tr', {},
      h('td', { style: 'width:34px;text-align:center' }, h('input', { type: 'checkbox', disabled: !p.active, title: p.active ? '' : 'کالای غیرفعال', checked: selected.has(p.code), onchange: (e) => { e.target.checked ? selected.add(p.code) : selected.delete(p.code); paintBar(); } })),
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
    allBox.checked = rows.some((p) => p.active) && rows.filter((p) => p.active).every((p) => selected.has(p.code));
    paintBar();
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

  function importExcel() {
    const file = h('input', { type: 'file', accept: '.xlsx' });
    const mode = h('select', {}, h('option', { value: 'skip' }, 'کدهای موجود را نادیده بگیر (فقط کالاهای تازه اضافه شوند)'), h('option', { value: 'update' }, 'کدهای موجود را به‌روز کن (شرح، واحد، قیمت، وضعیت)'));
    const ignore = h('input', { type: 'checkbox' });
    const out = h('div', { style: 'margin-top:10px' });
    const go = h('button', { class: 'btn primary', disabled: true }, 'ورود کالاها');
    let data = null;
    const body = () => ({ data, mode: mode.value, ignoreErrors: ignore.checked });
    const STATUS = { new: ['تازه', 'final'], update: ['به‌روزرسانی', 'pro'], same: ['بدون تغییر', ''], skip: ['نادیده', ''], error: ['خطا', 'off'] };
    async function preview() {
      if (!data) return;
      try {
        const r = await post('/api/products/import', { ...body(), dryRun: true });
        const sm = r.summary;
        out.replaceChildren(
          h('div', {}, `تازه: ${toFaDigits(sm.new)} — به‌روزرسانی: ${toFaDigits(sm.update)} — بدون تغییر: ${toFaDigits(sm.same)} — نادیده: ${toFaDigits(sm.skip)} — خطا: ${toFaDigits(sm.error)}`),
          h('div', { class: 'tablewrap', style: 'max-height:260px;overflow:auto;margin-top:8px' }, h('table', { class: 'grid' },
            h('tbody', {}, r.rows.map((x) => h('tr', {}, h('td', { class: 'num' }, toFaDigits(x.row)), h('td', { class: 'num' }, toFaDigits(x.code)), h('td', {}, x.description),
              h('td', {}, h('span', { class: 'tag ' + STATUS[x.status][1] }, STATUS[x.status][0]), x.message ? ' ' + x.message : '')))))),
          r.truncated ? h('div', { class: 'muted' }, 'فقط ۵۰۰ ردیف اول نمایش داده شد.') : null);
        go.disabled = sm.new + sm.update === 0 || (sm.error > 0 && !ignore.checked);
      } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); go.disabled = true; }
    }
    file.addEventListener('change', async () => { data = file.files[0] ? await readFileAsDataURL(file.files[0]) : null; preview(); });
    mode.addEventListener('change', preview); ignore.addEventListener('change', preview);
    go.addEventListener('click', async () => {
      go.disabled = true;
      try { const r = await post('/api/products/import', body()); toast(`ورود انجام شد: ${toFaDigits(r.summary.new)} تازه، ${toFaDigits(r.summary.update)} به‌روزرسانی`, 'ok'); m.close(); load(); }
      catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); go.disabled = false; }
    });
    const m = modal('ورود کالاها از Excel', h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' }, 'ستون‌ها: کد کالا، شرح کالا، واحد، مبلغ واحد (ریال) و اختیاری «فعال». ',
        h('a', { href: '/api/products/template.xlsx' }, 'دانلود فایل نمونه')),
      h('div', { class: 'field' }, h('label', {}, 'فایل Excel (.xlsx)'), file),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'اگر کد از قبل وجود داشت'), mode),
      h('label', { style: 'display:block;margin-top:8px' }, ignore, ' ردیف‌های خطادار نادیده گرفته شوند'),
      out, h('div', { class: 'actions' }, go, h('button', { class: 'btn', onclick: () => m.close() }, 'بستن'))), { wide: true });
  }

  const search = h('input', { placeholder: 'جست‌وجو با کد، شرح یا گروه...', oninput: (e) => { q = e.target.value; clearTimeout(search._t); search._t = setTimeout(load, 200); } });
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'card' },
    h('div', { class: 'row', style: 'margin-bottom:12px;align-items:center' },
      h('h1', { style: 'margin:0;flex:none' }, 'کالاها'),
      h('div', { style: 'flex:1;min-width:220px' }, search),
      h('label', {}, h('input', { type: 'checkbox', onchange: (e) => { onlyActive = e.target.checked; load(); } }), ' فقط فعال‌ها'),
      count,
      h('button', { class: 'btn', onclick: importExcel }, 'ورود از Excel'),
      h('button', { class: 'btn', onclick: () => download('/api/products/export.xlsx') }, 'خروجی Excel'),
      h('button', { class: 'btn', onclick: () => openShare({ kind: 'products-xlsx', title: 'ارسال فهرست کالاها' }) }, 'ارسال'),
      h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ کالای جدید')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', { style: 'width:34px;text-align:center' }, allBox), ...['کد کالا', 'شرح کالا', 'واحد', 'مبلغ واحد (ریال)', 'گروه', 'وضعیت', ''].map((t) => h('th', {}, t)))),
      tbody))), bar));
  load();
}
