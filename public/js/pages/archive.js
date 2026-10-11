import { get, post } from '../api.js';
import { h, toast, bindDate, download } from '../ui.js';
import { formatNumber, toFaDigits, toEnDigits } from '/shared/format.js';

export async function archivePage(root) {
  const today = (await get('/api/today')).jdate;
  const st = { q: '', from: '', to: '', status: '', page: 1 };
  const tbody = h('tbody');
  const pager = h('div', { class: 'pager' });
  const summary = h('span', { class: 'muted' });
  const query = (extra = {}) => new URLSearchParams({ ...st, ...extra }).toString();

  async function load() {
    const r = await get('/api/invoices?' + query());
    tbody.replaceChildren(...r.rows.map((i) => h('tr', {},
      h('td', { class: 'num' }, toFaDigits(i.number)),
      h('td', { class: 'num' }, toFaDigits(i.jdate)),
      h('td', {}, i.buyer_name || h('span', { class: 'muted' }, '—')),
      h('td', { class: 'num' }, formatNumber(i.payable)),
      h('td', {}, h('span', { class: 'tag ' + i.status }, i.status === 'final' ? 'نهایی' : 'پیش‌نویس')),
      h('td', { style: 'white-space:nowrap' },
        h('a', { class: 'btn small', href: '#/invoice/' + i.id }, i.status === 'final' ? 'مشاهده' : 'ویرایش'), ' ',
        h('button', { class: 'btn small', onclick: () => download(`/api/invoices/${i.id}/pdf`) }, 'PDF'), ' ',
        h('button', { class: 'btn small', onclick: async () => { const c = await post(`/api/invoices/${i.id}/copy`); toast('کپی ساخته شد', 'ok'); location.hash = '#/invoice/' + c.id; } },
          i.status === 'final' ? 'کپی و اصلاح' : 'کپی')))));
    const pages = Math.max(1, Math.ceil(r.total / r.size));
    summary.textContent = toFaDigits(r.total) + ' فاکتور';
    pager.replaceChildren(
      h('button', { class: 'btn small', disabled: st.page <= 1, onclick: () => { st.page--; load(); } }, 'قبلی'),
      h('span', {}, `صفحه ${toFaDigits(st.page)} از ${toFaDigits(pages)}`),
      h('button', { class: 'btn small', disabled: st.page >= pages, onclick: () => { st.page++; load(); } }, 'بعدی'));
  }
  const reload = () => { st.page = 1; load(); };
  const q = h('input', { placeholder: 'نام خریدار یا شماره فاکتور', oninput: (e) => { st.q = e.target.value; clearTimeout(q._t); q._t = setTimeout(reload, 250); } });
  const from = h('input', { placeholder: 'از تاریخ' }); const to = h('input', { placeholder: 'تا تاریخ' });
  bindDate(from, { today, onChange: (v) => { st.from = /^\d{4}\/\d{2}\/\d{2}$/.test(v) ? v : ''; reload(); } });
  bindDate(to, { today, onChange: (v) => { st.to = /^\d{4}\/\d{2}\/\d{2}$/.test(v) ? v : ''; reload(); } });
  const status = h('select', { onchange: (e) => { st.status = e.target.value; reload(); } },
    h('option', { value: '' }, 'همه وضعیت‌ها'), h('option', { value: 'draft' }, 'پیش‌نویس'), h('option', { value: 'final' }, 'نهایی'));
  const clear = h('button', { class: 'btn', onclick: () => { Object.assign(st, { q: '', from: '', to: '', status: '' }); q.value = from.value = to.value = ''; status.value = ''; reload(); } }, 'پاک کردن فیلترها');

  root.append(h('div', { class: 'wrap' }, h('div', { class: 'card' },
    h('div', { class: 'row', style: 'margin-bottom:12px;align-items:center' },
      h('h1', { style: 'margin:0;flex:none' }, 'بایگانی فاکتورها'), h('span', { style: 'flex:1' }), summary,
      h('a', { class: 'btn', href: '#/invoice/new' }, '+ فاکتور جدید'),
      h('button', { class: 'btn', onclick: () => download('/api/invoices/export.xlsx?' + query({ page: 1 })) }, 'خروجی Excel')),
    h('div', { class: 'row', style: 'margin-bottom:12px' },
      h('div', { class: 'field', style: 'flex:2' }, h('label', {}, 'جست‌وجو'), q),
      h('div', { class: 'field' }, h('label', {}, 'از تاریخ'), from), h('div', { class: 'field' }, h('label', {}, 'تا تاریخ'), to),
      h('div', { class: 'field' }, h('label', {}, 'وضعیت'), status), clear),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['شماره', 'تاریخ', 'خریدار', 'مبلغ قابل پرداخت (ریال)', 'وضعیت', ''].map((t) => h('th', {}, t)))), tbody)),
    pager)));
  load();
}
