import * as d from './domain.mjs';
import { pinMatches, sessionCookie, clearCookie, isAuthed } from './auth.mjs';
import { exportAll, wipe, load } from './store.mjs';
import { aiEnabled } from './ai.mjs';
import { lineEnabled } from './line.mjs';
import { json, HttpError, today, isDay } from './util.mjs';

const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, re, keys, handler, open });
};

let failedLogins = 0;
route('POST', '/login', async ({ body, req }) => {
  if (failedLogins > 20) throw new HttpError(429, '嘗試太多次，請稍後再試');
  if (!pinMatches(String(body.pin ?? ''))) {
    failedLogins++;
    await new Promise((r) => setTimeout(r, 600));
    throw new HttpError(401, 'PIN 不正確');
  }
  failedLogins = 0;
  const secure = new URL(req.url).protocol === 'https:';
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(secure) });
}, { open: true });
route('POST', '/logout', () => json({ ok: true }, 200, { 'set-cookie': clearCookie() }), { open: true });
route('GET', '/me', ({ req }) => json({ authed: isAuthed(req), today: today() }), { open: true });

route('GET', '/settings', async () => {
  const s = await load('settings');
  return { ai: aiEnabled(), line: lineEnabled(), lineLinked: Boolean(s.lineUserId), today: today() };
});

route('GET', '/dashboard', ({ q }) => d.dashboard(isDay(q.day) ? q.day : today()));

route('GET', '/entries', ({ q }) => (q.q ? d.searchEntries(q.q) : d.entriesForDay(isDay(q.day) ? q.day : today())));
route('POST', '/entries', ({ body }) => d.createEntry({ text: body.text, occurredAt: body.occurredAt }));
route('PATCH', '/entries/:id', ({ p, body }) => d.editEntry(p.id, body));
route('DELETE', '/entries/:id', async ({ p }) => (await d.deleteEntry(p.id), { ok: true }));
route('POST', '/entries/:id/analyze', ({ p }) => d.reanalyze(p.id));
route('POST', '/entries/:id/accept', ({ p, body }) => d.acceptSuggestions(p.id, Array.isArray(body.picks) ? body.picks : []));
route('POST', '/entries/:id/observations/:oid', ({ p, body }) => d.observationFeedback(p.id, p.oid, body));

route('POST', '/bets', ({ body }) => d.addBet(body));
route('PATCH', '/bets/:id', ({ p, body }) => d.patchBet(p.id, body));
route('DELETE', '/bets/:id', async ({ p }) => (await d.deleteBet(p.id), { ok: true }));

route('GET', '/reconcile', ({ q }) => d.reconcileView(isDay(q.day) ? q.day : today()));
route('POST', '/reconcile/finish', async ({ body }) => (await d.finishReconcile(isDay(body.day) ? body.day : today()), { ok: true }));

route('GET', '/weekly', ({ q }) => d.weeklyView(q.week));
route('POST', '/weekly/generate', ({ body }) => d.generateWeekly(body.week));
route('POST', '/weekly/:week/patterns/:pid', ({ p, body }) => d.patternFeedback(p.week, p.pid, body));

route('POST', '/adjustments', ({ body }) => d.createAdjustment(body));
route('POST', '/adjustments/:id/verify', ({ p, body }) => d.verifyAdjustment(p.id, body));

route('GET', '/trail', () => d.trail(today()));
route('GET', '/link-candidates', ({ q }) => d.linkCandidates(q.q));
route('POST', '/outcomes', ({ body }) => d.createOutcome(body));
route('PATCH', '/outcomes/:id', ({ p, body }) => d.patchOutcome(p.id, body));
route('DELETE', '/outcomes/:id', async ({ p }) => (await d.deleteOutcome(p.id), { ok: true }));

route('GET', '/export', async () => json(await exportAll(), 200, {
  'content-disposition': `attachment; filename="duizhang-${today()}.json"`,
}));
route('POST', '/wipe', async ({ body }) => {
  if (body.confirm !== '刪除全部') throw new HttpError(400, '請輸入「刪除全部」確認');
  await wipe();
  return { ok: true };
});

export async function handleApi(req, path) {
  try {
    const url = new URL(req.url);
    const r = routes.find((x) => x.method === req.method && x.re.test(path));
    if (!r) throw new HttpError(404, '找不到 API');
    if (!r.open && !isAuthed(req)) throw new HttpError(401, '請先登入');
    const m = path.match(r.re);
    const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let body = {};
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      const text = await req.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new HttpError(400, 'JSON 格式錯誤');
        }
      }
    }
    const out = await r.handler({ req, p, q: Object.fromEntries(url.searchParams), body });
    return out instanceof Response ? out : json(out ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: '伺服器錯誤' }, 500);
  }
}
