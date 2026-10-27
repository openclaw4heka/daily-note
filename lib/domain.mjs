import { load, save, update } from './store.mjs';
import { analyzeEntry, weeklyReview, aiEnabled } from './ai.mjs';
import { id, today, dayOf, addDays, weekStart, isDay, str, intOrNull, HttpError, CATEGORIES, BET_STATUSES } from './util.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- entries ----------

async function rejectedObservations() {
  const entries = await load('entries');
  return entries
    .flatMap((e) => e.analysis?.observations ?? [])
    .filter((o) => o.feedback === 'wrong')
    .slice(-20)
    .map((o) => (o.note ? `${o.text}（使用者說：${o.note}）` : o.text));
}

function applyAnalysis(entry, a) {
  entry.analysis = {
    summary: a.summary,
    mood: a.mood,
    timeSpent: a.time_spent,
    observations: a.observations.slice(0, 2).map((text) => ({ id: id(), text, feedback: null, note: '' })),
  };
  entry.suggestions = a.tasks.map((t) => ({
    id: id(),
    title: t.title,
    estimateMin: intOrNull(t.estimate_min),
    quote: t.quote,
    category: CATEGORIES.includes(t.category) ? t.category : '其他',
    dueDate: isDay(t.due_date) ? t.due_date : null,
    betId: null,
  }));
  entry.aiError = null;
}

export async function runAnalysis(entry) {
  if (!aiEnabled()) return entry;
  try {
    const a = await analyzeEntry({ text: entry.text, day: entry.day, rejected: await rejectedObservations() });
    applyAnalysis(entry, a);
  } catch (err) {
    entry.aiError = err.message || 'AI 整理失敗';
  }
  return entry;
}

export async function createEntry({ text, source = 'web', occurredAt }) {
  text = str(text, 8000);
  if (!text) throw new HttpError(400, '內容是空的');
  const now = new Date();
  const occurred = occurredAt ? new Date(occurredAt) : now;
  if (Number.isNaN(occurred.getTime())) throw new HttpError(400, '時間格式錯誤');
  const entry = {
    id: id(),
    text,
    source,
    occurredAt: occurred.toISOString(),
    createdAt: now.toISOString(),
    day: dayOf(occurred),
    backfilled: now - occurred > DAY_MS,
    analysis: null,
    suggestions: [],
    aiError: null,
  };
  await runAnalysis(entry);
  await update('entries', (list) => list.push(entry));
  return entry;
}

export async function reanalyze(entryId) {
  const entries = await load('entries');
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) throw new HttpError(404, '找不到紀錄');
  const keep = entry.suggestions.filter((s) => s.betId);
  await runAnalysis(entry);
  entry.suggestions = [...keep, ...entry.suggestions.filter((s) => !keep.some((k) => k.title === s.title))];
  await save('entries', entries);
  return entry;
}

export async function editEntry(entryId, patch) {
  return update('entries', (list) => {
    const e = list.find((x) => x.id === entryId);
    if (!e) throw new HttpError(404, '找不到紀錄');
    if (patch.summary !== undefined && e.analysis) e.analysis.summary = str(patch.summary, 2000);
    if (patch.text !== undefined) e.text = str(patch.text, 8000) || e.text;
    return e;
  });
}

export async function deleteEntry(entryId) {
  await update('entries', (list) => {
    const i = list.findIndex((x) => x.id === entryId);
    if (i >= 0) list.splice(i, 1);
  });
}

export async function observationFeedback(entryId, obsId, { feedback, note }) {
  if (!['right', 'partial', 'wrong', null].includes(feedback)) throw new HttpError(400, 'feedback 錯誤');
  return update('entries', (list) => {
    const o = list.find((e) => e.id === entryId)?.analysis?.observations.find((x) => x.id === obsId);
    if (!o) throw new HttpError(404, '找不到觀察');
    o.feedback = feedback;
    if (note !== undefined) o.note = str(note, 500);
    return o;
  });
}

export async function entriesForDay(day) {
  const entries = await load('entries');
  return entries.filter((e) => e.day === day).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export async function searchEntries(q) {
  q = str(q, 100).toLowerCase();
  if (!q) return [];
  const entries = await load('entries');
  return entries
    .filter((e) => e.text.toLowerCase().includes(q) || e.analysis?.summary?.toLowerCase().includes(q))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 50);
}

// ---------- bets ----------

function newBet({ day, title, estimateMin, category, quote = null, entryId = null }) {
  title = str(title, 120);
  if (!title) throw new HttpError(400, '押注內容是空的');
  return {
    id: id(),
    day: isDay(day) ? day : today(),
    title,
    category: CATEGORIES.includes(category) ? category : '其他',
    estimateMin: intOrNull(estimateMin),
    actualMin: null,
    status: 'pending',
    reason: null,
    overrunCause: null,
    quote,
    entryId,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

export async function addBet(input) {
  const bet = newBet(input);
  await update('bets', (list) => list.push(bet));
  return bet;
}

// Turn AI suggestions from an entry into today's bets
export async function acceptSuggestions(entryId, picks) {
  const entries = await load('entries');
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) throw new HttpError(404, '找不到紀錄');
  const created = [];
  for (const pick of picks) {
    const s = entry.suggestions.find((x) => x.id === pick.id);
    if (!s || s.betId) continue;
    const bet = newBet({
      day: s.dueDate || entry.day,
      title: pick.title ?? s.title,
      estimateMin: pick.estimateMin !== undefined ? pick.estimateMin : s.estimateMin,
      category: pick.category ?? s.category,
      quote: s.quote,
      entryId: entry.id,
    });
    s.betId = bet.id;
    created.push(bet);
  }
  await update('bets', (list) => list.push(...created));
  await save('entries', entries);
  return created;
}

export async function patchBet(betId, patch) {
  return update('bets', (list) => {
    const b = list.find((x) => x.id === betId);
    if (!b) throw new HttpError(404, '找不到押注');
    if (patch.status !== undefined) {
      if (!BET_STATUSES.includes(patch.status)) throw new HttpError(400, 'status 錯誤');
      b.status = patch.status;
      b.resolvedAt = patch.status === 'pending' ? null : new Date().toISOString();
      if (patch.status !== 'not_done') b.reason = null;
    }
    if (patch.status === 'rescheduled' && isDay(patch.day)) {
      // a rescheduled bet becomes a fresh pending bet on the new day
      const copy = newBet({ ...b, day: patch.day });
      copy.quote = b.quote;
      copy.entryId = b.entryId;
      list.push(copy);
    }
    if (patch.title !== undefined) b.title = str(patch.title, 120) || b.title;
    if (patch.category !== undefined && CATEGORIES.includes(patch.category)) b.category = patch.category;
    if (patch.estimateMin !== undefined) b.estimateMin = intOrNull(patch.estimateMin);
    if (patch.actualMin !== undefined) b.actualMin = intOrNull(patch.actualMin);
    if (patch.reason !== undefined) b.reason = str(patch.reason, 200) || null;
    if (patch.overrunCause !== undefined) b.overrunCause = str(patch.overrunCause, 200) || null;
    return b;
  });
}

export async function deleteBet(betId) {
  await update('bets', (list) => {
    const i = list.findIndex((x) => x.id === betId);
    if (i >= 0) list.splice(i, 1);
  });
  await update('entries', (list) => {
    for (const e of list) for (const s of e.suggestions) if (s.betId === betId) s.betId = null;
  });
}

function overrun(b) {
  return b.estimateMin && b.actualMin != null ? b.actualMin - b.estimateMin : null;
}

export async function reconcileView(day = today()) {
  const bets = await load('bets');
  const settings = await load('settings');
  const todays = bets.filter((b) => b.day === day);
  const overdue = bets
    .filter((b) => b.day < day && b.status === 'pending')
    .sort((a, b) => a.day.localeCompare(b.day));
  const timed = todays.filter((b) => b.status === 'done' && b.estimateMin && b.actualMin != null);
  // One question a night: the largest meaningful overrun that has no cause yet
  const candidate = todays
    .filter((b) => overrun(b) >= Math.max(15, b.estimateMin * 0.25) && !b.overrunCause)
    .sort((a, b) => overrun(b) - overrun(a))[0];
  return {
    day,
    bets: todays,
    overdue,
    done: todays.filter((b) => b.status === 'done').length,
    estimateSum: timed.reduce((s, b) => s + b.estimateMin, 0),
    actualSum: timed.reduce((s, b) => s + b.actualMin, 0),
    untimed: todays.filter((b) => b.status === 'done' && !(b.estimateMin && b.actualMin != null)).length,
    question: candidate ? { betId: candidate.id, title: candidate.title, overrun: overrun(candidate) } : null,
    reconciledAt: settings.reconciled?.[day] ?? null,
  };
}

export async function finishReconcile(day = today()) {
  await update('settings', (s) => {
    s.reconciled ??= {};
    s.reconciled[day] = new Date().toISOString();
  });
}

// ---------- stats ----------

function deviation(bets) {
  const timed = bets.filter((b) => b.status === 'done' && b.estimateMin && b.actualMin != null);
  const est = timed.reduce((s, b) => s + b.estimateMin, 0);
  const act = timed.reduce((s, b) => s + b.actualMin, 0);
  return est ? { pct: Math.round((act / est - 1) * 100), n: timed.length } : { pct: null, n: 0 };
}

function inWeek(day, ws) {
  return day >= ws && day <= addDays(ws, 6);
}

export async function dashboard(day = today()) {
  const [entries, bets, settings, adjustments, outcomes] = await Promise.all([
    load('entries'), load('bets'), load('settings'), load('adjustments'), load('outcomes'),
  ]);
  const ws = weekStart(day);
  const weekBets = bets.filter((b) => inWeek(b.day, ws) && b.day <= day);
  const lastWeekBets = bets.filter((b) => inWeek(b.day, addDays(ws, -7)));
  const footprint = [];
  for (let i = 27; i >= 0; i--) {
    const d = addDays(day, -i);
    const dayEntries = entries.filter((e) => e.day === d);
    footprint.push({
      day: d,
      recorded: dayEntries.length > 0,
      backfilled: dayEntries.length > 0 && dayEntries.every((e) => e.backfilled),
      reconciled: Boolean(settings.reconciled?.[d]),
    });
  }
  const timeByCategory = {};
  for (const b of weekBets) {
    if (b.status === 'done' && b.actualMin != null) timeByCategory[b.category] = (timeByCategory[b.category] || 0) + b.actualMin;
  }
  const rv = await reconcileView(day);
  return {
    day,
    todayEntries: entries.filter((e) => e.day === day).length,
    todayBets: rv.bets,
    week: { start: ws, total: weekBets.length, done: weekBets.filter((b) => b.status === 'done').length },
    pendingReconcile: rv.bets.filter((b) => b.status === 'pending').length + rv.overdue.length,
    overdue: rv.overdue.length,
    deviation: deviation(weekBets),
    lastDeviation: deviation(lastWeekBets),
    footprint,
    timeByCategory,
    activeAdjustment: adjustments.find((a) => a.status === 'active') ?? null,
    outcomesThisMonth: outcomes.filter((o) => o.day.slice(0, 7) === day.slice(0, 7)).length,
  };
}

// ---------- weekly ----------

async function weekFacts(ws) {
  const [entries, bets, settings] = await Promise.all([load('entries'), load('bets'), load('settings')]);
  const end = addDays(ws, 6);
  const weekBets = bets.filter((b) => inWeek(b.day, ws));
  const weekEntries = entries.filter((e) => inWeek(e.day, ws));
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => d <= today());
  const outcomes = (await load('outcomes')).filter((o) => inWeek(o.day, ws));
  return {
    weekStart: ws,
    weekEnd: end,
    bets: weekBets,
    entries: weekEntries,
    total: weekBets.length,
    done: weekBets.filter((b) => b.status === 'done').length,
    pending: weekBets.filter((b) => b.status === 'pending').length,
    reconciledDays: days.filter((d) => settings.reconciled?.[d]).length,
    elapsedDays: days.length,
    entryDays: new Set(weekEntries.map((e) => e.day)).size,
    missingDays: days.filter((d) => !weekEntries.some((e) => e.day === d)),
    untimed: weekBets.filter((b) => !b.estimateMin).length,
    deviation: deviation(weekBets),
    outcomes: outcomes.length,
  };
}

export async function weeklyView(ws) {
  if (!isDay(ws)) ws = weekStart(today());
  ws = weekStart(ws);
  const [facts, reviews, adjustments] = await Promise.all([weekFacts(ws), load('reviews'), load('adjustments')]);
  return {
    ...facts,
    entries: undefined,
    review: reviews[ws] ?? null,
    toVerify: adjustments.find((a) => a.verifyWeek === ws) ?? null,
    planned: adjustments.find((a) => a.weekStart === ws) ?? null,
    aiEnabled: aiEnabled(),
  };
}

export async function generateWeekly(ws) {
  ws = weekStart(isDay(ws) ? ws : today());
  if (!aiEnabled()) throw new HttpError(400, '尚未設定 ANTHROPIC_API_KEY，無法產生 AI 回顧');
  const [facts, reviews, adjustments] = await Promise.all([weekFacts(ws), load('reviews'), load('adjustments')]);
  const rejected = Object.values(reviews)
    .flatMap((r) => r.patterns)
    .filter((p) => p.feedback === 'wrong')
    .map((p) => (p.note ? `${p.text}（使用者說：${p.note}）` : p.text));
  const toVerify = adjustments.find((a) => a.verifyWeek === ws);
  const out = await weeklyReview({
    week: `${facts.weekStart} ~ ${facts.weekEnd}`,
    bets: facts.bets.map((b) => ({
      id: b.id, day: b.day, title: b.title, category: b.category, status: b.status,
      estimate_min: b.estimateMin, actual_min: b.actualMin, not_done_reason: b.reason, overrun_cause: b.overrunCause,
    })),
    entry_summaries: facts.entries.map((e) => ({ day: e.day, summary: e.analysis?.summary ?? e.text.slice(0, 200) })),
    days_without_entries: facts.missingDays,
    last_week_adjustment: toVerify ? { change: toVerify.change, prediction: toVerify.prediction } : null,
    rejected_patterns: rejected,
  });
  const betIds = new Set(facts.bets.map((b) => b.id));
  const review = {
    generatedAt: new Date().toISOString(),
    patterns: out.patterns.slice(0, 4).map((p) => ({
      id: id(), text: p.text, tone: p.tone, betIds: p.bet_ids.filter((x) => betIds.has(x)), feedback: null, note: '',
    })),
    dataGaps: out.data_gaps,
    suggestion: out.suggestion,
  };
  await update('reviews', (r) => {
    r[ws] = review;
  });
  return review;
}

export async function patternFeedback(ws, patternId, { feedback, note }) {
  if (!['right', 'partial', 'wrong', null].includes(feedback)) throw new HttpError(400, 'feedback 錯誤');
  return update('reviews', (r) => {
    const p = r[ws]?.patterns.find((x) => x.id === patternId);
    if (!p) throw new HttpError(404, '找不到這條模式');
    p.feedback = feedback;
    if (note !== undefined) p.note = str(note, 500);
    return p;
  });
}

// ---------- adjustments ----------

export async function createAdjustment({ weekStart: ws, change, basis, prediction }) {
  ws = weekStart(isDay(ws) ? ws : today());
  change = str(change, 300);
  prediction = str(prediction, 300);
  if (!change || !prediction) throw new HttpError(400, '請填寫要改的事與你的預測');
  return update('adjustments', (list) => {
    for (const a of list) if (a.status === 'active') a.status = 'replaced';
    const adj = {
      id: id(), weekStart: ws, verifyWeek: addDays(ws, 7), change, basis: str(basis, 300), prediction,
      status: 'active', actual: null, verdict: null, createdAt: new Date().toISOString(),
    };
    const old = list.findIndex((a) => a.weekStart === ws);
    if (old >= 0) list.splice(old, 1);
    list.push(adj);
    return adj;
  });
}

export async function verifyAdjustment(adjId, { actual, decision }) {
  if (!['continue', 'modify', 'stop'].includes(decision)) throw new HttpError(400, 'decision 錯誤');
  return update('adjustments', (list) => {
    const a = list.find((x) => x.id === adjId);
    if (!a) throw new HttpError(404, '找不到調整');
    a.actual = str(actual, 300) || a.actual;
    a.verdict = decision;
    a.status = decision === 'continue' ? 'active' : decision === 'stop' ? 'stopped' : 'modified';
    if (decision === 'continue') a.verifyWeek = addDays(a.verifyWeek, 7);
    return a;
  });
}

// ---------- outcomes & trail ----------

export async function createOutcome({ day, title, entryIds = [], betIds = [] }) {
  title = str(title, 200);
  if (!title) throw new HttpError(400, '請填寫結果');
  const o = {
    id: id(), day: isDay(day) ? day : today(), title,
    entryIds: entryIds.filter((x) => typeof x === 'string').slice(0, 30),
    betIds: betIds.filter((x) => typeof x === 'string').slice(0, 30),
    createdAt: new Date().toISOString(),
  };
  await update('outcomes', (list) => list.push(o));
  return o;
}

export async function patchOutcome(oid, patch) {
  return update('outcomes', (list) => {
    const o = list.find((x) => x.id === oid);
    if (!o) throw new HttpError(404, '找不到結果');
    if (patch.title !== undefined) o.title = str(patch.title, 200) || o.title;
    if (isDay(patch.day)) o.day = patch.day;
    if (Array.isArray(patch.entryIds)) o.entryIds = patch.entryIds.filter((x) => typeof x === 'string').slice(0, 30);
    if (Array.isArray(patch.betIds)) o.betIds = patch.betIds.filter((x) => typeof x === 'string').slice(0, 30);
    return o;
  });
}

export async function deleteOutcome(oid) {
  await update('outcomes', (list) => {
    const i = list.findIndex((x) => x.id === oid);
    if (i >= 0) list.splice(i, 1);
  });
}

export async function trail(day = today()) {
  const [entries, bets, outcomes] = await Promise.all([load('entries'), load('bets'), load('outcomes')]);
  const ws = weekStart(day);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const w = addDays(ws, -7 * i);
    weeks.push({ weekStart: w, ...deviation(bets.filter((b) => inWeek(b.day, w))) });
  }
  const recent = bets.filter((b) => b.day >= addDays(ws, -21));
  const byCategory = CATEGORIES.map((c) => ({ category: c, ...deviation(recent.filter((b) => b.category === c)) })).filter((x) => x.n > 0);
  const list = outcomes
    .slice()
    .sort((a, b) => b.day.localeCompare(a.day))
    .map((o) => {
      const linked = [
        ...o.entryIds.map((eid) => entries.find((e) => e.id === eid)).filter(Boolean).map((e) => ({
          kind: 'entry', id: e.id, day: e.day, text: e.analysis?.summary || e.text, backfilled: e.backfilled,
          createdDay: dayOf(new Date(e.createdAt)),
        })),
        ...o.betIds.map((bid) => bets.find((b) => b.id === bid)).filter(Boolean).map((b) => ({
          kind: 'bet', id: b.id, day: b.day, text: b.title, status: b.status,
        })),
      ].sort((a, b) => a.day.localeCompare(b.day));
      const first = linked[0]?.day;
      const span = first ? Math.round((new Date(`${o.day}T12:00:00+08:00`) - new Date(`${first}T12:00:00+08:00`)) / DAY_MS) : null;
      return { ...o, linked, span };
    });
  return { weeks, byCategory, outcomes: list };
}

// Candidates for linking an outcome: recent entries and bets
export async function linkCandidates(q = '') {
  const [entries, bets] = await Promise.all([load('entries'), load('bets')]);
  q = str(q, 100).toLowerCase();
  const match = (s) => !q || (s || '').toLowerCase().includes(q);
  return {
    entries: entries.filter((e) => match(e.text) || match(e.analysis?.summary))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 30)
      .map((e) => ({ id: e.id, day: e.day, text: e.analysis?.summary || e.text.slice(0, 120) })),
    bets: bets.filter((b) => match(b.title)).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30)
      .map((b) => ({ id: b.id, day: b.day, text: b.title, status: b.status })),
  };
}
