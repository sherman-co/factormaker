import { get, post } from './api.js';
import { h, toast, openCalendar, applyTheme } from './ui.js';
import { toFaDigits } from '/shared/format.js';
import { todayJalali } from '/shared/jdate.js';
import { archivePage } from './pages/archive.js';
import { invoicePage } from './pages/invoice.js';
import { productsPage } from './pages/products.js';
import { customersPage } from './pages/customers.js';
import { settingsPage } from './pages/settings.js';

const app = document.getElementById('app');
let user = null;
let version = '';
let updateInfo = null;
try { applyTheme(localStorage.getItem('fm_theme')); } catch { /* ignore */ }
const WEEKDAY = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long' });
const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function clockEl() {
  const el = h('a', { href: '#', class: 'clock', title: 'باز کردن تقویم شمسی (وقت تهران)', onclick: (e) => { e.preventDefault(); openCalendar(el, todayJalali()); } });
  let seen = false;
  const tick = () => {
    if (seen && !el.isConnected) { clearInterval(timer); return; }
    seen = seen || el.isConnected;
    const now = new Date();
    el.textContent = `${WEEKDAY.format(now)} ${toFaDigits(todayJalali(now))} — ${toFaDigits(TIME.format(now))}`;
  };
  const timer = setInterval(tick, 1000); tick();
  return el;
}

function loginView() {
  app.replaceChildren();
  const u = h('input', { autocomplete: 'username' }); const p = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('div', { class: 'err' });
  const go = async () => {
    try { user = (await post('/api/login', { username: u.value, password: p.value })).user; route(); afterLogin(); } catch (e) { err.textContent = e.message; }
  };
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  app.append(h('div', { class: 'login card' }, h('h1', {}, 'ورود به پنل پیش‌فاکتور'),
    h('div', { class: 'field' }, h('label', {}, 'نام کاربری'), u), h('div', { class: 'field', style: 'margin-top:10px' }, h('label', {}, 'رمز عبور'), p),
    err, h('div', { class: 'btnbar' }, h('button', { class: 'btn primary', onclick: go }, 'ورود'))));
  u.focus();
}

const NAV = [['#/', 'بایگانی'], ['#/invoice/new', 'صدور فاکتور'], ['#/products', 'کالاها'], ['#/customers', 'مشتریان'], ['#/settings', 'تنظیمات']];

async function afterLogin() {
  try { applyTheme((await get('/api/settings')).theme_color); } catch { /* ignore */ }
  get('/api/update/check').then((u) => {
    updateInfo = u;
    const bar = document.querySelector('.topbar .clock');
    if (u.newer && bar && !document.querySelector('.topbar .upd')) bar.before(h('a', { href: '#/settings', class: 'upd', title: 'به‌روزرسانی در تنظیمات' }, 'نسخه‌ی جدید ' + toFaDigits(u.latest))); // بدون بازسازی صفحه
  }).catch(() => {});
}

async function route() {
  if (!user) return loginView();
  const hash = location.hash || '#/';
  app.replaceChildren(h('div', { class: 'topbar' }, h('span', { class: 'brand' }, 'پیش‌فاکتور فروش', h('small', { class: 'ver', title: 'نسخه‌ی برنامه' }, version ? 'v' + toFaDigits(version) : '')),
    NAV.map(([href, label]) => h('a', { href, class: (href === '#/' ? hash === '#/' : hash.startsWith(href.replace('/new', ''))) && !(href === '#/invoice/new' && hash !== '#/invoice/new') ? 'active' : '' }, label)),
    h('span', { class: 'sp' }), updateInfo?.newer ? h('a', { href: '#/settings', class: 'upd', title: 'به‌روزرسانی در تنظیمات' }, 'نسخه‌ی جدید ' + toFaDigits(updateInfo.latest)) : null, clockEl(),
    h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await post('/api/logout'); user = null; route(); } }, 'خروج (' + user.username + ')')));
  const page = h('div');
  app.append(page);
  try {
    let m;
    if (hash === '#/' || hash === '#') await archivePage(page);
    else if ((m = /^#\/invoice\/(\w+)$/.exec(hash))) await invoicePage(page, m[1]);
    else if (hash === '#/products') await productsPage(page);
    else if (hash === '#/customers') await customersPage(page);
    else if (hash === '#/settings') await settingsPage(page);
    else page.append(h('div', { class: 'wrap' }, 'صفحه پیدا نشد'));
  } catch (e) { console.error(e); toast(e.message, 'error'); }
}

window.addEventListener('hashchange', route);
window.addEventListener('fm-logout', () => { user = null; route(); });
(async () => {
  try { version = (await get('/api/version')).version; } catch { /* ignore */ }
  try { user = (await get('/api/me')).user; } catch { user = null; }
  route();
  if (user) afterLogin();
})();
