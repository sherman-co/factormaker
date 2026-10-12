import { get, post, del } from '../api.js';
import { h, toast, confirmBox, applyTheme, readFileAsDataURL, bindDigitsText } from '../ui.js';
import { toFaDigits } from '/shared/format.js';
import { shareOptions, buildFileName, buildCaption, FILE_SEPARATORS, SHARE_MODES } from '/shared/share-format.js';

const PRESETS = ['#16314f', '#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#374151', '#e5e7eb'];
const PLATFORMS = [
  { key: 'tg', api: 'telegram', name: 'تلگرام', hint: 'ساخت ربات: @BotFather. شناسه‌ی چت عددی یا @کانال؛ ربات باید عضو چت/کانال باشد. در ایران معمولاً به پروکسی نیاز دارد.', base: 'https://api.telegram.org' },
  { key: 'bale', api: 'bale', name: 'بله', hint: 'ساخت ربات: @botfather در بله. ربات را به چت/کانال اضافه کنید. معمولاً بدون پروکسی کار می‌کند.', base: 'https://tapi.bale.ai' },
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
      proxy: h('input', { type: 'checkbox', checked: s[`${p.key}_use_proxy`] === '1' }),
    };
    return h('div', { class: 'pf' }, h('h3', {}, h('label', {}, f.enabled, ' ' + p.name)),
      h('div', { class: 'field' }, h('label', {}, 'توکن ربات'), f.token),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'شناسه‌ی چت / کانال'), f.chat),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'آدرس API (اختیاری؛ برای پروکسی/آینه)'), f.base),
      h('label', { style: 'display:block;margin-top:10px' }, f.proxy, ' ارسال از طریق پروکسی (بالا تعریف می‌شود)'),
      h('p', { class: 'muted', style: 'font-size:12px;margin:8px 0' }, p.hint),
      h('button', { class: 'btn small', onclick: async (e) => {
        e.target.disabled = true;
        try {
          await onSaved(true); // اول ذخیره‌ی همین مقادیر
          const r = (await post('/api/share/test', { platform: p.api })).results[0];
          toast(`${r.label}: ${r.ok ? 'پیام آزمایشی ارسال شد' : r.error}`, r.ok ? 'ok' : 'error');
        } catch (er) { toast(er.message, 'error'); }
        e.target.disabled = false;
      } }, 'ذخیره و ارسال آزمایشی'));
  });
  const proxy = h('input', { value: s.proxy_url || '', placeholder: 'http://127.0.0.1:10809   یا   socks5://127.0.0.1:10808', class: 'num' });
  const share = h('div', { class: 'card' }, h('h2', {}, 'اشتراک‌گذاری (تلگرام / بله)'),
    h('p', { class: 'muted', style: 'margin:0 0 10px' }, 'با دکمه‌ی «ارسال» در فاکتورها، بایگانی و کالاها، فایل از طریق ربات‌های زیر فرستاده می‌شود. توکن‌ها فقط روی همین کامپیوتر ذخیره می‌شوند و به مرورگر برنمی‌گردند. اگر تلگرام از اینترنت شما بسته است، آدرس API یک پروکسی/آینه بگذارید.'),
    h('div', { class: 'field', style: 'margin-bottom:12px' }, h('label', {}, 'آدرس پروکسی (اختیاری)'), proxy,
      h('small', { class: 'muted' }, 'اگر از v2rayN/Clash/Nekoray و مشابه استفاده می‌کنید، آدرس پورت محلی آن را بنویسید: پورت HTTP (مثلاً http://127.0.0.1:10809) یا SOCKS (مثلاً socks5://127.0.0.1:10808). فقط برای پلتفرم‌هایی که «ارسال از طریق پروکسی» را تیک زده‌اند استفاده می‌شود.')),
    h('div', { class: 'grid2' }, cards),
    h('p', { class: 'muted', style: 'font-size:12px;margin-bottom:0' }, 'واتساپ: ارسال خودکار پشتیبانی نمی‌شود؛ در پنجره‌ی «ارسال» گزینه‌ی واتساپ، متن آماده را باز می‌کند و فایل را دانلود می‌کند تا داخل چت بکشید.'));

  // ---------- قالب نام فایل و متن ارسال ----------
  const so = shareOptions(s);
  const cb = (checked, label) => { const i = h('input', { type: 'checkbox', checked }); return { i, el: h('label', { style: 'display:inline-flex;gap:6px;align-items:center;margin-inline-end:14px' }, i, label) }; };
  const fT = cb(so.file.type, 'نوع سند (پیش‌فاکتور / فاکتور)'); const fN = cb(so.file.number, 'شماره'); const fD = cb(so.file.date, 'تاریخ'); const fB = cb(so.file.buyer, 'نام خریدار');
  const SEP_LABEL = { ' - ': 'خط تیره با فاصله ( - )', '_': 'زیرخط ( _ )', '-': 'خط تیره ( - بدون فاصله )', ' ': 'فاصله' };
  const sep = h('select', { style: 'width:auto' }, FILE_SEPARATORS.map((v) => h('option', { value: v, selected: v === so.file.sep }, SEP_LABEL[v])));
  const cT = cb(so.cap.title, 'عنوان (پیش‌فاکتور شماره …)'); const cD = cb(so.cap.date, 'تاریخ'); const cB = cb(so.cap.buyer, 'نام خریدار'); const cA = cb(so.cap.amount, 'مبلغ قابل پرداخت');
  const extra = h('input', { value: so.cap.extra, placeholder: 'اختیاری، مثلاً: با تشکر از خرید شما', maxlength: 300 });
  const modeSel = Object.fromEntries(Object.entries(SHARE_MODES).map(([k, label]) => [k, { r: h('input', { type: 'radio', name: 'sharemode', checked: so.mode === k }), label }]));
  const fnPrev = h('b', { style: 'direction:ltr;display:inline-block' }); const capPrev = h('div', { style: 'white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-height:40px' });
  const sample = { typeLabel: 'پیش‌فاکتور', number: 1001, jdate: '1405/07/20', buyer: 'خریدار نمونه', payable: 183000000 };
  const current = () => ({ file: { type: fT.i.checked, number: fN.i.checked, date: fD.i.checked, buyer: fB.i.checked, sep: sep.value }, cap: { title: cT.i.checked, date: cD.i.checked, buyer: cB.i.checked, amount: cA.i.checked, extra: extra.value }, mode: Object.keys(modeSel).find((k) => modeSel[k].r.checked) });
  const repaint = () => { const o = current(); fnPrev.textContent = buildFileName(o, sample); capPrev.textContent = buildCaption(o, sample) || '(بدون متن)'; };
  for (const el of [fT.i, fN.i, fD.i, fB.i, cT.i, cD.i, cB.i, cA.i, sep, extra, ...Object.values(modeSel).map((m) => m.r)]) el.addEventListener('input', repaint);
  repaint();
  const format = h('div', { class: 'card' }, h('h2', {}, 'قالب نام فایل و متن ارسال'),
    h('p', { class: 'muted', style: 'margin:0 0 10px' }, 'برای ارسال فاکتور به تلگرام، بله و واتساپ. در پنجره‌ی «ارسال» هم می‌توانید برای همان بار تغییرش دهید.'),
    h('h3', { style: 'margin:0 0 6px;font-size:15px' }, 'نام فایل شامل چه چیزهایی باشد؟'),
    h('div', {}, fT.el, fN.el, fD.el, fB.el),
    h('div', { style: 'margin:8px 0' }, 'جداکننده: ', sep),
    h('div', { style: 'margin-bottom:14px' }, 'نمونه: ', fnPrev),
    h('h3', { style: 'margin:0 0 6px;font-size:15px' }, 'متن همراه فایل (زیرنویس) شامل چه چیزهایی باشد؟'),
    h('div', {}, cT.el, cD.el, cB.el, cA.el),
    h('div', { class: 'field', style: 'margin:8px 0' }, h('label', {}, 'یک خط دلخواه در انتهای متن'), extra),
    h('div', { style: 'margin-bottom:14px' }, 'نمونه:', capPrev),
    h('h3', { style: 'margin:0 0 6px;font-size:15px' }, 'ترتیب ارسال'),
    ...Object.values(modeSel).map((m) => h('div', {}, h('label', {}, m.r, ' ', m.label))));

  // ---------- به‌روزرسانی ----------
  const updProxy = h('input', { type: 'checkbox', checked: s.update_use_proxy === '1' });
  const updToken = h('input', { type: 'password', autocomplete: 'off', placeholder: s.update_has_token ? '•••••• (ثبت شده؛ برای تغییر، توکن جدید بنویسید)' : 'github_pat_…  (فقط اگر مخزن خصوصی است)' });
  const status = h('div', { style: 'margin-top:8px' });
  const btn = h('button', { class: 'btn' }, 'بررسی نسخه‌ی جدید');
  async function check() {
    btn.disabled = true; status.replaceChildren(h('span', { class: 'muted' }, 'در حال بررسی...'));
    try {
      await onSaved(true); // تنظیمات فعلی (پروکسی/توکن) اول ذخیره می‌شود
      const u = await get('/api/update/check');
      if (u.error) status.replaceChildren(h('div', { class: 'err' }, u.error), h('div', { style: 'margin-top:6px' }, h('a', { class: 'btn small', href: u.url, target: '_blank', rel: 'noopener' }, 'باز کردن صفحه‌ی دانلود (دستی)')));
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
    h('p', { style: 'margin:0 0 8px' }, 'نسخه‌ی فعلی: ', h('b', { style: 'direction:ltr;display:inline-block' }, version)),
    h('div', { class: 'field', style: 'margin-bottom:8px' }, h('label', {}, 'توکن GitHub (فقط اگر مخزن «خصوصی» است)'), updToken,
      h('small', { class: 'muted' }, 'ساخت توکن فقط‌خواندنی: GitHub ← Settings ← Developer settings ← Personal access tokens ← Fine-grained tokens؛ فقط همین مخزن را انتخاب کنید و دسترسی «Contents: Read-only» بدهید. اگر مخزن عمومی است، لازم نیست.')),
    h('label', { style: 'display:block;margin-bottom:10px' }, updProxy, ' برای بررسی و دانلود به‌روزرسانی از «پروکسی» (تعریف‌شده در بخش اشتراک‌گذاری) استفاده شود'),
    btn, status);

  function collect() {
    const o = current();
    const out = {
      share_file_type: o.file.type, share_file_number: o.file.number, share_file_date: o.file.date, share_file_buyer: o.file.buyer, share_file_sep: o.file.sep,
      share_cap_title: o.cap.title, share_cap_date: o.cap.date, share_cap_buyer: o.cap.buyer, share_cap_amount: o.cap.amount, share_cap_extra: o.cap.extra, share_mode: o.mode,
      update_use_proxy: updProxy.checked, proxy_url: proxy.value.trim(), theme_color: color.value, header_mode: mode.logo.checked && !mode.logo.disabled ? 'logo' : 'name' };
    if (updToken.value.trim()) out.update_token = updToken.value.trim();
    for (const p of PLATFORMS) {
      const f = pf[p.key];
      out[`${p.key}_enabled`] = f.enabled.checked; out[`${p.key}_use_proxy`] = f.proxy.checked; out[`${p.key}_chat`] = f.chat.value.trim(); out[`${p.key}_base`] = f.base.value.trim();
      if (f.token.value.trim()) out[`${p.key}_token`] = f.token.value.trim();
    }
    return out;
  }
  return { cards: [appearance, share, format, update], collect };
}
