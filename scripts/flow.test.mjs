// End-to-end flow tests against local storage, a fake Anthropic API and a fake LINE API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dz-'));
process.env.LOCAL_DATA_DIR = dataDir;
process.env.APP_PIN = '4321';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.LINE_CHANNEL_SECRET = 'line-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';

const anthropicCalls = [];
const ENTRY_ANSWER = {
  summary: '早上準備水果商會議資料，下午整理短影音提案。',
  mood: '好',
  tasks: [
    { title: '準備水果商會議資料', estimate_min: 60, quote: '應該一個小時', category: '會議', due_date: null },
    { title: '整理短影音提案', estimate_min: 45, quote: '大概四十五分鐘', category: '提案企劃', due_date: null },
    { title: '回覆 AI 床墊品牌', estimate_min: null, quote: null, category: '對外聯繫', due_date: null },
  ],
  time_spent: [],
  observations: ['三件都是對外溝通，可能會卡在等對方回覆'],
};
let weeklyAnswer;

const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const parsed = JSON.parse(body);
  anthropicCalls.push({ url: req.url, headers: req.headers, body: parsed });
  const answer = parsed.system.includes('每週回顧') ? weeklyAnswer : ENTRY_ANSWER;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: parsed.model,
    content: [{ type: 'text', text: JSON.stringify(answer) }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
  }));
});

const linePushes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.line.me/')) {
    linePushes.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  }
  return realFetch(url, init);
};

let handleApi, handleWebhook, sendNightlyCard, verifySignature, parseReconcileReply, cookie;

before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  ({ handleApi } = await import('../lib/router.mjs'));
  ({ handleWebhook, sendNightlyCard, verifySignature, parseReconcileReply } = await import('../lib/line.mjs'));
});

after(async () => {
  fake.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function call(method, p, body) {
  const req = new Request(`https://example.test/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleApi(req, p.split('?')[0]);
  return { status: res.status, headers: res.headers, data: await res.json() };
}

test('login gate', async () => {
  assert.equal((await call('GET', '/dashboard')).status, 401);
  assert.equal((await call('POST', '/login', { pin: 'nope' })).status, 401);
  const ok = await call('POST', '/login', { pin: '4321' });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  assert.equal((await call('GET', '/dashboard')).status, 200);
});

test('entry is analyzed and suggestions become bets', async () => {
  const { data: entry } = await call('POST', '/entries', { text: '今天早上要先把水果商的會議資料弄好，應該一個小時…' });
  assert.equal(entry.analysis.summary, ENTRY_ANSWER.summary);
  assert.equal(entry.suggestions.length, 3);
  assert.equal(entry.suggestions[0].estimateMin, 60);
  assert.equal(entry.suggestions[2].estimateMin, null);

  const req = anthropicCalls.at(-1);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.output_config.effort, 'low');

  const picks = entry.suggestions.map((s) => ({ id: s.id }));
  picks[2].estimateMin = 20;
  const { data: bets } = await call('POST', `/entries/${entry.id}/accept`, { picks });
  assert.equal(bets.length, 3);
  assert.equal(bets[2].estimateMin, 20);
  const again = await call('POST', `/entries/${entry.id}/accept`, { picks });
  assert.equal(again.data.length, 0, 'suggestions are only accepted once');

  const obs = entry.analysis.observations[0];
  const fb = await call('POST', `/entries/${entry.id}/observations/${obs.id}`, { feedback: 'wrong', note: '床墊那邊是我主動回' });
  assert.equal(fb.data.feedback, 'wrong');
  await call('POST', '/entries', { text: '另一則' });
  assert.match(anthropicCalls.at(-1).body.messages[0].content, /床墊那邊是我主動回/, 'rejected observations are fed back');
});

test('LINE: signature, nightly card and numbered reply', async () => {
  const body = JSON.stringify({ events: [{ type: 'follow', replyToken: 'r0', source: { userId: 'U1' }, timestamp: Date.now() }] });
  const sig = createHmac('sha256', 'line-secret').update(body).digest('base64');
  assert.ok(verifySignature(body, sig));
  assert.ok(!verifySignature(body, 'bad'));
  await handleWebhook(body);

  assert.equal(await sendNightlyCard(), 'sent');
  const card = linePushes.find((p) => p.url.endsWith('/push'));
  assert.match(card.body.messages[0].text, /1 準備水果商會議資料/);

  await handleWebhook(JSON.stringify({ events: [{
    type: 'message', replyToken: 'r1', source: { userId: 'U1' }, timestamp: Date.now(),
    message: { type: 'text', text: '1 2 有做，3 沒做 被插隊' },
  }] }));
  const { data: rv } = await call('GET', '/reconcile');
  const byTitle = Object.fromEntries(rv.bets.map((b) => [b.title, b]));
  assert.equal(byTitle['準備水果商會議資料'].status, 'done');
  assert.equal(byTitle['整理短影音提案'].status, 'done');
  assert.equal(byTitle['回覆 AI 床墊品牌'].status, 'not_done');
  assert.equal(byTitle['回覆 AI 床墊品牌'].reason, '被插隊');
  assert.ok(rv.reconciledAt, 'reconcile finished once nothing is pending');

  // a stranger cannot write into this account
  await handleWebhook(JSON.stringify({ events: [{
    type: 'message', replyToken: 'r2', source: { userId: 'U2' }, timestamp: Date.now(), message: { type: 'text', text: 'hi' },
  }] }));
  assert.match(linePushes.at(-1).body.messages[0].text, /已綁定給另一位使用者/);
});

test('reply parser', () => {
  assert.deepEqual([...parseReconcileReply('全部有做', 2)].map(([n, r]) => [n, r.status]), [[1, 'done'], [2, 'done']]);
  const r = parseReconcileReply('1 有做、2 改期；3沒做 在等對方', 3);
  assert.equal(r.get(1).status, 'done');
  assert.equal(r.get(2).status, 'rescheduled');
  assert.equal(r.get(3).status, 'not_done');
  assert.equal(r.get(3).reason, '在等對方');
  const r2 = parseReconcileReply('1、2 有做 3 沒做 被插隊 4 做了', 4);
  assert.deepEqual([...r2].map(([n, x]) => [n, x.status, x.reason]), [
    [1, 'done', null], [2, 'done', null], [3, 'not_done', '被插隊'], [4, 'done', null],
  ]);
  assert.equal(parseReconcileReply('今天好累', 3).size, 0);
});

test('weekly review keeps only known bet ids, adjustment is verified next week', async () => {
  const { data: rv } = await call('GET', '/reconcile');
  weeklyAnswer = {
    patterns: [{ text: '提案類超時', tone: 'warn', bet_ids: [rv.bets[1].id, 'made-up-id'] }],
    data_gaps: ['10/26 沒有紀錄'],
    suggestion: { change: '提案改押早上', basis: '提案常超時', prediction_example: '超時不超過 30 分鐘' },
  };
  await call('PATCH', `/bets/${rv.bets[1].id}`, { actualMin: 120 });
  const { data: review } = await call('POST', '/weekly/generate', {});
  assert.deepEqual(review.patterns[0].betIds, [rv.bets[1].id]);
  const payload = JSON.parse(anthropicCalls.at(-1).body.messages[0].content);
  assert.equal(payload.bets.find((b) => b.id === rv.bets[1].id).actual_min, 120);

  const { data: w } = await call('GET', '/weekly');
  const { data: adj } = await call('POST', '/adjustments', { weekStart: w.weekStart, change: '提案改押早上', prediction: '超時不超過 30 分鐘' });
  const next = new Date(`${w.weekStart}T12:00:00+08:00`);
  next.setUTCDate(next.getUTCDate() + 7);
  const { data: nw } = await call('GET', `/weekly?week=${next.toISOString().slice(0, 10)}`);
  assert.equal(nw.toVerify.id, adj.id);
  const { data: v } = await call('POST', `/adjustments/${adj.id}/verify`, { actual: '做到了', decision: 'stop' });
  assert.equal(v.status, 'stopped');
});

test('wipe requires confirmation', async () => {
  assert.equal((await call('POST', '/wipe', { confirm: 'yes' })).status, 400);
  assert.equal((await call('POST', '/wipe', { confirm: '刪除全部' })).status, 200);
  assert.equal((await call('GET', '/reconcile')).data.bets.length, 0);
});
