import crypto from 'node:crypto';

const SESSION_DAYS = 14;
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function setPassword(db, username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPw(password, salt);
  const ex = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (ex) db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(hash, salt, ex.id);
  else db.prepare('INSERT INTO users(username,password_hash,salt) VALUES (?,?,?)').run(username, hash, salt);
}

/** در اولین اجرا کاربر مدیر می‌سازد. */
export function ensureAdmin(db) {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return null;
  const pw = process.env.ADMIN_PASSWORD || 'admin1234';
  setPassword(db, 'admin', pw);
  return { username: 'admin', password: pw };
}

const attempts = new Map(); // ساده: محدودیت تلاش ناموفق
function tooMany(key) {
  const a = attempts.get(key);
  return a && a.count >= 8 && Date.now() - a.last < 5 * 60_000;
}

export function login(db, username, password, ip) {
  if (tooMany(ip)) return { error: 'تلاش‌های ناموفق زیاد بود. چند دقیقه بعد دوباره امتحان کنید.' };
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || ''));
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(password || ''), u.salt), 'hex'), Buffer.from(u.password_hash, 'hex'));
  if (!ok) {
    const a = attempts.get(ip) || { count: 0 };
    attempts.set(ip, { count: a.count + 1, last: Date.now() });
    return { error: 'نام کاربری یا رمز عبور اشتباه است.' };
  }
  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(sha(token), u.id, Date.now() + SESSION_DAYS * 864e5);
  return { token, user: { id: u.id, username: u.username } };
}

export function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
}

export function userFromToken(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(sha(token), Date.now()) || null;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export { hashPw };
