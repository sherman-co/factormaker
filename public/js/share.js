import { get, post } from './api.js';
import { h, toast, modal } from './ui.js';

/** پنجره‌ی ارسال: انتخاب پلتفرم‌ها و ارسال. spec = {kind,id?,query?,title} */
export async function openShare(spec) {
  let platforms = [];
  try { platforms = await get('/api/share/platforms'); } catch (e) { toast(e.message, 'error'); return; }
  const checks = {};
  const rows = platforms.map((p) => {
    checks[p.key] = h('input', { type: 'checkbox', checked: p.ready, disabled: !p.ready });
    return h('label', { style: 'display:flex;gap:8px;align-items:center;padding:6px 0;' + (p.ready ? '' : 'color:var(--muted)') }, checks[p.key], p.label,
      p.ready ? null : h('small', {}, '— در تنظیمات فعال/کامل نشده'));
  });
  const out = h('div', { style: 'margin-top:10px;line-height:1.9' });
  const send = h('button', { class: 'btn primary', onclick: async () => {
    const chosen = platforms.filter((p) => checks[p.key].checked).map((p) => p.key);
    if (!chosen.length) { toast('حداقل یک پلتفرم را انتخاب کنید', 'error'); return; }
    send.disabled = true; send.textContent = 'در حال ارسال...';
    try {
      const r = await post('/api/share', { kind: spec.kind, id: spec.id, query: spec.query, platforms: chosen });
      out.replaceChildren(...r.results.map((x) => h('div', { style: 'color:' + (x.ok ? 'var(--ok)' : 'var(--danger)') }, `${x.ok ? '✔' : '✖'} ${x.label}${x.ok ? ' — ارسال شد' : ': ' + x.error}`)));
    } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); }
    send.disabled = false; send.textContent = 'ارسال';
  } }, 'ارسال');
  const m = modal(spec.title || 'ارسال', h('div', {},
    platforms.some((p) => p.ready) ? h('p', { class: 'muted', style: 'margin:0 0 6px' }, 'به کدام پیام‌رسان‌ها فرستاده شود؟') : h('p', { class: 'err' }, 'هنوز هیچ پیام‌رسانی تنظیم نشده است. از «تنظیمات ← اشتراک‌گذاری» توکن ربات و شناسه‌ی چت را وارد کنید.'),
    ...rows, out,
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
