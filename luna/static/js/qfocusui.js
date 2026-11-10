'use strict';
/* The Speaker-Attribution view: one quote at a time, large, with its attribution (the words just before and after it) and the text
   around it above and below. A margin beside each context passage names its speaker (a person, or the Narrator), and it is
   fetched again with every attribution, so it always shows who speaks now. ← and → move through all the quotes of the book
   in reading order. The tool bar is the Quote pass's (same keys, same settings: speaker keys, suggestions, how to advance);
   this view keeps its own position and ignores the pass's skip rules (you can limit it to one speaker's quotes). The side
   panel shows the current speaker as an entity (renderPanel in app.js hands over to `renderQFPanel`). It is a third use of the pass engine (`makePass`,
   passui.js): the engine draws the bar, this file draws everything around it. */

/* How much context is shown, in tokens each side, unless you chose otherwise. */
const QF_TOKENS_DEFAULT = 120, QF_TOKENS_MAX = 2000;   // the server's CONTEXT_MAX (core/tools/focus.py)
/* The context size in tokens each side, as chosen (saved in this browser). */
let qfTokens = storedNumber('bne.qfTokens', QF_TOKENS_DEFAULT, 0, QF_TOKENS_MAX);
/* The quote's own font size: as large as fits (px), down to this; the context is never larger than QF_CONTEXT_RATIO of it. */
const QF_QUOTE_PX = 30, QF_MIN_PX = 9, QF_CONTEXT_RATIO = 0.85;

S.qf = null;
/* The speaker the view is limited to: a group id, 'none' (no speaker) or 'all'. */
let qfSpeaker = 'all';
/* The Speaker-Attribution view: every quote of the book (or one speaker's) in reading order; moving one gives it a speaker
   (and remembers it as confirmed). */
const QUOTE_FOCUS = makePass({
  ...QUOTE_TOOL,
  key: 'qf', kind: 'qfocus', name: 'Speaker-Attribution', view: 'qfocus', reading: true,
  reasons: {}, skips: [], presets: {},
  settingsTitle: 'The speaker keys and how to advance',
  focus: x => x.speaker,
  fetch: q => api('GET', `/api/qfocus?${q}&tokens=${qfTokens}&speaker=${qfSpeaker}`),
  barHost: () => $('#qfBar'),
  draw: drawQFocus,
});

/* The view was opened: start the walk (at the selected quote, else the first one on the page), or draw what it has. */
function renderQFocus() {
  if (S.qf) { drawQFocus(); return; }
  $('#main').innerHTML = '<p class="muted" style="padding:14px">Loading…</p>';
  QUOTE_FOCUS.start();
}

/* The marks in the text: the speaker mention of the quote (BookNLP's), in bold. Each is {s, e, speaker, title, cls}; `cls` ' sug'
   draws a suggested one dashed (the Speaker suggestions page adds that). */
function qfMarks(x) {
  return x.mention ? [{ s: x.mention.s, e: x.mention.e, speaker: x.speaker, title: 'BookNLP’s speaker mention', cls: '' }] : [];
}
/* Passages as running text: words with the book's own spacing; the words inside a mark in bold, in its speaker's colour. */
function qfProse(passages, marks) {
  const hl = (o, h) => {
    const m = marks.find(k => o >= k.s && o <= k.e);
    return m ? `<b class="spk${m.cls}" style="--h:${hue(m.speaker ?? 0)}" title="${m.title}">${h}</b>` : h;
  };
  return passages.map(p => p.words.map((w, i) => `${i && p.space[i] ? ' ' : ''}${hl(p.start + i, esc(w))}`).join('')).join(' ');
}
/* Who a passage belongs to, shown in the margin: the speaker of a quote, or the Narrator. */
function qfWho(p) {
  if (p.kind === 'narration') return '<span class="qfnar">Narrator</span>';
  return p.speaker != null ? `<span class="spchip" style="--h:${hue(p.speaker)}" title="${esc(p.name)}">${esc(trim(p.name, 18))}</span>` : '<span class="spchip none">No speaker</span>';
}
/* The context above or below: a row per passage, the speaker in the margin and the text beside it. */
function qfRows(passages, marks) {
  return passages.map(p => `<div class="qfrow ${p.kind}" style="--h:${hue(p.speaker ?? 0)}"><span class="qfwho">${qfWho(p)}</span><span class="qftxt">${qfProse([p], marks)}</span></div>`).join('');
}
/* The reading area of quote `x` (a reply item of /api/qfocus): the context above and the quote with its attribution
   (`who`: the margin beside it) in the top half, the context below in the bottom half. Shared with the Speaker suggestions page. */
function qfReading(x, marks, who) {
  return `<div class="qftop"><section class="qfctx qfabove" id="qfAbove"><div class="qfin">${qfRows(x.above, marks)}</div></section>
      <section class="qfcore" id="qfCore" style="--h:${hue(x.speaker ?? 0)}"><div class="qfin qfrow">
        <span class="qfwho">${who}</span>
        <div>${x.before.length ? `<p class="qfattr">${qfProse(x.before, marks)}</p>` : ''}
          <blockquote class="qfquote">${qfProse([x.quote], marks)}</blockquote>
          ${x.after.length ? `<p class="qfattr">${qfProse(x.after, marks)}</p>` : ''}</div></div></section></div>
    <section class="qfctx qfbelow" id="qfBelow"><div class="qfin">${qfRows(x.below, marks)}</div></section>`;
}

/* The speaker filter, as in the Quotes view: all speakers, no speaker, or one (with the number of quotes). */
function qfFilterHTML(r) {
  const sel = v => String(qfSpeaker) === String(v) ? ' selected' : '';
  return `<select id="qfSpk" aria-label="Speaker"><option value="all">All speakers (${r.total})</option>
    <option value="none"${sel('none')}>No speaker (${r.no_speaker})</option>
    ${r.speakers.map(x => `<option value="${x.id}"${sel(x.id)}>${esc(x.name)} (${x.n})</option>`).join('')}</select>`;
}
/* Draw the whole view: the Quotes tabs, the tool bar, the context settings, the context above, the quote with its attribution (and its current speaker on the left), the context below. */
function drawQFocus() {
  if (S.view !== 'qfocus' || !S.qf) return;
  const x = S.qf.cur;
  $('#main').innerHTML = `<div class="qf qsq" id="qf">${quotesNav('focus')}<div class="banner qfbar" id="qfBar"></div>
    <div class="qftools">${qfFilterHTML(S.qf.r)}<label>Context <input id="qfTok" type="number" min="0" max="2000" step="10" value="${qfTokens}" aria-label="Tokens of context above and below"> tokens each side</label>
      <span class="muted">← → move through the quotes</span><span class="grow"></span><button class="link" data-qfshow ${x ? '' : 'disabled'}>Show in text</button></div>
    ${x ? qfReading(x, qfMarks(x), qfWho(x.quote))
    : `<p class="muted" style="padding:14px">${qfSpeaker === 'all' ? 'This book has no quotes.' : 'No quotes for this speaker.'}</p>`}</div>`;
  if (x) QUOTE_FOCUS.bar();
  fitReading('qf');
  renderPanel();
}

/* Make the text fit (the Speaker-Attribution view and the Speaker suggestions page, prefix 'qf'; the Entity-Attribution view uses it with 'ea'): the core as large as the space
   allows (up to QF_QUOTE_PX), then the context above and below, never larger than the core. */
function fitReading(prefix) {
  const core = $(`#${prefix}Core`); if (!core) return;
  // shrink `box`'s content (its first child) one pixel at a time from `max` until it fits the box
  const fit = (box, max) => {
    const el = box.firstElementChild;
    let px = max;
    el.style.fontSize = px + 'px';
    while (px > QF_MIN_PX && el.offsetHeight > box.clientHeight) el.style.fontSize = --px + 'px';
    return px;
  };
  const q = fit(core, QF_QUOTE_PX);
  const ctx = Math.floor(q * QF_CONTEXT_RATIO);
  fit($(`#${prefix}Above`), ctx); fit($(`#${prefix}Below`), ctx);
}
window.addEventListener('resize', () => { clearTimeout(fitReading.t); fitReading.t = setTimeout(() => fitReading('qf'), 80); });

/* A speaker was chosen in the filter: walk only their quotes, from the current place on. */
document.addEventListener('change', e => {
  if (e.target.id !== 'qfSpk' || !S.qf) return;
  qfSpeaker = e.target.value;
  const x = S.qf.cur;
  QUOTE_FOCUS.go(`ord=${x ? x.s - 1 : -1}&dir=next`, false).catch(fail);
});
/* Set the context size (in tokens each side, kept within bounds) and remember it in this browser; the Speaker suggestions page shares it. */
function setQfTokens(v) {
  qfTokens = Math.max(0, Math.min(QF_TOKENS_MAX, Math.round(+v) || 0));
  remember('bne.qfTokens', String(qfTokens));
}
/* The context size was changed: remember it and fetch the current quote again with it. */
document.addEventListener('change', e => {
  if (e.target.id !== 'qfTok' || !S.qf) return;
  setQfTokens(e.target.value);
  const x = S.qf.cur;
  QUOTE_FOCUS.go(x ? `uid=${x.uid}` : 'ord=-1&dir=next', false).catch(fail);
});
/* "Show in text": leave the view for the quote in the annotation view. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-qfshow]'); if (!b || !S.qf || !S.qf.cur) return;
  const x = S.qf.cur;
  goTo(x.s, async () => { await selectSpan('quotes', x.uid); }).catch(fail);
});

/* ------------------------------------------------------------ side panel */
/* The quote the side panel is about: the Speaker-Attribution view's, or the suggestion shown on the Speaker suggestions page;
   on the Fragments page (fragui.js) the current fragment and on the Split page (splitui.js) the group being split, in the
   same shape, the group as the `speaker` (null elsewhere). */
function qfCur() {
  if (S.view === 'qfocus') return S.qf && S.qf.cur;
  if (S.view === 'chars' && S.ch.pane === 'fragments') return S.ch.fr.panel;
  if (S.view === 'chars' && S.ch.pane === 'split') return S.sp.panel;
  return S.view === 'quotes' && S.qv.pane === 'sug' ? S.qv.sqCur : null;
}
/* Whether the panel shows an entity of a page that has these panels (so leaving that page draws the usual panel again). */
let qfPanelOn = false;
/* Called when the page changes: after leaving such a page, the panel shows the selection again instead of that entity. */
function qfPanelLeft() {
  if (qfPanelOn && !qfCur()) { qfPanelOn = false; renderPanel(); }
}
/* Which draw of the panel is the latest, so a slow answer can't overwrite a newer one. */
let qfPanelSeq = 0;
/* The last "Possibly the same as" list drawn, {id: the speaker, html}, shown again at once while it is fetched anew. */
let qfSame = { id: null, html: '' };
/* The side panel (also on the Speaker suggestions page): the speaker of the current quote as an entity: its name, pronouns and counts, merging it into another,
   a new entity from the speaker mention, opening it in Entities, its names, and groups it may be the same as (filled in
   when the view has been still for a moment: working them out after an edit takes the server a second on a long book). */
async function renderQFPanel() {
  const panel = $('#panel'), seq = ++qfPanelSeq, x = qfCur();
  qfPanelOn = true;
  if (!x) { panel.innerHTML = '<p class="muted">No quote to show.</p>'; return; }
  const mention = x.mention && x.mention.uid != null ? `<button class="btn" data-qfp="new" title="Move the speaker mention “${esc(x.mention.text)}” into a new entity, which then speaks this quote">New entity…</button>` : '';
  if (x.speaker == null) {
    panel.innerHTML = `<h2>No speaker</h2><div class="sub">This quote has no speaker yet.</div>
      <p class="note">Choose one with the number keys or Other… in the bar.</p>`;
    return;
  }
  try {
    const d = await api('GET', `/api/group/${x.speaker}?limit=1`);
    if (seq !== qfPanelSeq || qfCur() !== x) return;
    const cats = Object.keys(d.cats).length > 1 ? Object.entries(d.cats).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)} ${n}`).join(', ') : esc(d.cat);
    const names = d.variants.slice(0, 15).map(v => `<tr><td class="v">${esc(v.text)}</td><td class="t">${v.prop}</td><td class="num">${v.n}</td></tr>`).join('');
    panel.innerHTML = `<div class="dhead"><span class="sw big" style="--h:${hue(d.id)}"></span>
        <input class="nameinput" data-qfp="name" value="${esc(d.name)}" placeholder="${esc(d.auto_name)}" aria-label="Entity name"></div>
      <div class="sub">Entity ${d.id} · ${cats}${d.named ? ` · BookNLP’s name: ${esc(d.auto_name)}` : ''}</div>
      <div class="facts"><label>Pronouns <input list="dl-pronouns" data-qfp="pron" value="${esc(d.pronoun || '')}" placeholder="not set"></label>
        <span>${d.total} mentions</span><span>${d.quotes} quotes</span>
        ${d.hidden ? '<span class="note">Not a character</span>' : ''}
        <button class="btn sm ${d.checked ? 'okbtn' : ''}" data-qfp="check">${d.checked ? '✓ Checked' : 'Mark as checked'}</button></div>
      <div class="row" style="margin:10px 0 4px"><button class="btn" data-qfp="merge">Merge into…</button>${mention}
        <button class="btn" data-qfp="open">Open in Entities</button></div>
      <h3>Names and references <span class="num">${d.variants.length}</span></h3>
      <div class="tablewrap"><table class="vt">${names}</table></div>
      <div id="qfSame">${qfSame.id === d.id ? qfSame.html : ''}</div>`;
    whenIdle('qfSame', async () => {
      const sug = await api('GET', `/api/merge-suggestions?group=${d.id}&limit=5`);
      const el = $('#qfSame'); if (!el || seq !== qfPanelSeq) return;
      const same = sug.items.map(p => {
        const other = p.a.id === d.id ? p.b : p.a;
        return `<li>${groupChip(other)}<span class="gmr">${p.reasons.map(r => `<span class="${r.w >= 0 ? 'pos' : 'neg'}">${esc(r.text)}</span>`).join(' · ')}</span>
          <button class="btn sm" data-qfp="same" data-other="${other.id}">Merge</button></li>`;
      }).join('');
      qfSame = { id: d.id, html: same ? `<h3>Possibly the same as</h3><ul class="gmlist">${same}</ul>` : '' };
      el.innerHTML = qfSame.html;
    });
  } catch { /* the speaker's group is gone (just merged): keep what is shown, the redraw with the quote's new speaker follows */ }
}
/* Edits in the panel (name, pronouns): save, then redraw from the server. */
$('#panel').addEventListener('change', e => {
  const k = e.target.dataset.qfp, x = qfCur();
  if (!x || x.speaker == null || (k !== 'name' && k !== 'pron')) return;
  charsDo(() => api('PATCH', `/api/group/${x.speaker}`, k === 'name' ? { name: e.target.value } : { pronoun: e.target.value }));
});
/* Buttons in the panel. */
$('#panel').addEventListener('click', e => {
  const b = e.target.closest('[data-qfp]'), x = qfCur();
  if (!b || !x || b.tagName === 'INPUT') return;
  const id = x.speaker, rect = b.getBoundingClientRect();
  switch (b.dataset.qfp) {
    case 'open': openGroup(id); break;
    case 'check': charsDo(() => api('PATCH', `/api/group/${id}`, { checked: !(S.clusterById.get(id) || {}).checked })); break;
    case 'merge':
      groupPicker(rect, { title: `Merge “${trim(x.speaker_name, 24)}” into`, allowNew: false, exclude: [id], near: { a: x.s, b: x.e },
        onPick: t => charsDo(() => api('POST', '/api/groups/merge', { target: t, sources: [id] })) });
      break;
    case 'same': {   // the bigger group keeps its number, as on the group page
      const other = +b.dataset.other, keepThis = ((S.clusterById.get(id) || {}).count || 0) >= ((S.clusterById.get(other) || {}).count || 0);
      charsDo(() => api('POST', '/api/groups/merge', keepThis ? { target: id, sources: [other] } : { target: other, sources: [id] }));
      break;
    }
    case 'new':
      groupPicker(rect, { title: `New entity for “${x.mention.text}”, which then speaks this quote`, okLabel: 'Create', exclude: [id], near: { a: x.mention.s, b: x.mention.e },
        onPick: (t, name) => charsDo(() => api('POST', '/api/mentions/regroup', { uids: [x.mention.uid], target: t, name })) });
      break;
  }
});
