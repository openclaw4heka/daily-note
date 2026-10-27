// 對帳 — single-page app, no build step.
const $app = document.getElementById('app');
const S = { me: null, settings: null, data: null, ui: {} };

// ---------- helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (day) => (day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : '');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const longDay = (day) => {
  const d = new Date(`${day}T12:00:00+08:00`);
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日 · 週${WEEK[d.getUTCDay()]}`;
};
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const timeOf = (iso) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const mins = (m) => (m == null ? '—' : m >= 120 && m % 60 === 0 ? `${m / 60}h` : `${m}′`);
const pct = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p}%`);
const CATEGORIES = ['提案企劃', '會議', '對外聯繫', '行政雜事', '生活', '其他'];
const STATUS = { pending: '待對帳', done: '有做', not_done: '沒做', rescheduled: '改期', dropped: '不用做了' };
const REASONS = ['時間不夠', '被別的事插隊', '改了優先順序', '在等對方'];
const CAUSES = ['想方向／卡在內容', '等資料或等對方', '被打斷', '份量低估了'];

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    S.me = { authed: false };
    render();
    throw new Error(data.error || '請先登入');
  }
  if (!res.ok) throw new Error(data.error || `錯誤 ${res.status}`);
  return data;
}

function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { path, q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

const ICONS = {
  home: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
};
const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

// ---------- shell ----------
function shell(active, body) {
  const nav = (href, key, label, ic, extra = '') =>
    `<a href="#${href}" class="${active === key ? 'on' : ''}" ${active === key ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${extra}</a>`;
  const pending = S.ui.pendingCount ? `<span class="badge">${S.ui.pendingCount}</span>` : '';
  return `<div class="shell ${S.ui.menuOpen ? 'open' : ''}">
    <aside class="side">
      <a class="brand" href="#/"><span class="brand-mark">帳</span><span><div class="brand-name">對帳</div><div class="brand-sub">押注 · 對帳 · 驗證</div></span></a>
      <nav class="nav" aria-label="主選單">
        <div class="nav-label">每天</div>
        ${nav('/', 'home', '總覽', 'home')}
        ${nav('/journal', 'journal', '每日紀錄', 'mic')}
        ${nav('/reconcile', 'reconcile', '今晚對帳', 'scale', pending)}
        <div class="nav-label">每週</div>
        ${nav('/weekly', 'weekly', '每週回顧', 'cal')}
        ${nav('/trail', 'trail', '結果軌跡', 'trend')}
      </nav>
      <div class="side-foot">先押注，再對帳。<br>每週只改一件事。</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" data-act="menu" aria-label="開啟選單">${icon('menu', 18)}</button>
        <form data-form="search" role="search"><label class="sr" for="gq">搜尋紀錄</label><input id="gq" name="q" type="search" placeholder="搜尋紀錄內容…" value="${esc(route().path === '/journal' ? route().q.q || '' : '')}"></form>
        <div class="top-right">
          <span class="line-status">${S.settings?.lineLinked ? 'LINE 已連結' : S.settings?.line ? 'LINE 待綁定' : ''}</span>
          <a class="icon-btn" href="#/settings" aria-label="設定">${icon('user', 18)}</a>
        </div>
      </header>
      <main class="content">${body}</main>
    </div>
  </div>`;
}

function loginView(err = '') {
  return `<div class="login"><form class="card" data-form="login">
    <div style="display:flex;align-items:center;gap:12px"><span class="brand-mark">帳</span><div><div class="brand-name">對帳</div><div class="brand-sub">押注 · 對帳 · 驗證</div></div></div>
    <label class="field">PIN<input class="input" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required autofocus></label>
    ${err ? `<div class="chip warn">${esc(err)}</div>` : ''}
    <button class="btn primary lg" type="submit">進入</button>
  </form></div>`;
}

// ---------- pages ----------
const pages = {};

pages['/'] = {
  key: 'home',
  load: () => api('GET', '/dashboard'),
  view(d) {
    const last = d.lastDeviation.pct != null ? `上週 ${pct(d.lastDeviation.pct)}` : '上週沒有可比較的資料';
    const totalCat = Object.values(d.timeByCategory).reduce((a, b) => a + b, 0) || 1;
    const cats = Object.entries(d.timeByCategory).sort((a, b) => b[1] - a[1]);
    const foot = d.footprint.map((f, i) => {
      const cls = [f.recorded && 'rec', f.reconciled && 'rcn', f.backfilled && 'bf', i === d.footprint.length - 1 && 'today'].filter(Boolean).join(' ');
      return `<span class="${cls}" title="${f.day}">${Number(f.day.slice(8))}</span>`;
    }).join('');
    const adj = d.activeAdjustment;
    return `
    <div><div class="eyebrow">${longDay(d.day)}</div><h1>總覽</h1>
      <p class="lede">${!d.todayBets.length ? '今天還沒押注。在 LINE 或「每日紀錄」說說今天要做什麼。'
        : d.todayBets.some((b) => b.status === 'pending') ? `今天押了 ${d.todayBets.length} 件事，晚上 9 點對帳。`
        : `今天押的 ${d.todayBets.length} 件事都對完帳了，做到 ${d.todayBets.filter((b) => b.status === 'done').length} 件。`}</p></div>
    <div class="grid g4">
      <div class="card stat"><div class="muted">今天的紀錄</div><div class="num">${d.todayEntries} <small>則</small></div></div>
      <div class="card stat"><div class="muted">本週押注有做</div><div class="num">${d.week.done}<small> / ${d.week.total}</small></div><div class="muted">${d.week.total ? `說到做到 ${Math.round((d.week.done / d.week.total) * 100)}%` : '本週還沒有押注'}</div></div>
      <a class="card soft stat" href="#/reconcile"><div class="muted" style="color:var(--hi)">待對帳</div><div class="num">${d.pendingReconcile} <small>件</small></div><div class="muted" style="color:var(--hi)">${d.overdue ? `含過期未確認 ${d.overdue} 件 →` : '去對帳 →'}</div></a>
      <div class="card stat"><div class="muted">本週預估偏差</div><div class="num">${pct(d.deviation.pct)}</div><div class="muted">${d.deviation.n ? `實際比預估多花（${d.deviation.n} 件）· ${last}` : '有填預估和實際時間才會計算'}</div></div>
    </div>
    <div class="grid g-wide">
      <section class="card">
        <div class="card-head"><h2>今天的押注</h2><a class="btn sm" href="#/journal">＋ 新增</a></div>
        <div class="list">${d.todayBets.length ? d.todayBets.map((b) => `
          <div class="row"><span class="grow">${esc(b.title)}</span>
          ${b.status === 'pending' ? (b.estimateMin ? `<span class="chip">預估 ${mins(b.estimateMin)}</span>` : '<span class="chip warn">時間未填</span>') : `<span class="chip ${b.status === 'done' ? 'good' : ''}">${STATUS[b.status]}</span>`}</div>`).join('')
          : '<div class="empty-state">還沒有押注</div>'}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>紀錄足跡</h2><span class="muted">近 4 週</span></div>
        <div class="foot">${foot}</div>
        <p class="muted" style="margin:12px 0 0">底色＝有紀錄 · 外框＝有對帳 · 虛線＝補記</p>
      </section>
    </div>
    <div class="grid g-wide">
      ${adj ? `<section class="card soft"><div class="eyebrow" style="letter-spacing:0;font-size:12px">本週進行中的調整 · ${md(adj.verifyWeek)} 那週驗證</div>
        <div class="serif" style="font-size:20px;font-weight:700;margin:8px 0 12px">${esc(adj.change)}</div>
        <div class="mini" style="background:var(--card)"><div class="muted">你預測</div><div>${esc(adj.prediction)}</div></div></section>`
      : `<section class="card"><h2>本週調整</h2><p class="muted">還沒有。每週回顧時選一件下週要改的事。</p><a class="btn sm" href="#/weekly">去每週回顧</a></section>`}
      <section class="card"><div class="card-head"><h2>本週時間花在哪</h2><span class="muted">只算有填實際時間的</span></div>
        ${cats.length ? `<div class="bars" style="grid-template-columns:72px minmax(0,1fr) 48px">${cats.map(([c, m]) => `<span>${esc(c)}</span><div class="track"><i class="acc" style="width:${Math.round((m / totalCat) * 100)}%"></i></div><span style="text-align:right">${(m / 60).toFixed(1)}h</span>`).join('')}</div>` : '<div class="empty-state">對帳時填上實際時間，這裡就會出現</div>'}
      </section>
    </div>`;
  },
};

pages['/journal'] = {
  key: 'journal',
  async load(q) {
    if (q.q) return { search: q.q, entries: await api('GET', `/entries?q=${encodeURIComponent(q.q)}`) };
    const day = q.day || S.me.today;
    const [entries, rv] = await Promise.all([api('GET', `/entries?day=${day}`), api('GET', `/reconcile?day=${day}`)]);
    return { day, entries, bets: rv.bets };
  },
  view(d) {
    if (d.search) {
      return `<div class="page-head"><div><div class="eyebrow">搜尋</div><h1>「${esc(d.search)}」</h1><p class="lede">找到 ${d.entries.length} 則紀錄</p></div><a class="btn" href="#/journal">回今天</a></div>
      ${d.entries.map((e) => entryCard(e, true)).join('') || '<div class="card empty-state">沒有符合的紀錄</div>'}`;
    }
    const isToday = d.day === S.me.today;
    return `
    <div class="page-head">
      <div><div class="eyebrow">${longDay(d.day)}</div><h1>每日紀錄</h1><p class="lede">在 LINE 講出來就好，這裡幫你整理、抓出要做的事。</p></div>
      <div class="btns" style="align-items:center">
        <a class="btn" href="#/journal?day=${addDays(d.day, -1)}" aria-label="前一天">‹</a>
        <label class="sr" for="jday">日期</label><input id="jday" class="input" type="date" value="${d.day}" max="${S.me.today}" data-change="jday" style="width:auto">
        ${isToday ? '' : `<a class="btn" href="#/journal?day=${addDays(d.day, 1)}" aria-label="後一天">›</a>`}
      </div>
    </div>
    <form class="card" data-form="entry" style="display:flex;flex-direction:column;gap:12px">
      <label class="field">${isToday ? '現在想記什麼？今天要做什麼、做了什麼、卡在哪都可以' : `補記 ${md(d.day)} 的事（會標示為補記）`}
        <textarea class="input" name="text" required placeholder="例：早上先把會議資料弄好，應該一個小時，下午整理提案，大概四十五分鐘…"></textarea></label>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="muted">${S.settings.ai ? 'AI 會整理摘要並抓出要做的事' : '尚未設定 AI，只會儲存原文'}</span>
        <button class="btn primary" type="submit">儲存紀錄</button>
      </div>
    </form>
    ${d.entries.length ? d.entries.map((e) => entryCard(e)).join('') : '<div class="card empty-state">這一天還沒有紀錄</div>'}
    <section class="card"><div class="card-head"><h2>這天的押注 · ${d.bets.length} 件</h2><a class="btn sm" href="#/reconcile${isToday ? '' : `?day=${d.day}`}">去對帳</a></div>
      <div class="list">${d.bets.map((b) => `<div class="row"><span class="grow">${esc(b.title)}</span><span class="chip">${esc(b.category)}</span>
        <span class="chip ${b.status === 'done' ? 'good' : ''}">${b.status === 'pending' ? (b.estimateMin ? `預估 ${mins(b.estimateMin)}` : '時間未填') : STATUS[b.status]}</span>
        <button class="btn sm ghost" data-act="del-bet" data-id="${b.id}" aria-label="刪除押注 ${esc(b.title)}">刪除</button></div>`).join('') || '<div class="empty-state">還沒有押注。從紀錄抓出來，或在下面手動新增。</div>'}</div>
    <details ${S.ui.betOpen ? 'open' : ''} data-toggle="bet" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px"><summary style="cursor:pointer;font-weight:700">手動新增押注</summary>
      <form data-form="bet" class="grid" style="grid-template-columns:minmax(0,1fr) 110px 130px auto;align-items:end;margin-top:14px;gap:10px">
        <label class="field">要做的事<input class="input" name="title" required></label>
        <label class="field">預估分鐘<input class="input" name="estimateMin" type="number" min="0" inputmode="numeric"></label>
        <label class="field">類別<select class="input" name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
        <input type="hidden" name="day" value="${d.day}"><button class="btn primary" type="submit">加入</button>
      </form></details></section>`;
  },
};

function entryCard(e, showDay = false) {
  const a = e.analysis;
  const open = e.suggestions.filter((s) => !s.betId);
  const taken = e.suggestions.filter((s) => s.betId);
  const fb = (o, v, label) => `<button class="btn sm ${o.feedback === v ? 'primary' : ''}" data-act="obs" data-entry="${e.id}" data-obs="${o.id}" data-v="${v}" aria-pressed="${o.feedback === v}">${label}</button>`;
  return `<article class="card entry">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="serif" style="font-size:16px;font-weight:700">${showDay ? `${md(e.day)} ` : ''}${timeOf(e.occurredAt)}</span>
      <span class="chip line">${e.source === 'line' ? 'LINE' : '網頁'}</span>
      ${e.backfilled ? `<span class="chip warn">補記 · ${md(e.createdAt.slice(0, 10))} 才記</span>` : ''}
      ${a?.mood && a.mood !== '未提及' ? `<span class="chip">狀態：${esc(a.mood)}</span>` : ''}
      <button class="btn sm ghost" style="margin-left:auto" data-act="del-entry" data-id="${e.id}">刪除</button>
    </div>
    <p class="entry-text">${esc(e.text)}</p>
    ${a ? `<div class="summary"><span class="muted">摘要　</span>${esc(a.summary)}</div>` : ''}
    ${e.aiError ? `<div class="chip warn">AI 整理失敗：${esc(e.aiError)}</div>` : ''}
    ${open.length ? `<form class="card soft" data-form="accept" data-entry="${e.id}" style="padding:16px 18px">
      <div class="card-head"><div class="serif" style="font-weight:700;color:var(--hi)">抓到 ${open.length} 件要做的事</div><span class="muted">勾選的會成為押注，晚上對帳</span></div>
      ${open.map((s) => `<div class="sugg">
        <input type="checkbox" name="pick" value="${s.id}" checked aria-label="選取 ${esc(s.title)}">
        <input class="input" name="title_${s.id}" value="${esc(s.title)}" aria-label="押注內容">
        <span class="muted quote">${s.quote ? `你說「${esc(s.quote)}」` : '沒提到時間'}${s.dueDate ? ` · ${md(s.dueDate)}` : ''}</span>
        <input class="input" name="est_${s.id}" type="number" min="0" inputmode="numeric" placeholder="預估分" value="${s.estimateMin ?? ''}" aria-label="預估分鐘">
      </div>`).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px">
        <span class="muted">沒填時間也行，只是晚上不比時間差</span><button class="btn primary" type="submit">設為押注</button>
      </div></form>` : ''}
    ${taken.length ? `<div class="muted">已設為押注：${taken.map((s) => esc(s.title)).join('、')}</div>` : ''}
    ${a?.observations?.length ? `<div style="display:flex;flex-direction:column;gap:10px">
      <div class="muted">AI 的觀察 · 按「不對」的之後不再使用</div>
      ${a.observations.map((o) => `<div class="obs"><span>${esc(o.text)}</span><span class="btns" style="flex:none">${fb(o, 'right', '對')}${fb(o, 'partial', '部分對')}${fb(o, 'wrong', '不對')}</span></div>
        ${o.feedback === 'wrong' ? `<form data-form="obs-note" data-entry="${e.id}" data-obs="${o.id}" style="display:flex;gap:8px"><label class="sr" for="n_${o.id}">補充原因</label><input id="n_${o.id}" class="input" name="note" value="${esc(o.note)}" placeholder="補充：哪裡不對？（選填）"><button class="btn sm" type="submit">存</button></form>` : ''}`).join('')}
    </div>` : ''}
    ${S.settings.ai ? `<div style="display:flex;justify-content:flex-end"><button class="btn sm" data-act="reanalyze" data-id="${e.id}">AI 重新整理</button></div>` : ''}
  </article>`;
}

pages['/reconcile'] = {
  key: 'reconcile',
  load: (q) => api('GET', `/reconcile?day=${q.day || S.me.today}`),
  view(d) {
    const isToday = d.day === S.me.today;
    const max = Math.max(1, ...d.bets.map((b) => Math.max(b.estimateMin || 0, b.actualMin || 0)));
    const betRow = (b) => {
      const over = b.estimateMin && b.actualMin != null ? b.actualMin - b.estimateMin : null;
      const st = (s, label, cls) => `<button class="btn sm ${b.status === s ? cls : ''}" data-act="bet-status" data-id="${b.id}" data-s="${s}" aria-pressed="${b.status === s}">${label}</button>`;
      return `<div class="row" style="flex-direction:column;align-items:stretch;gap:12px;padding:18px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:15px">${esc(b.title)} <span class="chip">${esc(b.category)}</span></span>
          <div class="btns">${st('done', '有做', 'good')}${st('not_done', '沒做', 'dark')}${st('rescheduled', '改期', 'dark')}</div>
        </div>
        ${b.status === 'done' ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label class="field" style="flex-direction:row;align-items:center;gap:8px">實際花了<input class="input num" type="number" min="0" inputmode="numeric" value="${b.actualMin ?? ''}" data-change="actual" data-id="${b.id}">分鐘</label>
          ${b.estimateMin ? '' : `<label class="field" style="flex-direction:row;align-items:center;gap:8px">預估<input class="input num" type="number" min="0" inputmode="numeric" placeholder="補填" data-change="estimate" data-id="${b.id}">分</label>`}
        </div>` : ''}
        ${b.estimateMin || b.actualMin != null ? `<div class="bars">
          <span>預估</span><div class="track"><i style="width:${((b.estimateMin || 0) / max) * 100}%"></i></div><span style="text-align:right">${mins(b.estimateMin)}</span>
          <span>實際</span><div class="track"><i class="${over > 0 ? 'warn' : 'good'}" style="width:${((b.actualMin || 0) / max) * 100}%"></i></div><span style="text-align:right;color:${over > 0 ? 'var(--warn)' : 'var(--text)'}">${mins(b.actualMin)}</span>
        </div>` : ''}
        ${over > 0 ? `<div class="small" style="color:var(--warn)">比預估多 ${over} 分鐘${b.overrunCause ? ` · 原因：${esc(b.overrunCause)}` : ''}</div>` : ''}
        ${b.status === 'not_done' ? `<div class="btns" style="align-items:center"><span class="muted">為什麼？</span>${REASONS.map((r) => `<button class="pill ${b.reason === r ? 'on' : ''}" data-act="reason" data-id="${b.id}" data-r="${r}">${r}</button>`).join('')}</div>` : ''}
      </div>`;
    };
    const ovRow = (b) => `<div class="row"><div class="grow"><div>${esc(b.title)}</div><div class="muted">原定 ${md(b.day)}</div></div>
      <div class="btns"><button class="btn sm" data-act="bet-status" data-id="${b.id}" data-s="done">有做</button><button class="btn sm" data-act="bet-status" data-id="${b.id}" data-s="not_done">沒做</button><button class="btn sm" data-act="bet-status" data-id="${b.id}" data-s="dropped">不用做了</button></div></div>`;
    const q = d.question;
    return `
    <div class="page-head"><div><div class="eyebrow">${longDay(d.day)}</div><h1>${isToday ? '今晚對帳' : `${md(d.day)} 對帳`}</h1><p class="lede">不打分數，只是讓今天跟早上的自己對一下。</p></div>
      <div class="btns"><a class="btn" href="#/reconcile?day=${addDays(d.day, -1)}" aria-label="前一天">‹</a>${isToday ? '' : `<a class="btn" href="#/reconcile">回今天</a>`}</div></div>
    <div class="cols"><div class="col-main">
      <section class="card"><div class="card-head"><h2>押注 · ${d.bets.length} 件</h2><a class="btn sm" href="#/journal?day=${d.day}">＋ 新增</a></div>
        <div class="list">${d.bets.length ? d.bets.map(betRow).join('') : '<div class="empty-state">這天沒有押注。早上在 LINE 說說今天要做什麼，或到「每日紀錄」新增。</div>'}</div></section>
      ${d.overdue.length ? `<section class="card"><div class="card-head"><h2>過期還沒確認 · ${d.overdue.length} 件</h2><button class="btn sm" data-act="all-done">全部標為有做</button></div>
        <p class="muted" style="margin:0 0 6px">不是你沒做，是系統還不知道。點一下就好。</p><div class="list">${d.overdue.map(ovRow).join('')}</div></section>` : ''}
    </div><div class="col-side">
      <section class="card"><h2 style="margin-bottom:12px">這天的帳</h2>
        <div class="grid g2" style="gap:10px"><div class="mini"><div class="muted">押注有做</div><div class="num">${d.done} <small>/ ${d.bets.length}</small></div></div>
        <div class="mini"><div class="muted">時間（實際／預估）</div><div class="num">${d.actualSum ? `${d.actualSum}′` : '—'} <small>/ ${d.estimateSum ? `${d.estimateSum}′` : '—'}</small></div></div></div>
        ${d.untimed ? `<p class="muted" style="margin:10px 0 0">${d.untimed} 件沒有完整的預估與實際時間，不列入計算。</p>` : ''}</section>
      ${q ? `<section class="card soft"><div class="muted" style="color:var(--hi)">今晚只問一題</div>
        <p style="margin:8px 0 12px">「${esc(q.title)}」多花了 ${q.overrun} 分鐘，主要是因為？</p>
        <div class="btns">${CAUSES.map((c) => `<button class="pill" data-act="cause" data-id="${q.betId}" data-c="${c}">${c}</button>`).join('')}</div></section>` : ''}
      ${S.settings.lineLinked ? `<section class="card"><div class="muted">在 LINE 回也可以</div><p class="small" style="margin:6px 0 0;color:var(--sub)">每晚 9 點會收到對帳卡，回「1 2 有做，3 沒做 被插隊」就好。</p></section>` : ''}
      <button class="btn primary lg" data-act="finish" data-day="${d.day}">${d.reconciledAt ? '已完成對帳 ✓（再存一次）' : '完成對帳'}</button>
    </div></div>`;
  },
};

pages['/weekly'] = {
  key: 'weekly',
  load: (q) => api('GET', `/weekly${q.week ? `?week=${q.week}` : ''}`),
  view(d) {
    const v = d.toVerify;
    const r = d.review;
    const isCurrent = d.weekStart <= S.me.today && S.me.today <= d.weekEnd;
    const fb = (p, val, label) => `<button class="btn sm ${p.feedback === val ? 'primary' : ''}" data-act="pattern" data-week="${d.weekStart}" data-p="${p.id}" data-v="${val}" aria-pressed="${p.feedback === val}">${label}</button>`;
    const tone = { warn: 'var(--warn)', good: 'var(--good)', neutral: 'var(--bar)' };
    return `
    <div class="page-head"><div><div class="eyebrow">${md(d.weekStart)} – ${md(d.weekEnd)}</div><h1>每週回顧</h1><p class="lede">先對上週的預測，再選下週只改的一件事。</p></div>
      <div class="btns"><a class="btn" href="#/weekly?week=${addDays(d.weekStart, -7)}" aria-label="上一週">‹</a>${isCurrent ? '' : `<a class="btn" href="#/weekly?week=${addDays(d.weekStart, 7)}" aria-label="下一週">›</a>`}</div></div>

    <section class="card">
      <div class="eyebrow" style="letter-spacing:0">① 上週的調整 · 驗證</div>
      ${v ? `<div class="serif" style="font-size:18px;font-weight:700;margin:8px 0 12px">${esc(v.change)}</div>
        <div class="grid g2" style="gap:12px"><div class="mini"><div class="muted">你預測</div><div>${esc(v.prediction)}</div></div>
        <form data-form="verify" data-id="${v.id}" class="mini" style="display:flex;flex-direction:column;gap:8px"><label class="field">實際如何？<input class="input" name="actual" value="${esc(v.actual || '')}" placeholder="例：做到 2 次，平均 45 分鐘"></label>
          <div class="btns"><button class="btn sm good" name="d" value="continue">繼續做</button><button class="btn sm" name="d" value="modify">修改</button><button class="btn sm" name="d" value="stop">停掉</button></div>
          ${v.verdict ? `<span class="muted">已選：${{ continue: '繼續做', modify: '修改', stop: '停掉' }[v.verdict]}</span>` : ''}</form></div>`
      : '<p class="muted" style="margin:6px 0 0">上週沒有設定調整。</p>'}
    </section>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)">
      <section class="card"><div class="eyebrow" style="letter-spacing:0;margin-bottom:12px">② 這週的帳 · 已知事實</div>
        <div class="grid g2" style="gap:10px">
          <div class="mini"><div class="muted">押注有做</div><div class="num">${d.done} <small>/ ${d.total}</small></div></div>
          <div class="mini"><div class="muted">有對帳的天數</div><div class="num">${d.reconciledDays} <small>/ ${d.elapsedDays}</small></div></div>
          <div class="mini"><div class="muted">有紀錄的天數</div><div class="num">${d.entryDays} <small>天</small></div></div>
          <div class="mini"><div class="muted">預估偏差</div><div class="num">${pct(d.deviation.pct)}</div></div>
        </div>
        <p class="muted" style="margin:12px 0 0">${[
          d.missingDays.length ? `${d.missingDays.map(md).join('、')} 沒有紀錄，不當成沒做事` : '',
          d.untimed ? `${d.untimed} 件押注沒填預估，不推算時間差` : '',
          d.pending ? `${d.pending} 件還沒對帳` : '',
        ].filter(Boolean).join('；') || '這週資料完整。'}</p>
      </section>
      <section class="card"><div class="card-head"><div class="eyebrow" style="letter-spacing:0">③ 看到的模式 · 可能原因，等你確認</div>
        ${d.aiEnabled && d.total ? `<button class="btn sm" data-act="gen-weekly" data-week="${d.weekStart}">${r ? '重新產生' : '產生 AI 回顧'}</button>` : ''}</div>
        ${r ? r.patterns.map((p) => `<div style="padding:12px 0;border-top:1px solid var(--line)">
            <div style="line-height:1.7"><span style="color:${tone[p.tone]}">●</span>　${esc(p.text)}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap">
              <span class="muted">${p.betIds.length ? `依據 ${p.betIds.length} 件押注` : ""}</span><span class="btns">${fb(p, 'right', '對')}${fb(p, 'partial', '部分對')}${fb(p, 'wrong', '不對')}</span></div>
            ${p.feedback === 'wrong' ? `<form data-form="pattern-note" data-week="${d.weekStart}" data-p="${p.id}" style="display:flex;gap:8px;margin-top:8px"><label class="sr" for="pn_${p.id}">補充原因</label><input id="pn_${p.id}" class="input" name="note" value="${esc(p.note)}" placeholder="哪裡不對？（選填）"><button class="btn sm">存</button></form>` : ''}
          </div>`).join('') + (r.dataGaps.length ? `<p class="muted">資料不足：${r.dataGaps.map(esc).join('；')}</p>` : '')
        : `<p class="muted">${!d.total ? '這週還沒有押注，沒有東西可以回顧。' : d.aiEnabled ? '按「產生 AI 回顧」，AI 會從這週的押注和對帳找出模式。' : '尚未設定 AI。你仍然可以直接在下面寫下週要改的一件事。'}</p>`}
      </section>
    </div>

    <form class="card soft" data-form="adjust" data-week="${d.weekStart}" style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:20px;align-items:end">
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="eyebrow" style="letter-spacing:0">④ 下週只改一件事${d.planned ? ' · 已設定' : ''}</div>
        <label class="field">要改的事<textarea class="input" name="change" style="min-height:70px" required>${esc(d.planned?.change || r?.suggestion.change || '')}</textarea></label>
        <input type="hidden" name="basis" value="${esc(d.planned?.basis || r?.suggestion.basis || '')}">
        ${r?.suggestion.basis && !d.planned ? `<span class="muted">依據：${esc(r.suggestion.basis)}</span>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <label class="field">你預測下週會怎樣？<input class="input" name="prediction" required value="${esc(d.planned?.prediction || '')}" placeholder="${esc(r?.suggestion.prediction_example || '例：提案類押注有做 4/4，超時不超過 30 分鐘')}"></label>
        <button class="btn primary" type="submit">${d.planned ? '更新' : `確認，${md(addDays(d.weekStart, 13))} 驗證`}</button>
      </div>
    </form>`;
  },
};

pages['/trail'] = {
  key: 'trail',
  load: () => api('GET', '/trail'),
  view(d) {
    const vals = d.weeks.map((w) => w.pct);
    const top = Math.max(50, ...vals.filter((v) => v != null).map((v) => Math.abs(v)));
    const latest = [...d.weeks].reverse().find((w) => w.pct != null);
    const first = d.weeks.find((w) => w.pct != null);
    const bars = d.weeks.map((w, i) => w.pct == null
      ? `<div class="empty" style="height:12px" title="${md(w.weekStart)} 那週沒有資料"></div>`
      : `<div class="${i === d.weeks.length - 1 ? 'cur' : ''}" style="height:${Math.max(4, (Math.abs(w.pct) / top) * 160)}px" title="${md(w.weekStart)}：${pct(w.pct)}"></div>`).join('');
    const catMax = Math.max(50, ...d.byCategory.map((c) => Math.abs(c.pct)));
    return `
    <div class="page-head"><div><div class="eyebrow">近 8 週</div><h1>結果軌跡</h1><p class="lede">有些事今天做，結果下個月才出現。把它們連起來看。</p></div>
      <button class="btn primary" data-act="new-outcome">＋ 記一個結果</button></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:start">
      <section class="card" style="display:flex;flex-direction:column;gap:14px">
        <div><h2>預估越來越準了嗎</h2><div class="muted">實際時間比預估多出的比例 · 越低越準</div></div>
        <div class="chart" style="grid-template-columns:repeat(${d.weeks.length},minmax(0,1fr))">${bars}</div>
        <div style="display:flex;justify-content:space-between" class="muted"><span>${first ? `${md(first.weekStart)} 那週 ${pct(first.pct)}` : '還沒有資料'}</span><span style="color:var(--hi);font-weight:700">${latest ? `最近 ${pct(latest.pct)}` : ''}</span></div>
        ${d.byCategory.length ? `<div style="border-top:1px solid var(--line);padding-top:12px"><div class="small" style="font-weight:700;margin-bottom:8px">各類別的偏差（近 4 週）</div>
          <div class="bars" style="grid-template-columns:72px minmax(0,1fr) 52px">${d.byCategory.map((c) => `<span>${esc(c.category)}</span><div class="track"><i class="${c.pct > 30 ? 'warn' : 'good'}" style="width:${(Math.abs(c.pct) / catMax) * 100}%"></i></div><span style="text-align:right">${pct(c.pct)}</span>`).join('')}</div></div>` : '<p class="muted">押注填了預估、對帳時填了實際時間，這裡才會有資料。</p>'}
      </section>
      <div style="display:flex;flex-direction:column;gap:20px">
        ${d.outcomes.length ? d.outcomes.map((o) => `<section class="card" style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="muted">${md(o.day)} · 結果</div><div class="serif" style="font-size:19px;font-weight:700;margin-top:2px">${esc(o.title)}</div></div>
            ${o.span != null ? `<span class="chip hi">從第一筆紀錄 ${o.span} 天</span>` : ''}</div>
          ${o.linked.length ? `<div class="timeline">${o.linked.map((l) => `<div><span class="muted">${md(l.day)}</span>　${l.kind === 'bet' ? '押注：' : ''}${esc(l.text)}${l.backfilled ? `　<span class="chip warn">補記 · ${md(l.createdDay)} 才記</span>` : ''}</div>`).join('')}</div>
            <div class="muted" style="display:flex;gap:8px;align-items:center">${icon('link', 14)}這些是你連上的，系統不判斷是哪一次促成</div>`
          : '<div class="muted">還沒連上任何紀錄。</div>'}
          <div class="btns"><button class="btn sm" data-act="edit-outcome" data-id="${o.id}">連結紀錄</button><button class="btn sm ghost" data-act="del-outcome" data-id="${o.id}">刪除</button></div>
        </section>`).join('') : '<section class="card empty-state">還沒有記錄任何結果。成交、簽約、完成一件大事時記一筆，再連回當初的紀錄。</section>'}
      </div>
    </div>`;
  },
};

pages['/settings'] = {
  key: 'settings',
  load: () => api('GET', '/settings'),
  view(s) {
    const hook = `${location.origin}/line/webhook`;
    return `
    <div><div class="eyebrow">設定</div><h1>設定與資料</h1></div>
    <section class="card"><h2>AI 整理</h2><p class="small">${s.ai ? '<span class="chip good">已啟用</span>　紀錄會自動整理摘要、抓出要做的事；每週回顧可產生模式分析。' : '<span class="chip warn">未啟用</span>　在 Netlify 設定環境變數 <code>ANTHROPIC_API_KEY</code> 後重新部署即可啟用。'}</p></section>
    <section class="card"><h2>LINE</h2>
      <p class="small">${s.line ? (s.lineLinked ? '<span class="chip good">已綁定</span>　傳文字給官方帳號就會記下；每晚 9 點推送對帳卡。' : '<span class="chip warn">待綁定</span>　加官方帳號好友或傳一則訊息，第一個傳訊息的人就會被綁定。') : '<span class="chip warn">未設定</span>　需要在 Netlify 設定 <code>LINE_CHANNEL_SECRET</code> 與 <code>LINE_CHANNEL_ACCESS_TOKEN</code>。'}</p>
      <label class="field">Webhook URL（貼到 LINE Developers 的 Messaging API 設定）<input class="input" readonly value="${esc(hook)}" data-act="select"></label></section>
    <section class="card"><h2>資料</h2><p class="small">資料存在你的 Netlify 帳號（Netlify Blobs），只有登入後才能存取。</p>
      <div class="btns"><a class="btn" href="/api/export" download>匯出全部資料（JSON）</a><button class="btn" data-act="wipe">刪除全部資料</button><button class="btn" data-act="logout">登出</button></div></section>`;
  },
};

// ---------- modal (outcomes) ----------
async function outcomeModal(existing) {
  const picked = new Set([...(existing?.entryIds || []), ...(existing?.betIds || [])]);
  let cands = await api('GET', '/link-candidates');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const draw = () => {
    const item = (kind, x) => `<label class="row" style="cursor:pointer"><input type="checkbox" data-kind="${kind}" value="${x.id}" ${picked.has(x.id) ? 'checked' : ''} style="accent-color:var(--accent)"><span class="grow small"><span class="muted">${md(x.day)} ${kind === 'bet' ? '押注' : '紀錄'}</span>　${esc(x.text)}</span></label>`;
    bg.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="記一個結果">
      <h2>${existing ? '連結紀錄' : '記一個結果'}</h2>
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 150px;gap:10px">
        <label class="field">結果<input class="input" name="title" required value="${esc(existing?.title || '')}" placeholder="例：客戶簽約、完成交件"></label>
        <label class="field">日期<input class="input" type="date" name="day" value="${existing?.day || S.me.today}"></label></div>
      <label class="field">找相關的紀錄或押注<input class="input" name="q" type="search" placeholder="輸入關鍵字…"></label>
      <div class="list" style="max-height:300px;overflow:auto">${cands.entries.map((x) => item('entry', x)).join('')}${cands.bets.map((x) => item('bet', x)).join('')}</div>
      <div class="btns" style="justify-content:flex-end"><button type="button" class="btn" data-x="cancel">取消</button><button class="btn primary" type="submit">儲存</button></div></form>`;
  };
  draw();
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('change', (ev) => {
    if (ev.target.type === 'checkbox') ev.target.checked ? picked.add(ev.target.value) : picked.delete(ev.target.value);
  });
  bg.addEventListener('click', (ev) => {
    if (ev.target === bg || ev.target.dataset.x === 'cancel') close();
  });
  bg.addEventListener('input', async (ev) => {
    if (ev.target.name !== 'q') return;
    const qv = ev.target.value;
    const f = bg.querySelector('form');
    const keep = { title: f.title.value, day: f.day.value };
    cands = await api('GET', `/link-candidates?q=${encodeURIComponent(qv)}`);
    draw();
    const nf = bg.querySelector('form');
    nf.title.value = keep.title;
    nf.day.value = keep.day;
    nf.q.value = qv;
    nf.q.focus();
  });
  bg.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const boxes = [...bg.querySelectorAll('input[type=checkbox]')];
    const all = [...picked];
    const kindOf = (idv) => boxes.find((b) => b.value === idv)?.dataset.kind;
    const body = {
      title: f.title.value,
      day: f.day.value,
      entryIds: all.filter((x) => kindOf(x) === 'entry' || (!kindOf(x) && existing?.entryIds.includes(x))),
      betIds: all.filter((x) => kindOf(x) === 'bet' || (!kindOf(x) && existing?.betIds.includes(x))),
    };
    try {
      existing ? await api('PATCH', `/outcomes/${existing.id}`, body) : await api('POST', '/outcomes', body);
      close();
      toast('已儲存');
      render();
    } catch (err) {
      toast(err.message);
    }
  });
  bg.querySelector('input[name=title]').focus();
}

// ---------- render ----------
async function render() {
  if (!S.me) S.me = await api('GET', '/me');
  if (!S.me.authed) {
    $app.innerHTML = loginView(S.ui.loginError);
    return;
  }
  const { path, q } = route();
  const page = pages[path] || pages['/'];
  try {
    if (!S.settings) S.settings = await api('GET', '/settings');
    const [data, rv] = await Promise.all([page.load(q), api('GET', '/reconcile')]);
    S.ui.pendingCount = rv.bets.filter((b) => b.status === 'pending').length + rv.overdue.length;
    S.data = data;
    const y = window.scrollY;
    $app.innerHTML = shell(page.key, page.view(data));
    if (S.ui.keepScroll) window.scrollTo(0, y);
    S.ui.keepScroll = false;
  } catch (err) {
    if (S.me.authed) $app.innerHTML = shell(page.key, `<div class="card"><h2>載入失敗</h2><p class="muted">${esc(err.message)}</p><button class="btn" data-act="reload">重試</button></div>`);
  }
}

const refresh = () => {
  S.ui.keepScroll = true;
  return render();
};

async function act(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- events ----------
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) {
    if (S.ui.menuOpen && !ev.target.closest('.side')) {
      S.ui.menuOpen = false;
      document.querySelector('.shell')?.classList.remove('open');
    }
    return;
  }
  const x = el.dataset;
  switch (x.act) {
    case 'menu':
      S.ui.menuOpen = !S.ui.menuOpen;
      document.querySelector('.shell').classList.toggle('open', S.ui.menuOpen);
      break;
    case 'reload':
      render();
      break;
    case 'select':
      el.select();
      break;
    case 'obs':
      act(() => api('POST', `/entries/${x.entry}/observations/${x.obs}`, { feedback: x.v }));
      break;
    case 'reanalyze':
      el.disabled = true;
      el.textContent = '整理中…';
      act(() => api('POST', `/entries/${x.id}/analyze`), '已重新整理');
      break;
    case 'del-entry':
      if (confirm('刪除這則紀錄？已設為押注的事不會被刪除。')) act(() => api('DELETE', `/entries/${x.id}`), '已刪除');
      break;
    case 'bet-status': {
      const body = { status: x.s };
      if (x.s === 'rescheduled') {
        const day = prompt('改到哪一天？（YYYY-MM-DD）', addDays(S.me.today, 1));
        if (!day) return;
        body.day = day;
      }
      act(() => api('PATCH', `/bets/${x.id}`, body));
      break;
    }
    case 'del-bet':
      if (confirm('刪除這件押注？')) act(() => api('DELETE', `/bets/${x.id}`), '已刪除');
      break;
    case 'reason':
      act(() => api('PATCH', `/bets/${x.id}`, { reason: x.r }));
      break;
    case 'cause':
      act(() => api('PATCH', `/bets/${x.id}`, { overrunCause: x.c }), '記下了');
      break;
    case 'all-done':
      act(async () => {
        for (const b of S.data.overdue) await api('PATCH', `/bets/${b.id}`, { status: 'done' });
      }, '已全部標為有做');
      break;
    case 'finish':
      act(() => api('POST', '/reconcile/finish', { day: x.day }), '對帳完成');
      break;
    case 'gen-weekly':
      el.disabled = true;
      el.textContent = 'AI 回顧產生中…';
      act(() => api('POST', '/weekly/generate', { week: x.week }), '已產生');
      break;
    case 'pattern':
      act(() => api('POST', `/weekly/${x.week}/patterns/${x.p}`, { feedback: x.v }));
      break;
    case 'new-outcome':
      outcomeModal(null).catch((e) => toast(e.message));
      break;
    case 'edit-outcome':
      outcomeModal(S.data.outcomes.find((o) => o.id === x.id)).catch((e) => toast(e.message));
      break;
    case 'del-outcome':
      if (confirm('刪除這個結果？')) act(() => api('DELETE', `/outcomes/${x.id}`), '已刪除');
      break;
    case 'logout':
      await api('POST', '/logout');
      S.me = { authed: false };
      S.settings = null;
      render();
      break;
    case 'wipe': {
      const c = prompt('這會永久刪除所有紀錄、押注與回顧。確定請輸入「刪除全部」');
      if (c) act(() => api('POST', '/wipe', { confirm: c }), '已刪除全部資料');
      break;
    }
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.change === 'jday' && el.value) location.hash = `#/journal?day=${el.value}`;
  if (el.dataset.change === 'actual') act(() => api('PATCH', `/bets/${el.dataset.id}`, { actualMin: el.value }));
  if (el.dataset.change === 'estimate') act(() => api('PATCH', `/bets/${el.dataset.id}`, { estimateMin: el.value }));
});

document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('form[data-form]');
  if (!f) return;
  ev.preventDefault();
  const kind = f.dataset.form;
  const btn = ev.submitter;
  const val = (n) => f.elements[n]?.value;
  if (kind === 'login') {
    try {
      await api('POST', '/login', { pin: val('pin') });
      S.me = null;
      S.ui.loginError = '';
    } catch (err) {
      S.ui.loginError = err.message;
    }
    render();
    return;
  }
  if (kind === 'search') {
    const qv = val('q').trim();
    location.hash = qv ? `#/journal?q=${encodeURIComponent(qv)}` : '#/journal';
    return;
  }
  if (btn) btn.disabled = true;
  if (kind === 'entry') {
    const { q } = route();
    const day = q.day && q.day !== S.me.today ? q.day : null;
    if (btn) btn.textContent = S.settings.ai ? 'AI 整理中…' : '儲存中…';
    act(() => api('POST', '/entries', { text: val('text'), occurredAt: day ? `${day}T12:00:00+08:00` : undefined }), '已記下');
  }
  if (kind === 'bet') {
    act(() => api('POST', '/bets', { title: val('title'), estimateMin: val('estimateMin'), category: val('category'), day: val('day') }), '已加入押注');
  }
  if (kind === 'accept') {
    const picks = [...f.querySelectorAll('input[name=pick]:checked')].map((c) => ({
      id: c.value,
      title: val(`title_${c.value}`),
      estimateMin: val(`est_${c.value}`) === '' ? null : val(`est_${c.value}`),
    }));
    if (!picks.length) {
      toast('沒有勾選任何事項');
      if (btn) btn.disabled = false;
      return;
    }
    act(() => api('POST', `/entries/${f.dataset.entry}/accept`, { picks }), `已設為押注 ${picks.length} 件`);
  }
  if (kind === 'obs-note') act(() => api('POST', `/entries/${f.dataset.entry}/observations/${f.dataset.obs}`, { feedback: 'wrong', note: val('note') }), '已補充');
  if (kind === 'pattern-note') act(() => api('POST', `/weekly/${f.dataset.week}/patterns/${f.dataset.p}`, { feedback: 'wrong', note: val('note') }), '已補充');
  if (kind === 'verify') act(() => api('POST', `/adjustments/${f.dataset.id}/verify`, { actual: val('actual'), decision: btn?.value || 'continue' }), '已記下驗證結果');
  if (kind === 'adjust') act(() => api('POST', '/adjustments', { weekStart: f.dataset.week, change: val('change'), basis: val('basis'), prediction: val('prediction') }), '下週的調整已設定');
});

document.addEventListener('toggle', (ev) => {
  if (ev.target.dataset?.toggle === 'bet') S.ui.betOpen = ev.target.open;
}, true);

window.addEventListener('hashchange', () => {
  S.ui.menuOpen = false;
  render();
  window.scrollTo(0, 0);
});

render();
