// ارسال فایل/پیام به تلگرام و بله با ربات؛ با پشتیبانی پروکسی (HTTP/HTTPS و SOCKS4/5).
import tls from 'node:tls';
import { fetch, FormData, Agent, ProxyAgent } from 'undici';
import { SocksClient } from 'socks';

export const PLATFORMS = {
  telegram: { label: 'تلگرام', prefix: 'tg', base: 'https://api.telegram.org' },
  bale: { label: 'بله', prefix: 'bale', base: 'https://tapi.bale.ai' },
};

/** پیکربندی هر پلتفرم از روی تنظیمات. */
export function platformConfig(settings, key) {
  const p = PLATFORMS[key];
  const g = (s) => settings[`${p.prefix}_${s}`] || '';
  return {
    key, label: p.label, enabled: g('enabled') === '1', token: g('token'), base: (g('base') || p.base).replace(/\/+$/, ''),
    chats: g('chat').split(/[\s,،;]+/).filter(Boolean),
    proxy: g('use_proxy') === '1' ? (settings.proxy_url || '').trim() : '',
  };
}

// ---------- پروکسی ----------
const dispatchers = new Map();

function socksAgent(u) {
  return new Agent({
    connect: (opts, cb) => {
      SocksClient.createConnection({
        proxy: { host: u.hostname, port: Number(u.port) || 1080, type: u.protocol.startsWith('socks4') ? 4 : 5, userId: decodeURIComponent(u.username) || undefined, password: decodeURIComponent(u.password) || undefined },
        command: 'connect',
        destination: { host: opts.hostname, port: Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80) },
      }).then(({ socket }) => {
        if (opts.protocol !== 'https:') return cb(null, socket);
        const t = tls.connect({ socket, servername: opts.servername || opts.hostname });
        t.once('secureConnect', () => cb(null, t));
        t.once('error', cb);
      }).catch(cb);
    },
  });
}

/** آدرس پروکسی معتبر؟ http://host:port ، https://… ، socks5://host:port (socks5h و socks4 هم) */
export function parseProxy(str) {
  let u;
  try { u = new URL(str); } catch { return null; }
  return /^(https?|socks4a?|socks5h?):$/.test(u.protocol) && u.hostname ? u : null;
}

function dispatcherFor(proxy) {
  if (!proxy) return undefined;
  if (!dispatchers.has(proxy)) {
    const u = parseProxy(proxy);
    if (!u) throw new Error('آدرس پروکسی نامعتبر است (مثال: http://127.0.0.1:10809 یا socks5://127.0.0.1:10808)');
    dispatchers.set(proxy, u.protocol.startsWith('socks') ? socksAgent(u) : new ProxyAgent({ uri: proxy, proxyTunnel: true }));
  }
  return dispatchers.get(proxy);
}

const scrub = (msg, ...secrets) => secrets.filter(Boolean).reduce((m, t) => String(m).split(t).join('***'), String(msg));
const TIMEOUT = 45_000;

async function call(url, init, cfg) {
  let res;
  try {
    res = await fetch(url, { ...init, dispatcher: dispatcherFor(cfg.proxy), signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    const net = e.name === 'TimeoutError' || e.cause?.code || /socks|proxy|connect/i.test(e.message);
    throw new Error(scrub(net ? (cfg.proxy ? 'اتصال از طریق پروکسی برقرار نشد؛ آدرس و روشن بودن پروکسی را بررسی کنید' : 'اتصال برقرار نشد یا زمان تمام شد؛ اگر این پیام‌رسان از اینترنت شما بسته است، پروکسی را در تنظیمات فعال کنید') : e.message, cfg.token, cfg.proxy));
  }
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!(res.ok && (data == null || data.ok !== false))) throw new Error(scrub(data?.description || data?.message || data?.error || `خطای HTTP ${res.status}`, cfg.token, cfg.proxy));
  return data;
}

async function sendOne(cfg, chat, { file, text }) {
  const root = `${cfg.base}/bot${cfg.token}`;
  if (file) {
    const form = new FormData();
    form.append('chat_id', chat);
    if (file.caption) form.append('caption', file.caption.slice(0, 1000));
    form.append('document', new Blob([file.buffer], { type: file.mime }), file.filename);
    return call(`${root}/sendDocument`, { method: 'POST', body: form }, cfg);
  }
  return call(`${root}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) }, cfg);
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
