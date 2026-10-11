import { toEnDigits, toFaDigits, parseNumber, formatNumber } from '/shared/format.js';
import * as jalaali from 'jalaali-js';

/** ساخت عنصر DOM: h('div', {class:'x', onclick}, child...) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

export function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3000);
}

export function modal(title, body, { wide = false } = {}) {
  const bg = h('div', { class: 'modal-bg' });
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') }, h('h2', {}, title), body);
  bg.append(box);
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  return { close, box };
}

export function confirmBox(message, okText = 'تأیید') {
  return new Promise((resolve) => {
    const m = modal('تأیید', h('div', {},
      h('p', {}, message),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { m.close(); resolve(true); } }, okText),
        h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, 'انصراف'))));
  });
}

// ---------- ورودی عددی با ارقام فارسی و جداکننده هزارگان ----------
const isNumCh = (c) => /[0-9۰-۹٠-٩.٫]/.test(c);

export function bindNumber(input, { decimal = false, onChange } = {}) {
  input.classList.add('num');
  input.setAttribute('inputmode', decimal ? 'decimal' : 'numeric');
  input.setAttribute('autocomplete', 'off');
  const reformat = () => {
    const pos = input.selectionStart ?? input.value.length;
    let before = 0;
    for (const c of input.value.slice(0, pos)) if (isNumCh(c)) before++;
    let raw = toEnDigits(input.value).replace(/[٫]/g, '.').replace(/[^0-9.]/g, '');
    if (!decimal) raw = raw.replace(/\./g, '');
    const firstDot = raw.indexOf('.');
    if (firstDot >= 0) raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
    let [int, frac] = raw.split('.');
    int = int.slice(0, 15).replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const out = toFaDigits(int + (frac !== undefined ? '.' + frac : '')).replace('.', '٫');
    input.value = out;
    let seen = 0; let np = 0;
    for (; np < out.length && seen < before; np++) if (isNumCh(out[np])) seen++;
    input.setSelectionRange(np, np);
  };
  input.addEventListener('input', () => { reformat(); onChange?.(); });
  return input;
}
export const numValue = (input) => (input.value.trim() === '' ? null : parseNumber(input.value));
export const setNum = (input, n) => { input.value = n === null || n === undefined || n === '' ? '' : formatNumber(n); };

/** متن ورودی که ارقام را به فارسی نشان می‌دهد (برای شناسه ملی/تلفن)؛ مقدار واقعی با ارقام انگلیسی خوانده می‌شود. */
export function bindDigitsText(input) {
  input.classList.add('num');
  input.addEventListener('input', () => {
    const p = input.selectionStart;
    input.value = toFaDigits(toEnDigits(input.value));
    input.setSelectionRange(p, p);
  });
  return input;
}
export const digitsValue = (input) => toEnDigits(input.value).trim();
export const setDigits = (input, v) => { input.value = toFaDigits(v ?? ''); };

// ---------- تکمیل خودکار ----------
function hostOf(input) {
  const p = input.parentNode;
  if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
  return p;
}

function highlight(text, q) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return [text.slice(0, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
}

/**
 * تکمیل خودکار با پنجره‌ی شناور (fixed) که از کانتینر جدول بیرون می‌زند و اسکرول داخلی ندارد مگر لیست خیلی بلند باشد.
 * options: search(q)->items | label(it) | sub(it) | meta(it) | group(it) | onPick(it) | query() برای هایلایت
 */
export function autocomplete(input, { search, label, sub, meta, group, onPick, minChars = 0, width = 440 }) {
  let list = null; let items = []; let sel = -1; let seq = 0;
  const close = () => { list?.remove(); list = null; sel = -1; window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  function place() {
    if (!list) return;
    const r = input.getBoundingClientRect();
    const w = Math.max(width, r.width);
    const maxH = Math.min(420, window.innerHeight * 0.6);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const openUp = below < 220 && above > below;
    list.style.maxHeight = Math.max(160, Math.min(maxH, openUp ? above : below)) + 'px';
    list.style.width = w + 'px';
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    list.style.left = left + 'px';
    if (openUp) { list.style.top = ''; list.style.bottom = (window.innerHeight - r.top + 4) + 'px'; } else { list.style.bottom = ''; list.style.top = (r.bottom + 4) + 'px'; }
  }
  const paint = () => {
    list?.remove();
    if (!items.length) { list = null; return; }
    const q = input.value.trim();
    const nodes = [];
    let lastGroup = null;
    items.forEach((it, i) => {
      if (group) { const g = group(it); if (g !== lastGroup) { nodes.push(h('div', { class: 'ac-group' }, g)); lastGroup = g; } }
      nodes.push(h('div', { class: 'ac-item' + (i === sel ? ' sel' : ''), 'data-i': i, onmousedown: (e) => { e.preventDefault(); pick(i); } },
        h('span', { class: 'ac-main' }, highlight(label(it), q)),
        meta ? h('span', { class: 'ac-meta' }, meta(it)) : null,
        sub ? h('span', { class: 'ac-sub' }, sub(it)) : null));
    });
    list = h('div', { class: 'ac-list' }, nodes);
    document.body.append(list);
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => { const it = items[i]; close(); if (it) onPick(it); };
  const run = async () => {
    const q = input.value;
    if (q.trim().length < minChars) { close(); return; }
    const my = ++seq;
    const res = await search(q);
    if (my !== seq) return;
    items = res; sel = res.length && q.trim() ? 0 : -1; paint();
  };
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (minChars === 0) run(); });
  input.addEventListener('blur', () => setTimeout(close, 130));
  input.addEventListener('keydown', (e) => {
    if (!list) { if (e.key === 'ArrowDown') run(); return; }
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && sel >= 0) { pick(sel); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
}

// ---------- تقویم شمسی ----------
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const pad = (n) => String(n).padStart(2, '0');

/** input را به یک انتخابگر تاریخ شمسی تبدیل می‌کند؛ مقدار به‌صورت 1405/07/19 (ارقام فارسی نمایش داده می‌شود). */
export function bindDate(input, { today, onChange } = {}) {
  input.classList.add('num');
  input.setAttribute('autocomplete', 'off');
  let cal = null;
  const get = () => toEnDigits(input.value).trim();
  const close = () => { cal?.remove(); cal = null; };
  const open = () => {
    close();
    let cur = /^\d{4}\/\d{2}\/\d{2}$/.test(get()) ? get() : today || '1405/01/01';
    let [jy, jm] = cur.split('/').map(Number);
    const selected = get();
    const draw = () => {
      cal?.remove();
      const len = jalaali.jalaaliMonthLength(jy, jm);
      const g = jalaali.toGregorian(jy, jm, 1);
      const first = (new Date(g.gy, g.gm - 1, g.gd).getDay() + 1) % 7;
      const nav = (d) => { jm += d; if (jm > 12) { jm = 1; jy++; } if (jm < 1) { jm = 12; jy--; } draw(); };
      const cells = DAYS.map((d) => h('b', {}, d));
      for (let i = 0; i < first; i++) cells.push(h('span'));
      for (let d = 1; d <= len; d++) {
        const v = `${jy}/${pad(jm)}/${pad(d)}`;
        cells.push(h('button', {
          type: 'button', class: (v === selected ? 'sel ' : '') + (v === today ? 'today' : ''),
          onmousedown: (e) => { e.preventDefault(); input.value = toFaDigits(v); close(); onChange?.(v); },
        }, toFaDigits(d)));
      }
      const ysel = h('select', { onchange: (e) => { jy = Number(e.target.value); draw(); } },
        Array.from({ length: 31 }, (_, i) => jy - 15 + i).map((y) => h('option', { value: y, selected: y === jy }, toFaDigits(y))));
      const msel = h('select', { onchange: (e) => { jm = Number(e.target.value); draw(); } },
        MONTHS.map((m, i) => h('option', { value: i + 1, selected: i + 1 === jm }, m)));
      cal = h('div', { class: 'cal', onmousedown: (e) => e.preventDefault() },
        h('div', { class: 'cal-head' },
          h('button', { type: 'button', class: 'btn small', onclick: () => nav(1) }, '‹'),
          h('span', { style: 'display:flex;gap:4px' }, msel, ysel),
          h('button', { type: 'button', class: 'btn small', onclick: () => nav(-1) }, '›')),
        h('div', { class: 'cal-grid' }, cells),
        today ? h('div', { style: 'margin-top:6px;text-align:center' },
          h('button', { type: 'button', class: 'btn small', onclick: () => { input.value = toFaDigits(today); close(); onChange?.(today); } }, 'امروز')) : null);
      hostOf(input).append(cal);
      cal.style.top = input.offsetTop + input.offsetHeight + 4 + 'px';
    };
    draw();
  };
  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('input', () => {
    const p = input.selectionStart;
    input.value = toFaDigits(toEnDigits(input.value).replace(/[^0-9/]/g, ''));
    input.setSelectionRange(p, p);
    onChange?.(get());
  });
  return { get, set: (v) => { input.value = toFaDigits(v || ''); } };
}

export const faDate = (s) => toFaDigits(s || '');
export function download(url) { const a = h('a', { href: url }); document.body.append(a); a.click(); a.remove(); }

/** تقویم شمسی مستقل (برای نوار بالا)؛ زیر anchor باز می‌شود و با کلیک بیرون بسته می‌شود. */
export function openCalendar(anchor, today) {
  document.getElementById('topcal')?.remove();
  let [jy, jm] = today.split('/').map(Number);
  const box = h('div', { class: 'cal', id: 'topcal', style: 'position:fixed;top:56px;inset-inline-start:12px' });
  const close = () => { box.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  const draw = () => {
    const len = jalaali.jalaaliMonthLength(jy, jm);
    const g = jalaali.toGregorian(jy, jm, 1);
    const first = (new Date(g.gy, g.gm - 1, g.gd).getDay() + 1) % 7;
    const nav = (d) => { jm += d; if (jm > 12) { jm = 1; jy++; } if (jm < 1) { jm = 12; jy--; } draw(); };
    const cells = DAYS.map((d) => h('b', {}, d));
    for (let i = 0; i < first; i++) cells.push(h('span'));
    for (let d = 1; d <= len; d++) {
      const v = `${jy}/${pad(jm)}/${pad(d)}`;
      const col = (first + d - 1) % 7;
      cells.push(h('button', { type: 'button', class: v === today ? 'sel' : '', style: col === 6 ? 'color:var(--danger)' : '', title: `${d} ${MONTHS[jm - 1]}` }, toFaDigits(d)));
    }
    box.replaceChildren(
      h('div', { class: 'cal-head' },
        h('button', { type: 'button', class: 'btn small', onclick: () => nav(1) }, '‹'),
        h('b', {}, `${MONTHS[jm - 1]} ${toFaDigits(jy)}`),
        h('button', { type: 'button', class: 'btn small', onclick: () => nav(-1) }, '›')),
      h('div', { class: 'cal-grid' }, cells),
      h('div', { style: 'margin-top:6px;text-align:center' }, h('button', { type: 'button', class: 'btn small', onclick: () => { [jy, jm] = today.split('/').map(Number); draw(); } }, 'امروز')));
  };
  draw();
  document.body.append(box);
  document.addEventListener('mousedown', outside, true);
}
