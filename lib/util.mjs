import { randomUUID } from 'node:crypto';

export const TZ = 'Asia/Taipei';

// YYYY-MM-DD in Taipei time
export function dayOf(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function today() {
  return dayOf(new Date());
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}

// Monday of the week containing `day`
export function weekStart(day) {
  const d = new Date(`${day}T12:00:00+08:00`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(day, -dow);
}

export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function id() {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function str(v, max = 2000) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

export function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < 24 * 60 ? n : null;
}

export const CATEGORIES = ['提案企劃', '會議', '對外聯繫', '行政雜事', '生活', '其他'];
export const BET_STATUSES = ['pending', 'done', 'not_done', 'rescheduled', 'dropped'];
