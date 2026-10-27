import { createHmac, timingSafeEqual } from 'node:crypto';
import { load, update } from './store.mjs';
import { createEntry, acceptSuggestions, reconcileView, patchBet, finishReconcile } from './domain.mjs';
import { today, addDays } from './util.mjs';

export function lineEnabled() {
  return Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);
}

export function verifySignature(body, signature) {
  if (!signature || !process.env.LINE_CHANNEL_SECRET) return false;
  const expected = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(body).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function callLine(endpoint, payload) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LINE ${endpoint} ${res.status}: ${await res.text()}`);
}

export const reply = (replyToken, text) => callLine('reply', { replyToken, messages: [{ type: 'text', text: text.slice(0, 4900) }] });
export const push = (to, text) => callLine('push', { to, messages: [{ type: 'text', text: text.slice(0, 4900) }] });

const DONE = /(全部?有做|都有做|有做|做了|做完|完成)/;
const NOT_DONE = /(沒有做|沒做|没做|未做)/;
const RESCHEDULE = /(改期|改天|明天做)/;

// Parses replies like "1 2 有做，3 沒做 被插隊" against the numbered list we pushed.
export function parseReconcileReply(text, count) {
  const results = new Map();
  if (/^(全部?|都)有做/.test(text.trim())) {
    for (let i = 1; i <= count; i++) results.set(i, { status: 'done' });
    return results;
  }
  // Walk tokens in order: numbers queue up until a status word claims them,
  // and text after 沒做 (up to the next number) is the reason.
  const TOKEN = new RegExp(`(\\d+)|${NOT_DONE.source}|${RESCHEDULE.source}|${DONE.source}`, 'g');
  let queue = [];
  let last = null; // { nums, end } of the latest 沒做, to attach a reason
  for (const m of text.matchAll(TOKEN)) {
    if (last) {
      const reason = text.slice(last.end, m.index).replace(/[，,；;。、\s]+/g, ' ').trim();
      if (reason) for (const n of last.nums) results.get(n).reason = reason;
      last = null;
    }
    if (m[1]) {
      const n = Number(m[1]);
      if (n >= 1 && n <= count) queue.push(n);
      continue;
    }
    const status = NOT_DONE.test(m[0]) ? 'not_done' : RESCHEDULE.test(m[0]) ? 'rescheduled' : 'done';
    for (const n of queue) results.set(n, { status, reason: null });
    if (status === 'not_done' && queue.length) last = { nums: queue, end: m.index + m[0].length };
    queue = [];
  }
  if (last) {
    const reason = text.slice(last.end).replace(/[，,；;。、\s]+/g, ' ').trim();
    if (reason) for (const n of last.nums) results.get(n).reason = reason;
  }
  return results;
}

export async function reconcileMessage(day = today()) {
  const v = await reconcileView(day);
  const pending = v.bets.filter((b) => b.status === 'pending');
  if (!pending.length && !v.overdue.length) return null;
  const lines = [`今晚對帳 ${day.slice(5).replace('-', '/')}`];
  if (pending.length) {
    lines.push('今天押注的事，回數字就好：');
    pending.forEach((b, i) => lines.push(`${i + 1} ${b.title}`));
    lines.push('', '例如：「1 2 有做，3 沒做 被插隊」或「全部有做」');
  }
  if (v.overdue.length) lines.push('', `另有 ${v.overdue.length} 件過期還沒確認，到網頁「今晚對帳」點一下就好。`);
  return { text: lines.join('\n'), betIds: pending.map((b) => b.id) };
}

async function handleText(event, text) {
  const settings = await load('settings');
  const t = text.trim();

  // Reply to tonight's reconcile card
  const pendingCard = settings.lineCard;
  if (pendingCard?.day === today() && /\d|全部?有做|都有做/.test(t) && (DONE.test(t) || NOT_DONE.test(t) || RESCHEDULE.test(t))) {
    const parsed = parseReconcileReply(t, pendingCard.betIds.length);
    if (parsed.size) {
      const lines = [];
      for (const [n, r] of parsed) {
        const betId = pendingCard.betIds[n - 1];
        const patch = { status: r.status };
        if (r.status === 'not_done' && r.reason) patch.reason = r.reason;
        if (r.status === 'rescheduled') patch.day = addDays(today(), 1);
        const b = await patchBet(betId, patch);
        lines.push(`${n} ${b.title}：${{ done: '有做', not_done: '沒做', rescheduled: '改期到明天' }[r.status]}`);
      }
      const v = await reconcileView(today());
      if (!v.bets.some((b) => b.status === 'pending')) await finishReconcile(today());
      return `記下了：\n${lines.join('\n')}\n\n實際花多久可以到網頁補，沒補也沒關係。`;
    }
  }

  // Accept suggested bets from the latest entry
  if (/^(押|全押|設為押注)$/.test(t) && settings.lastSuggestEntry) {
    const entries = await load('entries');
    const e = entries.find((x) => x.id === settings.lastSuggestEntry);
    const picks = (e?.suggestions ?? []).filter((s) => !s.betId).map((s) => ({ id: s.id }));
    const created = picks.length ? await acceptSuggestions(e.id, picks) : [];
    return created.length ? `已設為押注：\n${created.map((b) => `・${b.title}`).join('\n')}\n晚上 9 點對帳。` : '沒有可以設為押注的事項。';
  }

  const entry = await createEntry({ text: t, source: 'line', occurredAt: new Date(event.timestamp).toISOString() });
  const fresh = entry.suggestions.filter((s) => !s.betId);
  await update('settings', (s) => {
    s.lastSuggestEntry = fresh.length ? entry.id : null;
  });
  if (entry.aiError) return '記下了。（AI 整理暫時失敗，可以到網頁按「AI 重新整理」）';
  if (!fresh.length) return '記下了。';
  const list = fresh.map((s) => `・${s.title}${s.estimateMin ? `（預估 ${s.estimateMin} 分）` : ''}`).join('\n');
  return `記下了。抓到 ${fresh.length} 件要做的事：\n${list}\n\n回「押」全部設為今日押注，或到網頁挑選。`;
}

export async function handleWebhook(body) {
  const payload = JSON.parse(body);
  for (const event of payload.events ?? []) {
    const userId = event.source?.userId;
    if (!userId) continue;
    const settings = await load('settings');
    if (settings.lineUserId && settings.lineUserId !== userId) {
      if (event.replyToken) await reply(event.replyToken, '這個帳號已綁定給另一位使用者。');
      continue;
    }
    if (!settings.lineUserId) {
      await update('settings', (s) => {
        s.lineUserId = userId;
      });
    }
    if (event.type === 'follow') {
      await reply(event.replyToken, '綁定完成。之後直接傳文字給我就會記下來；晚上 9 點會傳對帳卡給你。');
      continue;
    }
    if (event.type !== 'message') continue;
    let answer;
    if (event.message.type === 'text') {
      try {
        answer = await handleText(event, event.message.text);
      } catch (err) {
        console.error(err);
        answer = '儲存失敗，請稍後再試。';
      }
    } else {
      answer = '目前只收文字。可以用手機鍵盤的語音輸入，轉成文字再傳。';
    }
    await reply(event.replyToken, answer);
  }
}

export async function sendNightlyCard() {
  const settings = await load('settings');
  if (!lineEnabled() || !settings.lineUserId) return 'skipped: LINE not linked';
  const msg = await reconcileMessage(today());
  if (!msg) return 'skipped: nothing to reconcile';
  await push(settings.lineUserId, msg.text);
  await update('settings', (s) => {
    s.lineCard = { day: today(), betIds: msg.betIds };
  });
  return 'sent';
}
