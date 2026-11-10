'use strict';
/* The Split tab in Entities: one group at a time, its mentions in reading order, to split up entities BookNLP ran together
   (two people in one group). Data from core/tools/split.py (`/api/split/groups`, `/api/split`, `/api/split/settings`).

   The left column lists the groups likely to be more than one entity, each with why (or, with a search, any group). The
   middle looks and works like the Fragments tab and the attribution views: a tool bar and a reading view of the mention
   shown (its sentence large on the centre line, the text above and below with every mention marked, `eaRows`/`fitReading`).

   The bar: Keep ↵ (the mention stays: remembered as confirmed, the Pronoun pass's list, so the walk can skip it next time),
   the entities to move it to on the number keys (the *lanes* first, then nearby groups of its type), New group N, Other… G,
   ‹ ← / Skip →, Mark as checked C, Settings, Close Esc. A lane is a group this split sends mentions to: a new group made here
   (N, or a new name in Other…) or a group picked in Other…; each group being split keeps its own lanes (in this page only).
   The *scope* chips above choose what a keep or a move takes along: this mention, the group's mentions with the same text,
   the same pronoun set, or in the same paragraph (Tab cycles; after each keep or move it is "This mention" again). The side
   panel shows the group as an entity (`renderQFPanel`, through `qfCur`). */

/* How much text is shown above and below the mention's sentence, in tokens, unless you chose otherwise (the server allows
   up to CONTEXT_MAX of core/tools/split.py). */
const SP_TOKENS_DEFAULT = 120, SP_TOKENS_MAX = 2000;
/* The context size in tokens, as chosen (saved in this browser). */
let spTokens = storedNumber('bne.spTokens', SP_TOKENS_DEFAULT, 0, SP_TOKENS_MAX);
/* The labels of the mention types (the `prop` of an entity). */
const SP_PROPS = { PROP: 'name', NOM: 'noun', PRON: 'pronoun' };
/* The tab's state: the search (`q`) and the list it gave (`list`), the group being split (`gid`), the query that fetches what
   to show next (`want`: `uid=…` to stay, `ord=…&dir=…` to move), the last reply (`r`), the scope chosen (`scope`), the lanes of
   each group split here (`lanes`: group → [group ids]) and what the side panel shows (`panel`). */
S.sp = { q: '', list: null, gid: null, want: null, r: null, scope: 'one', lanes: {}, panel: null };

/* ------------------------------------------------------------ data */
/* Open the tab on a group (the "Split…" button on a group's page). */
function openSplit(gid) {
  Object.assign(S.sp, { gid, want: 'ord=-1&dir=next', scope: 'one' });
  openPane('split');
}
/* Fetch a mention of the group being split (`q`: the walk's query). */
function spFetch(q) { return api('GET', `/api/split?group=${S.sp.gid}&${q}&tokens=${spTokens}`); }
/* Take a reply: show it next time, keep the place (`want`), and draw the side panel for its group. */
function spTake(r) {
  const sp = S.sp;
  sp.r = r;
  sp.want = r.item ? `uid=${r.item.uid}` : 'ord=-1&dir=next';
  sp.panel = r.group ? { speaker: r.group.id, speaker_name: r.group.name, s: r.item ? r.item.s : 0, e: r.item ? r.item.e : 0, mention: null } : null;
  renderPanel();
}
/* Fetch what `want` says (falling back to the place it had when the mention asked for by uid is gone) and take it. */
async function spLoad() {
  const sp = S.sp;
  try { spTake(await spFetch(sp.want || 'ord=-1&dir=next')); } catch (e) {
    const x = sp.r && sp.r.item;
    if (!(sp.want || '').startsWith('uid=') || !x) throw e;
    spTake(await spFetch(`ord=${x.pos - 1}&dir=here`));
  }
}
/* The choices for the number keys: back to the group being split (when the mention shown has left it), the lanes, then the
   suggestions, never the mention's own group, at most nine. */
function spChoices(x) {
  const sp = S.sp, lanes = (sp.lanes[sp.gid] || []).filter(id => S.clusterById.has(id));
  sp.lanes[sp.gid] = lanes;
  const out = [];
  const add = c => { if (out.length < 9 && c.id !== x.group && !out.some(o => o.id === c.id)) out.push(c); };
  if (x.group !== sp.gid && sp.r.group) add({ id: sp.gid, name: sp.r.group.name, back: true });
  lanes.forEach(id => add({ id, name: S.clusterById.get(id).name, lane: true }));
  x.candidates.forEach(add);
  return out;
}
/* The scopes on offer for mention `x`: [key, label, number of mentions]; the batch ones only when they take more than it. */
function spScopes(x) {
  const s = x.scopes, out = [['one', 'This mention', 1]];
  if (s.text.uids.length > 1) out.push(['text', `Same text “${trim(s.text.label, 24)}”`, s.text.uids.length]);
  if (s.pron && s.pron.uids.length > 1) out.push(['pron', s.pron.label, s.pron.uids.length]);
  if (s.para.uids.length > 1) out.push(['para', 'This paragraph', s.para.uids.length]);
  return out;
}
/* The mentions a keep or a move takes: the scope chosen (back to "This mention" when it isn't on offer for this one). */
function spUids(x) {
  const sp = S.sp;
  if (!spScopes(x).some(([k]) => k === sp.scope)) sp.scope = 'one';
  return sp.scope === 'one' ? [x.uid] : x.scopes[sp.scope].uids;
}

/* ------------------------------------------------------------ drawing */
/* The pane as `renderChars` draws it: the list and the mention fetched again (an edit may have changed them). */
async function splitPaneHTML() {
  const sp = S.sp;
  sp.list = await api('GET', `/api/split/groups?q=${encodeURIComponent(sp.q)}`);
  if (sp.gid != null) {
    try { await spLoad(); } catch (e) { sp.gid = null; sp.r = null; sp.panel = null; toast(e.message); }
  }
  return spPaneInner();
}
/* The left column: a search, then the groups (the likely ones with their first reason; hover for all). */
function splitAsideHTML() {
  const sp = S.sp, l = sp.list || { items: [], total: 0 };
  const rows = l.items.map(c => `<li class="frow${c.id === sp.gid ? ' sel' : ''}" data-spg="${c.id}" tabindex="0" role="button" aria-label="Split ${esc(c.name)}">
      <span class="sw" style="--h:${hue(c.id)}"></span><span class="cn">${esc(c.name)}</span><span class="num">${esc(c.cat)} · ${c.count}${c.checked ? ' <span class="ok" title="Checked">✓</span>' : ''}</span>
      <span class="frtop" title="${esc(c.reasons.join('\n'))}">${c.reasons.length ? `${esc(c.reasons[0])}${c.reasons.length > 1 ? ` <b>+${c.reasons.length - 1}</b>` : ''}` : '<span class="muted">nothing points to it</span>'}</span></li>`).join('');
  return `<aside class="cl frl">
    <div class="ctools"><input type="search" id="spq" placeholder="Find any group" value="${esc(sp.q)}" aria-label="Find a group to split">
      <div class="gprog">${sp.q ? `${l.total.toLocaleString()} group${l.total === 1 ? '' : 's'} match` : `<b>${l.total.toLocaleString()}</b> group${l.total === 1 ? '' : 's'} may be more than one entity`}</div></div>
    <ul class="crows" id="spList">${rows || `<li class="more">${sp.q ? 'No group matches.' : 'No group looks like more than one entity. Find one above, or open it from its page with Split….'}</li>`}</ul></aside>`;
}
/* The middle: the bar, the context strip and the reading area of the mention shown, or what to do when there is none. */
function spPaneInner() {
  const sp = S.sp, r = sp.r;
  const bare = (text, acts = '') => `<div class="qf fr" id="spDetail"><div class="banner qfbar"><div class="ppbar"><span class="pph"><b>Split</b></span><span>${text}</span>
    <span class="ppa">${acts}<button class="btn sm" data-spa="settings">Settings</button><button class="btn sm" data-spa="close">Close <kbd>Esc</kbd></button></span></div></div></div>`;
  if (sp.gid == null || !r) return bare('Choose a group on the left. Those listed may be more than one entity (the reason is under each); find any other above, or open one from its page with “Split…”.');
  if (!r.group) return bare('That group no longer exists (merged or emptied). Choose another on the left.');
  const g = r.group, x = r.item;
  if (!x) {
    return bare(`No ${r.kept ? 'more ' : ''}mentions of <b>${esc(g.name)}</b> to look at${r.kept ? ` (${r.kept} kept earlier are skipped: Settings)` : ''}.`,
      `<button class="btn sm ${g.checked ? 'okbtn' : 'primary'}" data-spa="check">${g.checked ? '✓ Checked' : 'Mark as checked'} <kbd>C</kbd></button>`);
  }
  const left = `<span class="spchip" style="--h:${hue(x.group)}" title="${esc(x.group_name)} (group #${x.group})">${esc(trim(x.group_name, 18))}</span><div class="qfnar">${esc(x.cat)} · ${esc(SP_PROPS[x.prop] || x.prop)}</div>`;
  return `<div class="qf fr" id="spDetail"><div class="banner qfbar">${spBarHTML(r, g, x)}</div>
    <div class="qftools"><label>Context <input id="spTok" type="number" min="0" max="${SP_TOKENS_MAX}" step="10" value="${spTokens}" aria-label="Tokens of context above and below"> tokens each side</label>
      <span class="muted">click a marked entity to move to it; another mention of ${esc(trim(g.name, 20))} to go to it</span>
      <span class="grow"></span><button class="link" data-gact="goto" data-ord="${x.s}">Show in text</button></div>
    <div class="qftop"><section class="qfctx qfabove" id="spAbove"><div class="qfin">${eaRows(x.above, x.uid)}</div></section>
      <section class="qfcore" id="spCore" style="--h:${hue(x.group)}"><div class="qfin">${eaRows(x.core, x.uid, left)}</div></section></div>
    <section class="qfctx qfbelow" id="spBelow"><div class="qfin">${eaRows(x.below, x.uid)}</div></section></div>`;
}
/* The tool bar (as the attribution views'): where in the group, the mention, the scope, Keep and the choices, the other actions. */
function spBarHTML(r, g, x) {
  const sp = S.sp, manual = r.settings.advance === 'manual';
  const scopes = spScopes(x); spUids(x);   // (resets a scope that isn't on offer here)
  const chips = spChoices(x).map((c, k) => `<button class="cchip${c.lane || c.back ? ' pinned' : ''}" data-spc="${c.id}" title="${esc(c.back ? `Back to ${c.name}` : c.lane ? `A lane of this split: ${c.name}` : `Nearby: ${c.reason || ''}`)}"><kbd>${k + 1}</kbd><span class="sw" style="--h:${hue(c.id)}"></span>${c.back ? '↩ ' : ''}${esc(trim(c.name, 18))}</button>`).join('');
  return `<div class="ppbar">
    <span class="pph"><b>Split</b> <span class="num"><input class="ppjump" id="spAt" type="number" min="1" max="${r.shown}" value="${x.index || ''}" aria-label="Number to go to" title="Type a number and press Go"> of ${r.shown.toLocaleString()} <button class="btn sm" data-spa="go">Go</button></span></span>
    <span class="ppq"><span class="sw" style="--h:${hue(g.id)}"></span><b>${esc(trim(g.name, 28))}</b> <span class="num">${g.count.toLocaleString()} mentions${r.kept ? ` · ${r.kept} kept` : ''}</span> · “<b>${esc(trim(x.text, 40))}</b>” <span class="num">${esc(x.cat)} · ${esc(SP_PROPS[x.prop] || x.prop)}${x.kept ? ' · kept earlier' : ''}${x.group !== g.id ? ` · now in ${esc(trim(x.group_name, 20))}` : ''}</span></span>
    <span class="spscope"><span class="muted">Take along</span>${scopes.map(([k, l, n]) => `<button class="btn sm${sp.scope === k ? ' on' : ''}" data-spscope="${k}" aria-pressed="${sp.scope === k}">${esc(l)}${n > 1 ? ` <span class="num">${n}</span>` : ''}</button>`).join('')}${scopes.length > 1 ? '<kbd title="Tab: the next scope">Tab</kbd>' : ''}</span>
    <span class="ppc"><button class="btn sm primary" data-spa="keep" title="${manual ? 'It belongs here: keep it' : 'It belongs here: keep it and go on'}">Keep <kbd>↵</kbd></button><span class="muted">or move to</span>${chips}
      <button class="btn sm" data-spa="new" title="Split it off into a new group, which becomes a lane of this split">New group <kbd>N</kbd></button><button class="btn sm" data-spa="other" title="Move it to any group, or a new one with a name; it becomes a lane">Other… <kbd>G</kbd></button></span>
    <span class="ppa"><button class="btn sm" data-spa="prev" ${x.index > 1 ? '' : 'disabled'} title="The previous mention">‹ <kbd>←</kbd></button><button class="btn sm" data-spa="next" title="${manual ? 'Go on to the next mention' : 'Go on without keeping it'}">${manual ? 'Next' : 'Skip'} <kbd>→</kbd></button>
      <button class="btn sm ${g.checked ? 'okbtn' : ''}" data-spa="check" title="Mark the group as checked when it is all one entity again">${g.checked ? '✓ Checked' : 'Mark as checked'} <kbd>C</kbd></button>
      <button class="btn sm" data-spa="settings" title="Skip kept mentions, how to advance">Settings</button><button class="btn sm" data-spa="close">Close <kbd>Esc</kbd></button></span>
    ${g.reasons.length ? `<span class="note ppn">Why it may be more than one: ${esc(g.reasons.join(' · '))}</span>` : ''}</div>`;
}
/* Redraw the list and the middle (moving, a scope chosen); the whole view when they aren't on the page. */
function spDraw() {
  const aside = $('.cl.frl'), det = $('#spDetail');
  if (!aside || !det) { renderChars().catch(fail); return; }
  const keep = $('#spList').scrollTop;
  aside.outerHTML = splitAsideHTML();
  $('#spList').scrollTop = keep;
  det.outerHTML = spPaneInner();
  spDrawn();
}
/* After drawing: the current group's row in view, the text fitted. */
function spDrawn() {
  const row = $('#spList .frow.sel'); if (row) row.scrollIntoView({ block: 'nearest' });
  fitReading('sp');
}
window.addEventListener('resize', () => { clearTimeout(spDrawn.t); spDrawn.t = setTimeout(() => fitReading('sp'), 80); });

/* ------------------------------------------------------------ moving and acting */
/* Fetch and show another mention (`q`) without reloading the rest. */
async function spGo(q) {
  const sp = S.sp, seq = spGo.seq = (spGo.seq || 0) + 1;
  try {
    const r = await spFetch(q);
    if (seq !== spGo.seq || S.view !== 'chars' || S.ch.pane !== 'split') return;
    sp.scope = 'one';
    spTake(r);
    spDraw();
  } catch (e) { fail(e); }
}
/* Start splitting group `gid` from its first mention (a row of the list). */
function spOpen(gid) {
  Object.assign(S.sp, { gid, scope: 'one', r: null });
  spGo('ord=-1&dir=next');
}
/* After an edit: show its undo label, then go on (or stay, with 'manual') and redraw everything from the server. */
async function spAfter(res, x) {
  const sp = S.sp;
  if (res && res.history) { updateHistoryButtons(res.history); toast(res.history.undo); }
  sp.scope = 'one';
  sp.want = sp.r.settings.advance === 'manual' ? `uid=${x.uid}` : `ord=${x.pos}&dir=next`;
  try { await refresh(true); } catch (e) { fail(e); }
}
/* Move the scope's mentions to group `target` (null: a new group, named `name` if given); a new group, or one picked with
   Other…, becomes a lane of this split. */
async function spMove(target, name = null, lane = false) {
  const sp = S.sp, x = sp.r && sp.r.item; if (!x) return;
  let res;
  try { res = await api('POST', '/api/mentions/regroup', { uids: spUids(x), target, name }); } catch (e) { fail(e); return; }
  noteRecent(res.target);
  if (lane || target == null) {
    const l = sp.lanes[sp.gid] || (sp.lanes[sp.gid] = []);
    if (res.target !== sp.gid && !l.includes(res.target)) l.push(res.target);
  }
  await spAfter(res, x);
}
/* Keep the scope's mentions where they are (remembered as confirmed) and go on, or stay with 'manual'. */
async function spKeep() {
  const sp = S.sp, x = sp.r && sp.r.item; if (!x) return;
  try { await api('POST', '/api/ppass/confirm', { uids: spUids(x) }); } catch (e) { fail(e); return; }
  spGo(sp.r.settings.advance === 'manual' ? `uid=${x.uid}` : `ord=${x.pos}&dir=next`);
}
/* The Settings popup (as the passes' settings look): skip mentions kept earlier, how to advance. Saved with the book. */
function spSettings(anchor) {
  const st = (S.sp.r && S.sp.r.settings) || { skip_kept: true, advance: 'auto' };
  pop.innerHTML = `<div class="gp pps"><div class="gpt">Split settings</div>
    <label class="chk ppsk"><input type="checkbox" data-spset="skip" ${st.skip_kept ? 'checked' : ''}> Skip mentions kept earlier
      <span class="note">kept with Enter here, in Entity-Attribution or in the Pronoun pass, and still in the group</span></label>
    <div class="gpl" style="margin-top:8px">How to advance</div>
    <div class="row"><button class="btn sm${st.advance === 'auto' ? ' primary' : ''}" data-spset="auto" title="Keep or a move also goes on to the next mention">Auto</button>
      <button class="btn sm${st.advance === 'manual' ? ' primary' : ''}" data-spset="manual" title="Keep or a move stays put; go on yourself with Next">Manual</button></div>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-spset="close">Done</button></div></div>`;
  pop.hidden = false;
  const rc = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, rc.right - pop.offsetWidth)) + 'px';
  pop.style.top = rc.bottom + 6 + 'px';
  const save = async body => {
    try {
      const s = await api('PUT', '/api/split/settings', body);
      if (S.sp.r) S.sp.r.settings = s;
      if (S.sp.gid != null) { const x = S.sp.r && S.sp.r.item; await spGo(x ? `ord=${x.pos - 1}&dir=here` : 'ord=-1&dir=next'); }
      spSettings($('#spDetail [data-spa="settings"]') || anchor);
    } catch (e) { fail(e); }
  };
  pop.onclick = e => {
    const b = e.target.closest('button[data-spset]'); if (!b) return;
    if (b.dataset.spset === 'close') closePop(); else save({ advance: b.dataset.spset });
  };
  pop.onchange = e => { if (e.target.dataset.spset === 'skip') save({ skip_kept: e.target.checked }); };
  pop.onkeydown = e => { if (e.key === 'Escape') { closePop(); e.stopPropagation(); } };
}
/* A bar button (or its key). */
async function spAct(kind, el) {
  const sp = S.sp, x = sp.r && sp.r.item;
  if (kind === 'close') { setPane('overview'); return; }
  if (kind === 'settings') { spSettings(el || $('[data-spa="settings"]')); return; }
  if (kind === 'check' && sp.r && sp.r.group) {
    try { const res = await api('PATCH', `/api/group/${sp.gid}`, { checked: !sp.r.group.checked }); if (res && res.history) updateHistoryButtons(res.history); toast(sp.r.group.checked ? 'No longer checked' : 'Marked as checked'); } catch (e) { fail(e); return; }
    await refresh(true);
    return;
  }
  if (!x) return;
  if (kind === 'keep') spKeep();
  else if (kind === 'next' || kind === 'prev') spGo(`ord=${x.pos}&dir=${kind}`);
  else if (kind === 'go') { const n = Math.round(+($('#spAt') || {}).value); if (n) spGo(`n=${Math.max(1, Math.min(n, sp.r.shown))}`); }
  else if (kind === 'new') spMove(null);
  else if (kind === 'other') {
    const n = spUids(x).length;
    groupPicker((el || $('[data-spa="other"]')).getBoundingClientRect(), { title: `Move ${n === 1 ? `“${trim(x.text, 30)}”` : `${n} mentions`} to`, okLabel: 'Move',
      exclude: [x.group], near: { a: x.s, b: x.e }, onPick: (t, name) => spMove(t, name, true) });
  }
}

/* ------------------------------------------------------------ events */
/* A click in the tab; true when it was the tab's. */
function splitClick(e) {
  const sp = S.sp;
  if (e.target.closest('[data-gact]')) return false;   // Show in text
  const g = e.target.closest('[data-spg]'); if (g) { spOpen(+g.dataset.spg); return true; }
  const sc = e.target.closest('[data-spscope]'); if (sc) { sp.scope = sc.dataset.spscope; spDraw(); return true; }
  const c = e.target.closest('[data-spc]'); if (c) { spMove(+c.dataset.spc); return true; }
  const a = e.target.closest('[data-spa]'); if (a) { spAct(a.dataset.spa, a); return true; }
  const mk = e.target.closest('#spDetail [data-eauid]');
  const x = sp.r && sp.r.item;
  if (mk && x && !window.getSelection().toString()) {   // another mention of the group: go to it; of another entity: move to it
    const uid = +mk.dataset.eauid;
    const m = [x.above, x.core, x.below].flatMap(r => r.marks).find(k => k.uid === uid);
    if (!m || uid === x.uid) return true;
    if (m.group === sp.gid) spGo(`uid=${uid}`); else spMove(m.group);
    return true;
  }
  return false;
}
/* A key in the tab (not in a field); true when it was the tab's. ← → the mentions, Enter keep, 1–9 move, N new group, G other,
   C mark as checked, Tab the next scope (only while no button or link has the keyboard focus), Esc close. */
function splitKey(k, e) {
  const sp = S.sp, x = sp.r && sp.r.item;
  if (e.key === 'Escape') { spAct('close'); return true; }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.frow')) { spOpen(+e.target.dataset.spg); return true; }
  if (k === 'c') { spAct('check'); return true; }
  if (!x) return false;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { spAct(e.key === 'ArrowRight' ? 'next' : 'prev'); return true; }
  if (e.key === 'Enter') { spKeep(); return true; }
  const at = document.activeElement;
  if (e.key === 'Tab' && (!at || at === document.body)) {
    const ks = spScopes(x).map(s => s[0]), i = ks.indexOf(sp.scope);
    sp.scope = ks[(i + (e.shiftKey ? ks.length - 1 : 1)) % ks.length];
    spDraw();
    return true;
  }
  const digit = /^Digit([1-9])$/.exec(e.code || '');
  if (digit) { const c = spChoices(x)[+digit[1] - 1]; if (c) { spMove(c.id); return true; } return false; }
  if (k === 'n') { spAct('new'); return true; }
  if (k === 'g') { spAct('other'); return true; }
  return false;
}
document.addEventListener('change', e => {   // the context size: remember it and fetch the mention again with it
  if (e.target.id !== 'spTok' || S.ch.pane !== 'split') return;
  spTokens = Math.max(0, Math.min(SP_TOKENS_MAX, Math.round(+e.target.value) || 0));
  remember('bne.spTokens', String(spTokens));
  const x = S.sp.r && S.sp.r.item;
  if (x) spGo(`uid=${x.uid}`);
});
document.addEventListener('input', e => {   // the search: a moment after typing stops, list the groups that match
  if (e.target.id !== 'spq') return;
  S.sp.q = e.target.value;
  clearTimeout(spDrawn.q);
  spDrawn.q = setTimeout(async () => {
    try {
      S.sp.list = await api('GET', `/api/split/groups?q=${encodeURIComponent(S.sp.q)}`);
      const aside = $('.cl.frl'); if (!aside) return;
      aside.outerHTML = splitAsideHTML();
      const i = $('#spq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
    } catch (err) { fail(err); }
  }, 250);
});
document.addEventListener('keydown', e => {   // Enter in the counter's box goes there
  if (e.key === 'Enter' && e.target.id === 'spAt') { e.preventDefault(); spAct('go'); }
});

/* ------------------------------------------------------------ registration (entities.js) */
Object.assign(EXTRA_PANES, {
  split: {
    label: 'Split', badge: 'bdSp', before: true, reading: true,
    html: splitPaneHTML, aside: splitAsideHTML, drawn: spDrawn, click: async e => splitClick(e), key: splitKey,
    count: () => api('GET', '/api/split/groups').then(r => r.total),
    card: n => `<button class="tool" data-pane="split"><b>${n.toLocaleString()}</b><span class="tt">Split</span><span class="td">Groups that may be more than one entity. Go through one’s mentions and move them out, in lanes and batches.</span></button>`,
  },
});
