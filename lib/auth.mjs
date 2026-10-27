import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'dz_session';
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  const s = process.env.APP_SECRET || process.env.APP_PIN;
  if (!s) throw new Error('APP_PIN is not set');
  return s;
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function pinMatches(pin) {
  const expected = process.env.APP_PIN;
  return Boolean(expected) && typeof pin === 'string' && safeEqual(pin, expected);
}

export function sessionCookie(secure) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `v1.${exp}`;
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isAuthed(req) {
  if (!process.env.APP_SECRET && !process.env.APP_PIN) return false;
  const raw = req.headers.get('cookie') || '';
  const match = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return false;
  const token = match.slice(COOKIE.length + 1);
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(payload))) return false;
  return Number(parts[1]) > Date.now() / 1000;
}
