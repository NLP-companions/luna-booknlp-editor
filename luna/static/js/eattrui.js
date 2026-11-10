'use strict';
/* The Entity-Attribution view: one entity mention at a time, the sentence it sits in large with the entity on the left, and the
   text above and below it (the left column empty, so the text lines up). Every mention in the text is marked as in the
   annotation view: coloured, with a small label (type and entity) above it; the current one is bold. ← and → move through
   the mentions of the book in reading order. The tool bar is the pass engine's (`makePass`, passui.js), like the
   Speaker-Attribution view's (qfocusui.js, whose layout and sizing this file reuses): the number keys are the groups you pinned
   for moving mentions (the same keys 1–9 as in the annotation view), the free ones take the suggestions (nearby groups of the
   mention's own type). The side panel is the annotation view's panel for the selected entity (renderPanel in app.js: this
   file only selects the mention). Moving a mention shares the Pronoun pass's `confirmed` list (`MENTION_TOOL`). */

/* How much context is shown, in tokens each side, unless you chose otherwise. */
const EA_TOKENS_DEFAULT = 120;
/* The context size in tokens each side, as chosen (saved in this browser). */
let eaTokens = storedNumber('bne.eaTokens', EA_TOKENS_DEFAULT, 0, QF_TOKENS_MAX);
/* The labels of the mention types (the `prop` of an entity). */
const EA_PROPS = { PROP: 'Names', NOM: 'Nouns', PRON: 'Pronouns' };

S.ea = null;
/* What the view is limited to: an entity (a group id or 'all'), a mention type and an entity type (a value or 'all'). */
let eaGroup = 'all', eaProp = 'all', eaCat = 'all';
/* The Entity-Attribution view: every mention of the book (or the filtered ones) in reading order; moving one gives it to
   another entity (and remembers it as confirmed). */
const ENTITY_ATTR = makePass({
  key: 'ea', kind: 'eattr', name: 'Entity-Attribution', noun: 'mentions', view: 'eattr', reading: true, layer: 'entities',
  reasons: {}, skips: [], presets: {},
  settingsTitle: 'Whether entities are suggested and how to advance',
  at: x => x.pos,
  startQuery: ref => `tok=${ref}`,
  focus: x => x.group,
  chip: c => c.pinned ? 'Pinned to this key' : `Nearby: ${c.reason}`,
  question: x => `“<b>${esc(trim(x.text, 60))}</b>” is in <span class="sw" style="--h:${hue(x.group)}"></span><b>${esc(trim(x.group_name, 24))}</b> <span class="num">${esc(x.cat)} · ${esc(EA_PROPS[x.prop] || x.prop)}</span>`,
  choices: eaChoices,
  extraSettings: st => `<label class="chk ppsk"><input type="checkbox" data-easug ${st.suggest ? 'checked' : ''}> Suggest entities
    <span class="note">${st.suggest ? 'nearby groups of the mention’s type, on the keys you have not pinned' : 'off: only your pinned keys and Other…'}</span></label>`,
  readSettings: pop => ({ suggest: !!pop.querySelector('[data-easug]:checked') }),
  ...MENTION_TOOL,
  fetch: eaFetch,
  saveSettings: body => api('PUT', '/api/eattr/settings', body),
  barHost: () => $('#eaBar'),
  draw: drawEAttr,
  leave: eaGiveBackSelection,
});

/* The side panel shows the selected entity, so this view selects each mention (`eaMine` is the selection it made, `eaBefore` the one the
   page had). Leaving the view gives the old selection back unless something else has selected since (Show in text), so the
   other views, which start from the selection, don't start where this one stopped. */
let eaMine = null, eaBefore;
/* Give the page its old selection back (called when the view is left). */
function eaGiveBackSelection() {
  if (eaBefore !== undefined && S.sel === eaMine) S.sel = eaBefore;
  eaMine = null; eaBefore = undefined;
}

/* Fetch a mention with the view's filters and context size. If the one asked for by uid is gone (deleted in the side panel),
   show the one that took its place instead. */
async function eaFetch(q) {
  const get = q => api('GET', `/api/eattr?${q}&tokens=${eaTokens}&group=${eaGroup}&prop=${eaProp}&cat=${eaCat}`);
  try { return await get(q); } catch (e) {
    const x = S.ea && S.ea.cur;
    if (!q.startsWith('uid=') || !x) throw e;
    return get(`ord=${x.pos - 1}&dir=here`);
  }
}
/* The choices for the number keys: the groups pinned to keys 1–9 stay on their keys; the free keys, in order, take the
   suggestions (so with nothing pinned, the suggestions are on 1, 2, …). */
function eaChoices(x) {
  const sug = x.candidates.slice(), out = [];
  for (const k of '1234567890') {
    const pin = S.hotkeys[k];
    if (pin) out.push({ id: pin.id, name: pin.name, key: k, pinned: true });
    else if (sug.length) out.push({ ...sug.shift(), key: k });
  }
  return out;
}

/* The view was opened: start the walk (at the selected word, else the first mention on the page), or draw what it has. */
function renderEAttr() {
  if (S.ea) { drawEAttr(); return; }
  $('#main').innerHTML = '<p class="muted" style="padding:14px">Loading…</p>';
  ENTITY_ATTR.start();
}

/* ------------------------------------------------------------ the text with its mentions */
/* Words a..b of a region as HTML with its mentions marked. The mentions are clipped to the paragraph and nested inside each
   other (a mention that would cross the end of the one it starts in is cut there). `cur` is the uid of the mention being
   attributed. */
function eaParagraph(reg, a, b, cur) {
  const lo = reg.start;
  const marks = reg.marks.filter(m => m.s <= b && m.e >= a)
    .map(m => ({ ...m, a: Math.max(m.s, a), b: Math.min(m.e, b), kids: [] })).sort((p, q) => p.a - q.a || q.b - p.b);
  const root = { a, b, kids: [] }, stack = [root];
  for (const m of marks) {
    while (stack.length > 1 && stack[stack.length - 1].b < m.a) stack.pop();
    const top = stack[stack.length - 1];
    m.b = Math.min(m.b, top.b);
    top.kids.push(m); stack.push(m);
  }
  // how many mentions are nested inside each one: its label is stacked above theirs
  const depth = n => n.lv = n.kids.reduce((d, k) => Math.max(d, depth(k) + 1), 0);
  depth(root);
  const gap = o => o > a && reg.space[o - lo] ? ' ' : '';
  /* [from..to] inside `node`; the space before its first word is for the caller to put */
  const emit = (node, from, to) => {
    let h = '', o = from;
    const plain = (x, y) => { for (let i = x; i <= y; i++) h += (i > from ? gap(i) : '') + esc(reg.words[i - lo]); };
    for (const k of node.kids) {
      plain(o, k.a - 1);
      const label = k.a === k.s ? `<span class="eml">${esc(k.cat)} ${esc(trim(k.group_name, 16))}</span>` : '';
      h += `${k.a > from ? gap(k.a) : ''}<span class="em${k.uid === cur ? ' cur' : ''}${k.a === k.s ? '' : ' mid'}" data-eauid="${k.uid}" style="--h:${hue(k.group)};--lv:${k.lv}" title="${esc(k.group_name)} · ${esc(k.cat)} · ${esc(EA_PROPS[k.prop] || k.prop)}">${label}${emit(k, k.a, k.b)}</span>`;
      o = k.b + 1;
    }
    plain(o, to);
    return h;
  };
  return emit(root, a, b);
}
/* A region as one `.qfrow` per paragraph: the left column (where the Speaker-Attribution view names the speaker) is `left`. */
function eaRows(reg, cur, left = '') {
  if (!reg.words.length) return '';
  const cuts = [0, ...reg.brk, reg.words.length];
  return cuts.slice(0, -1).map((c, i) =>
    `<div class="qfrow"><span class="qfwho">${i ? '' : left}</span><span class="qftxt eatxt">${eaParagraph(reg, reg.start + c, reg.start + cuts[i + 1] - 1, cur)}</span></div>`).join('');
}

/* The mention type and entity type filters; the entity filter is a button (a book can have thousands of entities). */
function eaFilterHTML(r) {
  const opt = (v, cur, text) => `<option value="${v}"${String(cur) === v ? ' selected' : ''}>${text}</option>`;
  const g = eaGroup === 'all' ? null : S.clusterById.get(+eaGroup);
  return `<span class="eagroup">${g ? `<span class="sw" style="--h:${hue(g.id)}"></span><b>${esc(trim(g.name, 24))}</b><button class="link" data-eaclear title="Walk all entities again">✕</button>` : ''}
      <button class="btn sm" data-eapick title="Walk only the mentions of one entity">${g ? 'Change…' : 'All entities…'}</button></span>
    <select id="eaProp" aria-label="Mention type">${opt('all', eaProp, `All mention types (${r.total})`)}${Object.entries(EA_PROPS).map(([k, l]) => opt(k, eaProp, `${l} (${r.props[k] || 0})`)).join('')}</select>
    <select id="eaCat" aria-label="Entity type">${opt('all', eaCat, 'All entity types')}${Object.entries(r.cats).sort((a, b) => b[1] - a[1]).map(([k, n]) => opt(k, eaCat, `${esc(k)} (${n})`)).join('')}</select>`;
}
/* Draw the whole view: the tool bar, the filters and context size, the context above, the sentence with the entity on the left, the context below. */
function drawEAttr() {
  if (S.view !== 'eattr' || !S.ea) return;
  const x = S.ea.cur;
  const filtered = eaGroup !== 'all' || eaProp !== 'all' || eaCat !== 'all';
  const left = x ? `<span class="spchip" style="--h:${hue(x.group)}" title="${esc(x.group_name)}">${esc(trim(x.group_name, 18))}</span><div class="qfnar">${esc(x.cat)} · ${esc(EA_PROPS[x.prop] || x.prop)}</div>` : '';
  $('#main').innerHTML = `<div class="qf ea" id="ea"><div class="banner qfbar" id="eaBar"></div>
    <div class="qftools">${eaFilterHTML(S.ea.r)}<label>Context <input id="eaTok" type="number" min="0" max="2000" step="10" value="${eaTokens}" aria-label="Tokens of context above and below"> tokens each side</label>
      <span class="muted">← → move through the mentions</span><span class="grow"></span><button class="link" data-eashow ${x ? '' : 'disabled'}>Show in text</button></div>
    ${x ? `<div class="qftop"><section class="qfctx qfabove" id="eaAbove"><div class="qfin">${eaRows(x.above, x.uid)}</div></section>
      <section class="qfcore" id="eaCore" style="--h:${hue(x.group)}"><div class="qfin">${eaRows(x.core, x.uid, left)}</div></section></div>
      <section class="qfctx qfbelow" id="eaBelow"><div class="qfin">${eaRows(x.below, x.uid)}</div></section>`
    : `<p class="muted" style="padding:14px">${filtered ? 'No mentions match these filters.' : 'This book has no entity mentions.'}</p>`}</div>`;
  if (x) ENTITY_ATTR.bar();
  fitReading('ea');
  if (eaBefore === undefined) eaBefore = S.sel;   // the selection the page had before this view took it over
  eaMine = S.sel = x ? { kind: 'span', layer: 'entities', uid: x.uid, s: x.s, e: x.e } : null;   // the side panel shows the selected entity
  renderPanel();
}
window.addEventListener('resize', () => { clearTimeout(drawEAttr.t); drawEAttr.t = setTimeout(() => fitReading('ea'), 80); });

/* ------------------------------------------------------------ events of the view */
/* Walk again from the current mention on, after a filter changed. */
function eaRestart() {
  const x = S.ea.cur;
  ENTITY_ATTR.go(x ? `ord=${x.pos - 1}&dir=here` : 'ord=-1&dir=next', false).catch(fail);
}
document.addEventListener('change', e => {
  if (!S.ea || S.view !== 'eattr') return;
  if (e.target.id === 'eaProp') { eaProp = e.target.value; eaRestart(); }
  else if (e.target.id === 'eaCat') { eaCat = e.target.value; eaRestart(); }
  else if (e.target.id === 'eaTok') {   // the context size: remember it and fetch the current mention again with it
    eaTokens = Math.max(0, Math.min(QF_TOKENS_MAX, Math.round(+e.target.value) || 0));
    remember('bne.eaTokens', String(eaTokens));
    const x = S.ea.cur;
    ENTITY_ATTR.go(x ? `uid=${x.uid}` : 'ord=-1&dir=next', false).catch(fail);
  }
});
document.addEventListener('click', e => {
  if (!S.ea || S.view !== 'eattr') return;
  const x = S.ea.cur;
  if (e.target.closest('[data-eapick]')) {
    groupPicker(e.target.closest('[data-eapick]').getBoundingClientRect(), { title: 'Walk only the mentions of', allowNew: false, pins: false,
      onPick: t => { eaGroup = String(t); eaRestart(); } });
  } else if (e.target.closest('[data-eaclear]')) { eaGroup = 'all'; eaRestart(); }
  else if (e.target.closest('[data-eashow]') && x) goTo(x.s, async () => { await selectSpan('entities', x.uid); }, x.e).catch(fail);   // leave the view for the mention in the text
  else {   // a mention in the text: go to it
    const m = e.target.closest('[data-eauid]');
    if (m && !window.getSelection().toString()) ENTITY_ATTR.go(`uid=${m.dataset.eauid}`, false).catch(fail);
  }
});
