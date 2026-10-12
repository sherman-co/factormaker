// ارسال فایل/پیام به تلگرام، بله و ایتا با ربات.
export const PLATFORMS = {
  telegram: { label: 'تلگرام', prefix: 'tg', base: 'https://api.telegram.org' },
  bale: { label: 'بله', prefix: 'bale', base: 'https://tapi.bale.ai' },
  eitaa: { label: 'ایتا', prefix: 'eitaa', base: 'https://eitaayar.ir/api' },
};

/** پیکربندی هر پلتفرم از روی تنظیمات. */
export function platformConfig(settings, key) {
  const p = PLATFORMS[key];
  const g = (s) => settings[`${p.prefix}_${s}`] || '';
  return {
    key, label: p.label, enabled: g('enabled') === '1', token: g('token'), base: (g('base') || p.base).replace(/\/+$/, ''),
    chats: g('chat').split(/[\s,،;]+/).filter(Boolean),
  };
}

const scrub = (msg, token) => String(msg).split(token || '\u0000').join('***');
const TIMEOUT = 45_000;

async function call(url, init, token) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new Error(scrub(e.cause?.code || e.name === 'TimeoutError' ? 'اتصال برقرار نشد یا زمان تمام شد (ممکن است نیاز به آدرس پروکسی/آینه باشد)' : e.message, token));
  }
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  const ok = res.ok && (data == null || data.ok !== false);
  if (!ok) throw new Error(scrub(data?.description || data?.message || data?.error || `خطای HTTP ${res.status}`, token));
  return data;
}

function urls(cfg) {
  if (cfg.key === 'eitaa') return { file: `${cfg.base}/${cfg.token}/sendFile`, text: `${cfg.base}/${cfg.token}/sendMessage` };
  return { file: `${cfg.base}/bot${cfg.token}/sendDocument`, text: `${cfg.base}/bot${cfg.token}/sendMessage` };
}

async function sendOne(cfg, chat, { file, text }) {
  const u = urls(cfg);
  if (file) {
    const form = new FormData();
    form.append('chat_id', chat);
    if (file.caption) form.append('caption', file.caption.slice(0, 1000));
    if (cfg.key === 'eitaa') {
      form.append('title', file.filename);
      form.append('file', new Blob([file.buffer], { type: file.mime }), file.filename);
    } else {
      form.append('document', new Blob([file.buffer], { type: file.mime }), file.filename);
    }
    return call(u.file, { method: 'POST', body: form }, cfg.token);
  }
  if (cfg.key === 'eitaa') {
    const form = new FormData();
    form.append('chat_id', chat); form.append('text', text);
    return call(u.text, { method: 'POST', body: form }, cfg.token);
  }
  return call(u.text, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) }, cfg.token);
}

/**
 * ارسال به چند پلتفرم. payload: {file:{buffer,filename,mime,caption}} یا {text}
 * خروجی: [{platform,label,ok,error?}]
 */
export async function shareTo(settings, platforms, payload) {
  const results = [];
  for (const key of platforms) {
    if (!PLATFORMS[key]) { results.push({ platform: key, label: key, ok: false, error: 'پلتفرم ناشناخته' }); continue; }
    const cfg = platformConfig(settings, key);
    if (!cfg.enabled) { results.push({ platform: key, label: cfg.label, ok: false, error: 'در تنظیمات فعال نیست' }); continue; }
    if (!cfg.token || !cfg.chats.length) { results.push({ platform: key, label: cfg.label, ok: false, error: 'توکن یا شناسه‌ی چت در تنظیمات وارد نشده است' }); continue; }
    try {
      for (const chat of cfg.chats) await sendOne(cfg, chat, payload);
      results.push({ platform: key, label: cfg.label, ok: true });
    } catch (e) {
      results.push({ platform: key, label: cfg.label, ok: false, error: e.message });
    }
  }
  return results;
}
