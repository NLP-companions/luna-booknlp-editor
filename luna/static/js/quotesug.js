'use strict';
/* Quotes view: the "Speaker suggestions" sub-tab, a review queue like the Entities merge suggestions. One suggestion at a time:
   the card (what is suggested, why, the buttons and speaker keys) on top, and below it the quote in the Speaker-Attribution
   view's reading area (qfocusui.js: attribution, context with the speaker of each passage in the margin, sized to fit the screen). */

/* The Speaker suggestions page's state: `sq` the number (from 0) of the suggestion shown, `sqItem` that suggestion and
   `sqCount` how many there are (the server sends one at a time), `sqCur` the quote the side panel is about; the info
   strip's open state, which bundle's list is open and which of its quotes are unticked, and whether every reason shows. */
Object.assign(S.qv, { pane: ['list', 'focus', 'sug'].includes(stored('bne.qpane')) ? stored('bne.qpane') : 'list', sq: 0, sqItem: null, sqCount: null, sqCur: null, bopen: null, bexcl: new Set(), sqInfo: false, sqWhy: false });

/* The tabs of the Quotes view: All quotes, Speaker-Attribution, Speaker suggestions (with a count), and the quote-rule link.
   `p` is the tab shown: 'list', 'focus' (the Speaker-Attribution view, drawn by qfocusui.js, which has its own S.view) or 'sug'.
   S.qv.pane remembers the tab last used, 'focus' included (set by setQPaneState, also saved in the browser), so leaving Quotes
   or reloading the page and coming back reopens it. */
function quotesNav(p = S.qv.pane) {
  whenIdle('qsBadge', loadQsBadge);   // counting them scores every quote: not on every step of the Speaker-Attribution view
  const n = S.qv.sqCount;
  return `<nav class="enav" aria-label="Quote tools">
    <button data-qpane="list" aria-pressed="${p === 'list'}">All quotes</button>
    <button data-qpane="focus" aria-pressed="${p === 'focus'}" title="One quote at a time with the text around it, to fix who speaks">Speaker-Attribution</button>
    <button data-qpane="sug" aria-pressed="${p === 'sug'}">Speaker suggestions <span class="badge" id="bdQs">${n ? n.toLocaleString() : ''}</span></button>
    <span class="grow"></span><button class="link" data-goqr title="Move I, me, my inside quotes to each quote’s speaker">Quote rule…</button></nav>`;
}
/* Fill in the number of speaker suggestions on its tab (and remember it, so a redrawn tab shows it at once). */
async function loadQsBadge() {
  try {
    const r = await api('GET', '/api/quote-suggestions?limit=1&bundles=0');
    S.qv.sqCount = r.total;
    const el = $('#bdQs'); if (el) el.textContent = r.total ? r.total.toLocaleString() : '';
  } catch { }
}
/* Make `p` the tab last used in Quotes, and save it in the browser. */
function setQPaneState(p) { S.qv.pane = p; remember('bne.qpane', p); }
/* Switch between the tabs of Quotes (from the Speaker-Attribution view too, which is a view of its own). */
function setQPane(p) {
  if (p === 'focus') { setView('qfocus'); return; }
  if (S.view !== 'quotes') { setQPaneState(p); setView('quotes'); return; }
  saveNav();
  setQPaneState(p);
  renderQuotesView().then(() => { $('#main').scrollTop = 0; pushNav(); }).catch(fail);
}

/* ------------------------------------------------------------ rendering */
/* A speaker as a coloured chip with its group number. */
function sqChip(g, extra = '') {
  if (!g) return '<span class="spchip none">No speaker</span>';
  return `<span class="spchip" style="--h:${hue(g.id)}">${esc(g.name)}</span><span class="num">#${g.id}${extra}</span>`;
}
/* The reasons for and against a candidate speaker, with their weights. */
function sqReasons(rs) {
  return rs.length ? `<ul class="reasons">${rs.map(x => `<li class="${x.w >= 0 ? 'pos' : 'neg'}"><span class="w">${x.w > 0 ? '+' : ''}${x.w}</span>${esc(x.text)}</li>`).join('')}</ul>` : '<p class="note">No evidence either way.</p>';
}
/* The strongest reason for or against a candidate, as a one-line summary of the evidence. */
function sqTopReason(rs) {
  const x = rs[0];
  return x ? `<span class="${x.w >= 0 ? 'pos' : 'neg'}">${x.w > 0 ? '+' : ''}${x.w} ${esc(x.text)}</span>` : '<span class="muted">No evidence either way</span>';
}
/* The marks in the reading area: BookNLP's speaker mention (bold) and the suggested speaker's (dashed), each in its speaker's colour. */
function sqMarks(it) {
  const marks = [];
  if (it.best_mention) marks.push({ s: it.best_mention.s, e: it.best_mention.e, speaker: it.best.id, title: 'Suggested speaker mention', cls: ' sug' });
  if (it.cur_mention) marks.push({ s: it.cur_mention.s, e: it.cur_mention.e, speaker: it.cur ? it.cur.id : null, title: 'BookNLP’s speaker mention', cls: '' });
  return marks;
}
/* The margin beside the quote: its current speaker and, below, the suggested one (when different). */
function sqWho(it, rd) {
  const sug = it.best && !(it.cur && it.cur.id === it.best.id)
    ? `<br><span class="spchip sugg" style="--h:${hue(it.best.id)}" title="Suggested speaker">→ ${esc(trim(it.best.name, 18))}</span>` : '';
  return qfWho(rd.quote) + sug;
}
/* The speakers offered on a card: the suggestion, then alternatives (up to six). */
function sqChoices(it) {
  const list = [];
  if (it.best) list.push({ ...it.best, reason: it.best_reasons[0] ? it.best_reasons[0].text : '', mention: it.best_mention ? it.best_mention.uid : null });
  for (const a of it.alternatives) list.push(a);
  return list.slice(0, 6);
}
/* Why a quote is suggested for review. */
const SQ_KIND = { other: 'A different speaker is more likely', none: 'No speaker yet', doubt: 'BookNLP’s speaker looks doubtful' };
/* The bundles of clear attribution tags, to apply in one go (the open one lists its quotes with a tick each). */
function sqBundles(bundles) {
  const qv = S.qv;
  return bundles.map((b, i) => {
    const open = qv.bopen === i;
    const n = b.items.filter(x => !qv.bexcl.has(x.uid)).length;
    return `<div class="bundle"><div class="bh"><b>${esc(b.title)}</b><span class="num">${b.n.toLocaleString()} quote${b.n === 1 ? '' : 's'}</span><span class="grow"></span>
        <button class="btn sm primary" data-sqb="${i}" data-sqbact="apply">Apply ${n === b.n ? 'all' : n}</button><button class="btn sm" data-sqb="${i}" data-sqbact="toggle">${open ? 'Hide list' : 'Review list'}</button></div>
      ${open ? `<ul class="blist">${b.items.map(x => `<li><label class="chk"><input type="checkbox" data-sqx="${x.uid}" ${qv.bexcl.has(x.uid) ? '' : 'checked'}> S ${esc(String(x.s))}</label>
        <span class="mctx">“${esc(trim(x.text.replace(/^["“”'\s]+|["“”'\s]+$/g, ''), 90))}”</span>
        <span class="qrmv">${x.cur ? `<span class="sw" style="--h:${hue(x.cur.id)}"></span>${esc(trim(x.cur.name, 16))}` : '<span class="muted">none</span>'} → <span class="sw" style="--h:${hue(x.best.id)}"></span>${esc(trim(x.best.name, 16))}</span>
        <button class="link" data-qact="goto" data-ord="${x.s}">Show</button></li>`).join('')}</ul>` : ''}</div>`;
  }).join('');
}
/* The collapsible strip above the card: what the evidence is, and the bundles (sent by the server only while it is open). */
function sqInfoHTML(r) {
  const kinds = r.by_kind || {};
  const counts = [[kinds.other, 'with a different speaker'], [kinds.none, 'without a speaker'], [kinds.doubt, 'doubtful']].filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(', ');
  const bundles = sqBundles(r.bundles);
  return `<details class="sqinfo" id="sqInfo" ${S.qv.sqInfo ? 'open' : ''}><summary>How the suggestions are made${r.n_bundles ? ` · ${r.n_bundles} bundle${r.n_bundles === 1 ? '' : 's'} to apply in one go` : ''}${counts ? ` · ${counts}` : ''}</summary>
    <div class="sqbody"><p class="note" style="margin-top:0">Quotes whose speaker is probably different from BookNLP’s, or missing. The evidence: an attribution tag next to the quote (<i>“…,” said Holmes</i>; <i>Holmes said, “…”</i>; <i>“…” he asked</i>), a quote that goes on from the one before it in the same paragraph, turn-taking in a conversation, and how much the quote sounds like each candidate’s other quotes. Against a speaker: being addressed by name in the quote, or BookNLP linking it through a mention inside the quote or far away. The weights are on the Settings page, under Suggestions.</p>
    ${bundles ? `<h3>Clear attribution tags, apply in one go</h3>${bundles}` : ''}</div></details>`;
}
/* The card: what is suggested and why (the strongest reason, or all of them), the buttons, and the speakers to choose. */
function sqCardHTML(it, total) {
  const qv = S.qv, choices = sqChoices(it), why = qv.sqWhy;
  const sameName = it.best && it.cur && it.best.name === it.cur.name && it.best.id !== it.cur.id;
  const reasons = rs => why ? sqReasons(rs) : `<div class="sqwhy">${sqTopReason(rs)}</div>`;
  const now = `<div class="mside"><div class="sql">Now</div><div class="msn">${sqChip(it.cur)}${it.cur ? `<span class="num">score ${it.cur_score}</span>` : ''}</div>${it.cur ? reasons(it.cur_reasons) : ''}</div>`;
  const sug = `<div class="mside keep"><div class="sql">Suggested</div>${it.best ? `<div class="msn">${sqChip(it.best)}<span class="num">score ${it.best_score}</span></div>${reasons(it.best_reasons)}`
    : '<p class="note">No better speaker found nearby. Choose one below or with G.</p>'}</div>`;
  return `<div class="sqcard" id="sqcard">
    <div class="mhead"><span>Suggestion <input class="ppjump" id="sqJump" type="number" min="1" max="${total}" value="${qv.sq + 1}" aria-label="Number to go to" title="Type a number and press Go or Enter"> of ${total.toLocaleString()} <button class="btn sm" data-sqa="go">Go</button> · ${SQ_KIND[it.kind]}</span><span class="grow"></span>
      <button class="link" data-sqa="why">${why ? 'Fewer reasons' : 'All reasons'}</button>
      <label>Context <input id="sqTok" type="number" min="0" max="2000" step="10" value="${qfTokens}" aria-label="Tokens of context above and below"> tokens each side</label>
      <span class="num">S ${it.sent} · t${it.s}–${it.e}</span></div>
    <div class="sqcols">${now}${sug}</div>
    ${sameName ? `<div class="sqsame"><span>“${esc(it.cur.name)}” #${it.cur.id} and #${it.best.id} are two groups with the same name. Merging them in one step fixes this and every quote like it.</span><button class="btn sm" data-sqa="mergegroups">Merge the two groups</button></div>` : ''}
    <div class="row mact" style="margin-top:10px">
      ${it.best ? `<button class="btn primary" data-sqa="accept">Accept “${esc(trim(it.best.name, 22))}” <kbd>Enter</kbd></button>` : ''}
      <button class="btn" data-sqa="other">Other speaker… <kbd>G</kbd></button>
      ${it.cur ? `<button class="btn" data-sqa="keep" title="Keep BookNLP’s speaker; this suggestion won’t come back">Keep “${esc(trim(it.cur.name, 18))}” <kbd>K</kbd></button>` : `<button class="btn" data-sqa="keep" title="Leave it without a speaker; this suggestion won’t come back">Leave without speaker <kbd>K</kbd></button>`}
      <button class="btn" data-sqa="skip">Skip <kbd>→</kbd></button>
      <button class="link" data-sqa="prev" ${qv.sq ? '' : 'disabled'}>Previous <kbd>←</kbd></button>
      <button class="link" data-qact="goto" data-ord="${it.s}" data-end="${it.e}">Show in text</button></div>
    <div class="sqpick">${choices.map((c, i) => `<button class="btn fc" data-sqpick="${i}" title="${esc(c.reason || '')}"><kbd>${i + 1}</kbd><span class="sw" style="--h:${hue(c.id)}"></span>${esc(c.name)} <span class="num">#${c.id}</span></button>`).join('')}
      <button class="btn fc" data-sqpick="none" title="For narration marked as a quote, or when it can’t be told"><kbd>0</kbd>No speaker</button></div>
  </div>`;
}
/* The Speaker suggestions tab: the info strip, the card, and the quote in the reading area. One suggestion is fetched at a
   time (a long book has thousands, each with its reasons and context); past the last one, the last is shown. */
async function renderQuoteSug() {
  const qv = S.qv, seq = renderQuoteSug.seq = (renderQuoteSug.seq || 0) + 1;
  const page = () => api('GET', `/api/quote-suggestions?offset=${qv.sq}&limit=1&bundles=${qv.sqInfo ? 1 : 0}`);
  let r = await page();
  if (!r.items.length && r.total) { qv.sq = r.total - 1; r = await page(); }
  const it = r.items[0] || null;
  const rd = it ? (await api('GET', `/api/qfocus?uid=${it.uid}&tokens=${qfTokens}`)).item : null;
  if (S.view !== 'quotes' || S.mode !== 'table' || qv.pane !== 'sug' || seq !== renderQuoteSug.seq) return;
  qv.sqItem = it; qv.sqCount = r.total;
  qv.sqCur = null;   // the quote the side panel is about (set below)
  $('#main').innerHTML = `<div class="qf qsq">${quotesNav()}${sqInfoHTML(r)}${it
    ? sqCardHTML(it, r.total) + qfReading(rd, sqMarks(it), sqWho(it, rd))
    : '<p class="muted" style="padding:14px">No speaker suggestions left. New ones appear as you edit.</p>'}</div>`;
  qv.sqCur = rd;
  fitReading('qf');
  renderPanel();
}

/* ------------------------------------------------------------ actions */
/* Send the chosen speaker changes in one step and refresh. */
async function sqApply(items) {
  const r = await api('POST', '/api/quote-suggestions/apply', { items });
  updateHistoryButtons(r.history); toast(r.history.undo);
  await refresh(true);
}
/* Act on the current suggestion (go to a number, accept, choose, other speaker, keep BookNLP's, skip, previous, all/fewer reasons, merge the two groups). */
async function sqAct(kind, arg) {
  const qv = S.qv, it = qv.sqItem; if (!it) return;
  try {
    if (kind === 'skip') { qv.sq++; renderQuoteSug().catch(fail); return; }
    if (kind === 'why') { qv.sqWhy = !qv.sqWhy; renderQuoteSug().catch(fail); return; }
    if (kind === 'go') {   // the number typed in the counter (clamped to the list)
      const n = Math.round(+$('#sqJump').value);
      if (n) { qv.sq = Math.max(1, Math.min(n, qv.sqCount)) - 1; renderQuoteSug().catch(fail); }
      return;
    }
    if (kind === 'prev') { qv.sq = Math.max(0, qv.sq - 1); renderQuoteSug().catch(fail); return; }
    if (kind === 'accept') { if (!it.best) return; noteRecent(it.best.id); await sqApply([{ quote: it.uid, speaker: it.best.id, mention: it.best_mention ? it.best_mention.uid : null }]); return; }
    if (kind === 'keep') { await api('POST', '/api/quote-suggestions/dismiss', { key: it.key }); toast('Kept; this suggestion won’t come back'); renderQuoteSug().catch(fail); loadQsBadge(); return; }
    if (kind === 'pick') {
      if (arg === 'none') { await sqApply([{ quote: it.uid, speaker: null }]); return; }
      const c = sqChoices(it)[arg]; if (!c) return;
      noteRecent(c.id);
      await sqApply([{ quote: it.uid, speaker: c.id, mention: c.mention || null }]);
      return;
    }
    if (kind === 'other') {
      const btn = $('[data-sqa="other"]');
      groupPicker(btn.getBoundingClientRect(), { title: 'Who says this?', allowNew: false, allowNone: true, near: { a: it.s, b: it.e },
        onPick: t => sqApply([{ quote: it.uid, speaker: t }]).catch(fail) });
      return;
    }
    if (kind === 'mergegroups') {
      const [keep, drop] = (it.cur.count || 0) >= (it.best.count || 0) ? [it.cur.id, it.best.id] : [it.best.id, it.cur.id];
      const r = await api('POST', '/api/groups/merge', { target: keep, sources: [drop] });
      updateHistoryButtons(r); toast(r.undo);
      await refresh(true);
    }
  } catch (e) { fail(e); }
}
// the tabs also work from the Speaker-Attribution view
$('#main').addEventListener('click', e => {
  const pn = S.view === 'qfocus' && e.target.closest('[data-qpane]');
  if (pn) setQPane(pn.dataset.qpane);
});
// called first from app.js's Quotes click handler; returns true when it handled the click
function onQuoteSugClick(e) {
  const pn = e.target.closest('[data-qpane]');
  if (pn) { setQPane(pn.dataset.qpane); return true; }
  if (S.qv.pane !== 'sug') return false;
  const a = e.target.closest('[data-sqa]'); if (a) { sqAct(a.dataset.sqa); return true; }
  const p = e.target.closest('[data-sqpick]'); if (p) { sqAct('pick', p.dataset.sqpick === 'none' ? 'none' : +p.dataset.sqpick); return true; }
  const b = e.target.closest('[data-sqb]');
  if (b) {
    (async () => {
      const qv = S.qv, r = await api('GET', '/api/quote-suggestions?limit=1');
      const bd = r.bundles[+b.dataset.sqb]; if (!bd) { renderQuoteSug().catch(fail); return; }
      if (b.dataset.sqbact === 'toggle') { qv.bopen = qv.bopen === +b.dataset.sqb ? null : +b.dataset.sqb; renderQuoteSug().catch(fail); return; }
      const items = bd.items.filter(x => !qv.bexcl.has(x.uid)).map(x => ({ quote: x.uid, speaker: x.best.id, mention: x.mention }));
      if (!items.length) { toast('Nothing ticked'); return; }
      if (items.length > 25 && !confirm(`Set the speaker of ${items.length.toLocaleString()} quotes? You can undo this in one step.`)) return;
      qv.bopen = null; qv.bexcl.clear();
      await sqApply(items);
    })().catch(fail);
    return true;
  }
  if (e.target.matches('input')) return true;
  return false;
}
document.addEventListener('change', e => {
  if (e.target.id === 'sqTok') { setQfTokens(e.target.value); renderQuoteSug().catch(fail); return; }   // the context size, shared with the Speaker-Attribution view
  const t = e.target.closest('[data-sqx]'); if (!t) return;
  tickRange(t, 'sqx', S.qv.bexcl, { excl: true });
  renderQuoteSug().catch(fail);
});
// the open/closed state of the info strip survives redraws ('toggle' does not bubble: listen while it is captured)
document.addEventListener('toggle', e => {
  if (e.target.id !== 'sqInfo') return;
  const opened = e.target.open && !S.qv.sqInfo;
  S.qv.sqInfo = e.target.open;
  if (opened) renderQuoteSug().catch(fail);   // the bundles are fetched only while the strip is open
}, true);
document.addEventListener('keydown', e => {   // Enter in the counter's box does what Go does
  if (e.key === 'Enter' && e.target.id === 'sqJump') { e.preventDefault(); sqAct('go'); }
});
window.addEventListener('keydown', e => {
  if (S.view !== 'quotes' || S.qv.pane !== 'sug' || S.mode !== 'table' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches && e.target.matches('input, select, textarea')) return;
  if (e.key === 'Enter' && e.target.matches && e.target.matches('button, summary, a')) return;   // Enter there activates the control, it must not also accept
  if (!pop.hidden || !$('#drawer').hidden || !S.qv.sqItem) return;
  const k = e.key.toLowerCase();
  const map = { enter: 'accept', k: 'keep', g: 'other', arrowright: 'skip', arrowleft: 'prev' };
  let act = null;
  if (map[k]) act = () => sqAct(map[k]);
  else if (k === '0') act = () => sqAct('pick', 'none');
  else if (/^[1-6]$/.test(k)) act = () => sqAct('pick', +k - 1);
  if (!act) return;
  e.preventDefault(); e.stopImmediatePropagation();
  act();
}, true);
