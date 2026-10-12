import { get, post } from './api.js';
import { h, toast, modal, download, bindDigitsText, digitsValue } from './ui.js';
import { SHARE_MODES } from '/shared/share-format.js';

/** پنجره‌ی ارسال: انتخاب پلتفرم‌ها و ارسال. spec = {kind,id?,query?,title} */
export async function openShare(spec) {
  let platforms = [];
  try { platforms = await get('/api/share/platforms'); } catch (e) { toast(e.message, 'error'); return; }
  let pv = { filename: '', caption: '', mode: 'caption' };
  try { pv = await post('/api/share/preview', { kind: spec.kind, id: spec.id }); } catch (e) { toast(e.message, 'error'); }
  const fileName = h('input', { value: pv.filename });
  const caption = h('textarea', { rows: 3 }, pv.caption);
  const mode = h('select', {}, Object.entries(SHARE_MODES).map(([k, label]) => h('option', { value: k, selected: k === pv.mode }, label)));
  const details = h('div', { style: 'margin:10px 0;padding:10px;background:#f7f9fb;border:1px solid var(--line);border-radius:8px' },
    h('div', { class: 'field' }, h('label', {}, 'نام فایل'), fileName),
    h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'متنی که همراه فایل می‌رود'), caption),
    h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'ترتیب ارسال'), mode),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, 'مقدارهای پیش‌فرض از «تنظیمات ← قالب نام فایل و متن ارسال» می‌آید؛ اینجا فقط برای همین ارسال قابل تغییر است.'));
  const checks = {};
  const rows = platforms.map((p) => {
    checks[p.key] = h('input', { type: 'checkbox', checked: p.ready, disabled: !p.ready });
    return h('label', { style: 'display:flex;gap:8px;align-items:center;padding:6px 0;' + (p.ready ? '' : 'color:var(--muted)') }, checks[p.key], p.label,
      p.ready ? null : h('small', {}, '— در تنظیمات فعال/کامل نشده'));
  });
  const out = h('div', { style: 'margin-top:10px;line-height:1.9' });
  // واتساپ (دستی): متن آماده در wa.me باز می‌شود و فایل دانلود می‌شود؛ بدون API و بدون ریسک بن شدن حساب
  const waPhone = bindDigitsText(h('input', { placeholder: 'شماره‌ی گیرنده (اختیاری) مثلاً 09121234567', value: spec.phone || '' }));
  const waNumber = () => { let d = digitsValue(waPhone).replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '98' + d.slice(1); return d; };
  const fileUrl = () => spec.kind === 'invoice' ? `/api/invoices/${spec.id}/pdf?share=1&filename=${encodeURIComponent(fileName.value)}` : spec.kind === 'products-xlsx' ? '/api/products/export.xlsx' : '/api/invoices/export.xlsx?' + new URLSearchParams(spec.query || {}).toString();
  const wa = h('div', { style: 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line)' },
    h('b', {}, 'واتساپ (دستی)'),
    h('div', { class: 'muted', style: 'font-size:12px;margin:4px 0 8px' }, 'فایل دانلود می‌شود و واتساپ با متن آماده باز می‌شود؛ فایل را داخل چت بکشید یا با گیره (📎) بفرستید.'),
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'min-width:200px' }, waPhone),
      h('button', { class: 'btn', onclick: () => {
        download(fileUrl());
        const n = waNumber();
        window.open(`https://wa.me/${n}?text=${encodeURIComponent(mode.value === 'none' ? '' : caption.value)}`, '_blank', 'noopener');
      } }, 'باز کردن واتساپ')));
  const send = h('button', { class: 'btn primary', onclick: async () => {
    const chosen = platforms.filter((p) => checks[p.key].checked).map((p) => p.key);
    if (!chosen.length) { toast('حداقل یک پلتفرم را انتخاب کنید', 'error'); return; }
    send.disabled = true; send.textContent = 'در حال ارسال...';
    try {
      const r = await post('/api/share', { kind: spec.kind, id: spec.id, query: spec.query, platforms: chosen, filename: fileName.value, caption: caption.value, mode: mode.value });
      out.replaceChildren(...r.results.map((x) => h('div', { style: 'color:' + (x.ok ? 'var(--ok)' : 'var(--danger)') }, `${x.ok ? '✔' : '✖'} ${x.label}${x.ok ? ' — ارسال شد' : ': ' + x.error}`)));
    } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); }
    send.disabled = false; send.textContent = 'ارسال';
  } }, 'ارسال');
  const m = modal(spec.title || 'ارسال', h('div', {},
    platforms.some((p) => p.ready) ? h('p', { class: 'muted', style: 'margin:0 0 6px' }, 'به کدام پیام‌رسان‌ها فرستاده شود؟') : h('p', { class: 'err' }, 'هنوز هیچ پیام‌رسانی تنظیم نشده است. از «تنظیمات ← اشتراک‌گذاری» توکن ربات و شناسه‌ی چت را وارد کنید.'),
    ...rows, details, out, wa,
    h('div', { class: 'actions' }, send, h('button', { class: 'btn', onclick: () => m.close() }, 'بستن'))));
}

/** چک‌باکس‌های «ارسال خودکار پس از ثبت نهایی» برای فرم فاکتور. خروجی: {el, selected()} */
export async function autoShareBox() {
  let platforms = [];
  try { platforms = (await get('/api/share/platforms')).filter((p) => p.ready); } catch { /* ignore */ }
  const checks = Object.fromEntries(platforms.map((p) => [p.key, h('input', { type: 'checkbox' })]));
  return {
    el: platforms.length ? h('div', { class: 'payopts', style: 'align-items:center' }, h('span', { class: 'muted' }, 'پس از ثبت/ذخیره‌ی نهایی ارسال شود به:'),
      platforms.map((p) => h('label', {}, checks[p.key], ' ', p.label))) : null,
    selected: () => platforms.filter((p) => checks[p.key].checked).map((p) => p.key),
  };
}

export function reportShare(results) {
  for (const r of results || []) toast(`${r.label}: ${r.ok ? 'ارسال شد' : r.error}`, r.ok ? 'ok' : 'error');
}
