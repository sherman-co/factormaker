import { get, post, del } from '../api.js';
import { h, toast, confirmBox, applyTheme, readFileAsDataURL, bindDigitsText } from '../ui.js';
import { toFaDigits } from '/shared/format.js';

const PRESETS = ['#16314f', '#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#374151', '#e5e7eb'];
const PLATFORMS = [
  { key: 'tg', name: 'تلگرام', hint: 'ساخت ربات: @BotFather. شناسه‌ی چت عددی یا @کانال. ربات باید عضو چت/کانال باشد.', base: 'https://api.telegram.org' },
  { key: 'bale', name: 'بله', hint: 'ساخت ربات: @botfather در بله. ربات را به چت/کانال اضافه کنید.', base: 'https://tapi.bale.ai' },
  { key: 'eitaa', name: 'ایتا', hint: 'از «ایتایار» (eitaayar.ir) توکن بگیرید؛ مقصد معمولاً یک کانال است (@شناسه). طبق مستندات ایتایار پیاده‌سازی شده و روی حساب واقعی آزمایش نشده؛ از دکمه‌ی «ارسال آزمایشی» استفاده کنید.', base: 'https://eitaayar.ir/api' },
];

/** کارت‌های ظاهر، اشتراک‌گذاری و به‌روزرسانی. خروجی: {cards, collect()} */
export function buildExtraSettings(s, { version, onSaved }) {
  // ---------- ظاهر ----------
  const color = h('input', { type: 'color', value: s.theme_color || '#16314f', style: 'width:60px;height:40px;padding:2px' });
  color.addEventListener('input', () => applyTheme(color.value));
  const swatches = h('div', { class: 'swatches' }, PRESETS.map((c) => h('button', { type: 'button', style: `background:${c}`, title: c, onclick: () => { color.value = c; applyTheme(c); } })));
  const mode = { name: h('input', { type: 'radio', name: 'hdr', checked: s.header_mode !== 'logo' }), logo: h('input', { type: 'radio', name: 'hdr', checked: s.header_mode === 'logo', disabled: !s.has_logo }) };
  const logoBox = h('div');
  function paintLogo(has) {
    mode.logo.disabled = !has;
    if (!has) mode.name.checked = true;
    logoBox.replaceChildren(
      has ? h('img', { src: '/api/settings/logo?t=' + Date.now(), style: 'max-height:70px;max-width:260px;background:#f1f3f6;border:1px solid var(--line);border-radius:6px;padding:4px;display:block;margin-bottom:8px' }) : h('p', { class: 'muted' }, 'لوگویی بارگذاری نشده است.'),
      h('input', { type: 'file', accept: 'image/png,image/jpeg', onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { const r = await post('/api/settings/logo', { data: await readFileAsDataURL(f) }); toast('لوگو ذخیره شد', 'ok'); paintLogo(r.has_logo); } catch (er) { toast(er.message, 'error'); }
      } }), ' ',
      has ? h('button', { class: 'btn small danger', onclick: async () => { const r = await del('/api/settings/logo'); paintLogo(r.has_logo); } }, 'حذف لوگو') : null);
  }
  paintLogo(s.has_logo);
  const appearance = h('div', { class: 'card' }, h('h2', {}, 'ظاهر'),
    h('div', { class: 'row', style: 'align-items:center' }, h('b', {}, 'رنگ نوار بالا:'), color, swatches),
    h('h3', { style: 'margin:18px 0 6px;font-size:15px' }, 'سربرگ چاپی (گوشه‌ی راست بالای فاکتور)'),
    h('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px' },
      h('label', {}, mode.name, ' نمایش نام شرکت'), h('label', {}, mode.logo, ' نمایش لوگو (PNG یا JPG)')),
    logoBox);

  // ---------- اشتراک‌گذاری ----------
  const pf = {};
  const cards = PLATFORMS.map((p) => {
    const f = pf[p.key] = {
      enabled: h('input', { type: 'checkbox', checked: s[`${p.key}_enabled`] === '1' }),
      token: h('input', { type: 'password', autocomplete: 'off', placeholder: s[`${p.key}_has_token`] ? '•••••• (ثبت شده؛ برای تغییر، توکن جدید بنویسید)' : 'توکن ربات' }),
      chat: h('input', { value: s[`${p.key}_chat`] || '', placeholder: 'مثلاً 123456789 یا @channel (چند مقصد با ویرگول)', class: 'num' }),
      base: h('input', { value: s[`${p.key}_base`] || '', placeholder: p.base, class: 'num' }),
    };
    return h('div', { class: 'pf' }, h('h3', {}, h('label', {}, f.enabled, ' ' + p.name)),
      h('div', { class: 'field' }, h('label', {}, 'توکن ربات'), f.token),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'شناسه‌ی چت / کانال'), f.chat),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'آدرس API (اختیاری؛ برای پروکسی/آینه)'), f.base),
      h('p', { class: 'muted', style: 'font-size:12px;margin:8px 0' }, p.hint),
      h('button', { class: 'btn small', onclick: async (e) => {
        e.target.disabled = true;
        try {
          await onSaved(true); // اول ذخیره‌ی همین مقادیر
          const r = (await post('/api/share/test', { platform: p.key === 'tg' ? 'telegram' : p.key })).results[0];
          toast(`${r.label}: ${r.ok ? 'پیام آزمایشی ارسال شد' : r.error}`, r.ok ? 'ok' : 'error');
        } catch (er) { toast(er.message, 'error'); }
        e.target.disabled = false;
      } }, 'ذخیره و ارسال آزمایشی'));
  });
  const share = h('div', { class: 'card' }, h('h2', {}, 'اشتراک‌گذاری (تلگرام / بله / ایتا)'),
    h('p', { class: 'muted', style: 'margin:0 0 10px' }, 'با دکمه‌ی «ارسال» در فاکتورها، بایگانی و کالاها، فایل از طریق ربات‌های زیر فرستاده می‌شود. توکن‌ها فقط روی همین کامپیوتر ذخیره می‌شوند و به مرورگر برنمی‌گردند. اگر تلگرام از اینترنت شما بسته است، آدرس API یک پروکسی/آینه بگذارید.'),
    h('div', { class: 'grid2' }, cards));

  // ---------- به‌روزرسانی ----------
  const status = h('div', { style: 'margin-top:8px' });
  const btn = h('button', { class: 'btn' }, 'بررسی نسخه‌ی جدید');
  async function check() {
    btn.disabled = true; status.replaceChildren(h('span', { class: 'muted' }, 'در حال بررسی...'));
    try {
      const u = await get('/api/update/check');
      if (u.error) { status.replaceChildren(h('div', { class: 'err' }, u.error)); }
      else if (!u.newer) status.replaceChildren(h('div', { style: 'color:var(--ok)' }, `✔ آخرین نسخه را دارید (${toFaDigits(u.current)})`));
      else {
        const go = h('button', { class: 'btn primary', onclick: async () => {
          if (!(await confirmBox(`نسخه‌ی ${toFaDigits(u.latest)} دانلود و نصب شود؟ از دیتابیس بکاپ گرفته می‌شود، برنامه خودش بسته و دوباره اجرا می‌شود و پنجره‌ی مرورگر را باید رفرش کنید. اطلاعات شما (پوشه‌ی data) دست‌نخورده می‌ماند.`, 'بله، به‌روزرسانی'))) return;
          go.disabled = true; status.append(h('div', { class: 'muted' }, 'در حال دانلود و نصب... (ممکن است یک دقیقه طول بکشد)'));
          try { await post('/api/update/install', { confirm: true }); status.replaceChildren(h('div', { style: 'color:var(--ok)' }, 'نصب شد؛ برنامه در حال راه‌اندازی دوباره است. چند ثانیه صبر کنید و صفحه را رفرش کنید (Ctrl+F5).')); }
          catch (er) { status.append(h('div', { class: 'err' }, er.message)); go.disabled = false; }
        } }, 'به‌روزرسانی به ' + toFaDigits(u.latest));
        status.replaceChildren(
          h('div', { style: 'font-weight:700' }, `نسخه‌ی جدید: ${toFaDigits(u.latest)} (نسخه‌ی شما: ${toFaDigits(u.current)})`),
          u.notes ? h('div', { class: 'notes-box' }, u.notes) : null,
          h('div', { class: 'btnbar' }, u.canAutoUpdate ? go : null, h('a', { class: 'btn', href: u.url, target: '_blank', rel: 'noopener' }, 'صفحه‌ی دانلود')),
          u.canAutoUpdate ? null : h('p', { class: 'muted' }, u.runningFromSource ? 'برنامه از روی سورس اجرا شده؛ به‌روزرسانی با دانلود نسخه‌ی جدید (یا git pull) انجام می‌شود. به‌روزرسانی یک‌کلیکی فقط در نسخه‌ی exe ویندوز است.' : 'برای این سیستم فایل خودکار موجود نیست؛ از صفحه‌ی دانلود استفاده کنید.'));
      }
    } catch (e) { status.replaceChildren(h('div', { class: 'err' }, e.message)); }
    btn.disabled = false;
  }
  btn.addEventListener('click', check);
  const update = h('div', { class: 'card' }, h('h2', {}, 'نسخه و به‌روزرسانی'),
    h('p', { style: 'margin:0 0 8px' }, 'نسخه‌ی فعلی: ', h('b', { style: 'direction:ltr;display:inline-block' }, version)), btn, status);

  function collect() {
    const out = { theme_color: color.value, header_mode: mode.logo.checked && !mode.logo.disabled ? 'logo' : 'name' };
    for (const p of PLATFORMS) {
      const f = pf[p.key];
      out[`${p.key}_enabled`] = f.enabled.checked; out[`${p.key}_chat`] = f.chat.value.trim(); out[`${p.key}_base`] = f.base.value.trim();
      if (f.token.value.trim()) out[`${p.key}_token`] = f.token.value.trim();
    }
    return out;
  }
  return { cards: [appearance, share, update], collect };
}
