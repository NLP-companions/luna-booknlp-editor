'use strict';
/* The Flags view (the flag icon beside Find): every flag in one list that can be filtered, searched, sorted, opened,
   edited and deleted, one at a time or by selection. The flags are fetched whenever the view is drawn (`renderFlagsView`);
   filtering, sorting and selecting only redraw the list from that copy (`S.fl.items`). How a flag is set or edited (the
   flag button and its popup) is in app.js. Everything you change here is one undoable step (`afterFlagChange`). */

/* The kinds of thing that can be flagged: [key, label, hue of the label chip]. */
const FL_KINDS = [['quotes', 'Quote', 30], ['entities', 'Mention', 210], ['groups', 'Group', 150], ['sentence', 'Sentence', 270]];
/* What the view shows: the filters (`kinds` empty = all kinds), the order, and the selected flags (keys "kind:target"). */
S.fl = { items: [], kinds: new Set(), note: 'all', src: 'all', q: '', sort: 'old', sel: new Set() };

/* A flag's key, the same "kind:target" the flag buttons use. */
const flKey = f => `${f.kind}:${f.target}`;
/* "3 days ago" for a time in seconds. */
function flAgo(ts) {
  const d = Date.now() / 1000 - ts;
  for (const [n, unit] of [[86400, 'day'], [3600, 'hour'], [60, 'minute']]) if (d >= n) { const k = Math.floor(d / n); return `${k} ${unit}${k === 1 ? '' : 's'} ago`; }
  return 'just now';
}
/* The flags that pass the filters, in the chosen order. */
function flShown() {
  const { items, kinds, note, src, q, sort } = S.fl, needle = q.trim().toLowerCase();
  const out = items.filter(f => (!kinds.size || kinds.has(f.kind))
    && (note === 'all' || (note === 'with') === !!f.note)
    && (src === 'all' || (src === 'auto') === !!f.auto)
    && (!needle || `${f.name} ${f.text ?? ''} ${f.note}`.toLowerCase().includes(needle)));
  if (sort === 'new') out.reverse();
  else if (sort === 'pos') out.sort((a, b) => (a.s ?? Infinity) - (b.s ?? Infinity) || a.created - b.created);   // groups have no place in the text: last
  return out;
}
/* One flag's row: select box, kind, what it is, the note (or "No note") with where/when, and its actions. */
function flRow(f) {
  const k = flKey(f), [, label, hue] = FL_KINDS.find(x => x[0] === f.kind);
  const main = f.kind === 'quotes' || f.kind === 'sentence' ? f.text : f.name;   // a quote or sentence is shown by its words
  const meta = [f.sent != null ? `S ${f.sent}` : null, flAgo(f.created), f.auto ? 'set by the cleanup' : null].filter(Boolean).join(' · ');
  return `<li class="frow${S.fl.sel.has(k) ? ' sel' : ''}">
    <input type="checkbox" class="fcheck" data-fsel="${k}" aria-label="Select this flag"${S.fl.sel.has(k) ? ' checked' : ''}>
    <span class="fkind" style="--h:${hue}">${label}</span>
    <div class="fbody"><div class="fmain" title="${esc(main)}">${esc(trim(main, 200))}</div>
      <div class="fsub">${f.note ? `<span class="fnote">${esc(f.note)}</span>` : '<span class="muted">No note</span>'}<span class="fmeta"> · ${meta}</span></div></div>
    <span class="facts"><button class="link" data-frow="${k}" data-fs="${f.s ?? ''}" data-fgroup="${f.kind === 'groups' ? f.target : ''}">${f.kind === 'groups' ? 'Open' : 'Show in text'}</button>
      <button class="link" data-flag="${k}">Edit</button><button class="link danger" data-fdel="${k}">Delete</button></span></li>`;
}
/* The selection bar: the tick-all box (for what is shown), the count, the offer to take every flag, and Delete. */
function flSelBar(shown) {
  const { items, sel } = S.fl, n = shown.filter(f => sel.has(flKey(f))).length, all = shown.length > 0 && n === shown.length;
  const hidden = sel.size - n;
  const msg = !sel.size ? `${shown.length.toLocaleString()} of ${items.length.toLocaleString()} shown`
    : `${sel.size.toLocaleString()} selected${hidden ? ` (${hidden.toLocaleString()} hidden by the filter)` : ''}`;
  const more = all && sel.size < items.length ? `<button class="link" data-fall>Select all ${items.length.toLocaleString()} flags</button>` : '';
  return `<input type="checkbox" class="fcheck" id="flTick" aria-label="Select all shown"${all ? ' checked' : ''}>
    <span class="fcount">${msg}</span>${more}
    ${sel.size ? `<button class="link" data-fnone>Clear selection</button><button class="btn sm danger" data-fdelsel>Delete ${sel.size.toLocaleString()}</button>` : ''}`;
}
/* Redraw the kind chips, the selection bar and the list from the loaded flags. */
function flDraw() {
  const { items, kinds, sel } = S.fl;
  sel.forEach(k => { if (!items.some(f => flKey(f) === k)) sel.delete(k); });   // flags that are gone can't stay selected
  const shown = flShown();
  const count = k => items.filter(f => f.kind === k).length;
  $('#flKinds').innerHTML = `<button type="button" data-fkind="" aria-pressed="${!kinds.size}">All <span class="badge">${items.length}</span></button>`
    + FL_KINDS.filter(([k]) => count(k)).map(([k, l]) => `<button type="button" data-fkind="${k}" aria-pressed="${kinds.has(k)}">${l} <span class="badge">${count(k)}</span></button>`).join('');
  $('#flSel').innerHTML = flSelBar(shown);
  const tick = $('#flTick'); tick.indeterminate = !tick.checked && shown.some(f => sel.has(flKey(f)));
  $('#flList').innerHTML = shown.length ? shown.map(flRow).join('') : `<li class="muted fempty">${items.length ? 'No flag matches the filters.' : 'Nothing flagged yet.'}</li>`;
}
/* The Flags view: fetch the flags and draw the filter bar, the selection bar and the list. */
async function renderFlagsView() {
  S.fl.items = (await api('GET', '/api/flags')).items;
  const f = S.fl, opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
  $('#main').innerHTML = `<div class="overview wide"><h2>Flags</h2>
    <p class="note" style="margin-top:0">Everything you marked to check on later. Flag a mention, quote, group or sentence from its side panel, its page, or the flag beside a sentence.</p>
    <div class="ftools"><div class="enav" id="flKinds"></div>
      <input type="search" id="flQ" placeholder="Search text and notes" aria-label="Search flags" value="${esc(f.q)}">
      <select id="flNote" aria-label="Notes">${opt('all', f.note, 'Any note')}${opt('with', f.note, 'With a note')}${opt('without', f.note, 'No note')}</select>
      ${f.items.some(x => x.auto) ? `<select id="flSrc" aria-label="Set by">${opt('all', f.src, 'Set by anyone')}${opt('mine', f.src, 'Set by you')}${opt('auto', f.src, 'Set by the cleanup')}</select>` : ''}
      <select id="flSort" aria-label="Order">${opt('old', f.sort, 'Oldest first')}${opt('new', f.sort, 'Newest first')}${opt('pos', f.sort, 'Book order')}</select></div>
    <div class="fselbar" id="flSel"></div><ul class="flist" id="flList"></ul></div>`;
  flDraw();
}
/* Delete the given flags in one undoable step, and redraw. */
async function flDelete(keys) {
  const items = keys.map(k => { const i = k.indexOf(':'); return { kind: k.slice(0, i), target: +k.slice(i + 1) }; });
  keys.forEach(k => S.fl.sel.delete(k));
  await afterFlagChange(await api('POST', '/api/flags/clear', { items }));
}
/* Filters, selection and row actions. Filters only redraw the list; a filter change also drops selected flags it hides. */
function flFilterChanged() { const shown = new Set(flShown().map(flKey)); S.fl.sel.forEach(k => { if (!shown.has(k)) S.fl.sel.delete(k); }); flDraw(); }
$('#main').addEventListener('click', e => {
  if (S.view !== 'flags') return;
  const t = e.target, S_ = S.fl;
  const kind = t.closest('[data-fkind]'), jump = t.closest('[data-frow]'), del = t.closest('[data-fdel]');
  if (kind) { if (kind.dataset.fkind) S_.kinds.has(kind.dataset.fkind) ? S_.kinds.delete(kind.dataset.fkind) : S_.kinds.add(kind.dataset.fkind); else S_.kinds.clear(); flFilterChanged(); }
  else if (t.closest('[data-fall]')) { S_.items.forEach(f => S_.sel.add(flKey(f))); flDraw(); }
  else if (t.closest('[data-fnone]')) { S_.sel.clear(); flDraw(); }
  else if (t.closest('[data-fdelsel]')) flDelete([...S_.sel]).catch(fail);
  else if (del) flDelete([del.dataset.fdel]).catch(fail);
  else if (jump && jump.dataset.fgroup) openGroup(+jump.dataset.fgroup);
  else if (jump && jump.dataset.fs !== '') goTo(+jump.dataset.fs).catch(fail);
});
$('#main').addEventListener('change', e => {
  if (S.view !== 'flags') return;
  const t = e.target, S_ = S.fl;
  if (t.id === 'flTick') { const shown = flShown(); shown.forEach(f => t.checked ? S_.sel.add(flKey(f)) : S_.sel.delete(flKey(f))); flDraw(); }   // ticking selects what is shown, unticking drops it
  else if (t.dataset.fsel) { tickRange(t, 'fsel', S_.sel, { num: false }); flDraw(); }
  else if (t.id === 'flNote') { S_.note = t.value; flFilterChanged(); }
  else if (t.id === 'flSrc') { S_.src = t.value; flFilterChanged(); }
  else if (t.id === 'flSort') { S_.sort = t.value; flDraw(); }
});
$('#main').addEventListener('input', e => { if (S.view === 'flags' && e.target.id === 'flQ') { S.fl.q = e.target.value; flFilterChanged(); } });
