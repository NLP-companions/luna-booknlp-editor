'use strict';
/* The Fragments tool in Entities: small groups (fragments) to assign to the entity they belong to.

   While it is open, the Entities tab's left column lists the fragments (reading order, the top candidate of each) instead of
   the groups. The middle looks and works like the Speaker-Attribution view (qfocusui.js), whose classes and reading layout it
   reuses: a tool bar (the fragment, Keep ↵, its candidates on the number keys, Other… G, ‹ ← / Skip →, Not a character H,
   Delete D, Settings, Close Esc; under it "Also called …" or, after an assign, the offer), a slim strip with the context size,
   and the reading area: one of the fragment's mentions at a time (↑ ↓ step through them), its sentence large on the centre
   line with the fragment's chip on the left, as many tokens of text above and below as you set (saved in this browser), every
   mention marked as in the Entity-Attribution view (`eaRows`, eattrui.js). The text sizes itself to the space (`fitReading`).
   The side panel shows the fragment as an entity (the Speaker-Attribution panel, `renderQFPanel`, through `qfCur`).

   Assigning: a number key, a candidate chip, a marked entity in the text, the speaker of the quote the mention is in, or a
   group in "Also called" assign the whole fragment; with Shift held, only the mention shown (split off; the fragment stays,
   and Settings decides whether the tool goes on to the next fragment or stays on this one). After a whole fragment is
   assigned, the other fragments with one of its names are offered for the same group (`offer`; Y assigns the ticked ones
   in one step, Esc says no).

   Speed: the list comes in pages of FR_PAGE (`/api/fragments`), one fragment's details on their own (`/api/fragment/{id}`),
   and the next fragment's are fetched ahead. Moving through the list redraws only the list and the middle. After an edit the
   fragment leaves the list, the next one (fetched ahead) is shown at once, and then everything is loaded again (`refresh`),
   which also replaces what was fetched ahead before the edit. */

/* How much text is shown above and below the mention's sentence, in tokens, unless you chose otherwise; at most the server's
   FRAGMENT_CONTEXT_MAX (core/tools/coref.py). */
const FR_TOKENS_DEFAULT = 120, FR_TOKENS_MAX = 500;
/* How many fragments the list fetches at a time. */
const FR_PAGE = 50;
/* The context size in tokens, as chosen (saved in this browser). */
let frTokens = storedNumber('bne.frTokens', FR_TOKENS_DEFAULT, 0, FR_TOKENS_MAX);
/* After a mention is split off: 'auto' goes on to the next fragment, 'manual' stays on this one (saved in this browser). */
let frAdvance = stored('bne.frAdvance') === 'manual' ? 'manual' : 'auto';
/* The tool's state: the list page shown (`page`, fetched for `key`), details fetched by `${id}|${size}|${tokens}` (`details`:
   promises; `done`: those that arrived); the mention shown (`at`, its index in the details); the fragment to show after the
   next reload (`goId`: after a split the fragment may move in the list, as its first mention may be gone); the offer to assign same-name
   fragments too (`offer`, see `frOfferFor`); what the side panel shows (`panel`) and the group of every mention marked in the
   text (`markGroup`, uid → group). `S.ch.fskip` is the current fragment's place in the whole list, `S.ch.frag` its details
   (set with `frSet`). */
S.ch.fr = { page: null, key: '', details: new Map(), done: new Map(), at: 0, goId: null, offer: null, panel: null, markGroup: new Map() };
/* The labels of the mention types (the `prop` of an entity). */
const FR_PROPS = { PROP: 'name', NOM: 'noun', PRON: 'pronoun' };

/* ------------------------------------------------------------ data */
/* The list page holding place `i`, fetched unless it is the one we have (or `force`). */
async function frPage(i, force = false) {
  const ch = S.ch, fr = ch.fr, off = Math.floor(Math.max(0, i) / FR_PAGE) * FR_PAGE, key = `${ch.fsize}|${ch.fcat}|${off}`;
  if (force || !fr.page || fr.key !== key) {
    const p = await api('GET', `/api/fragments?size=${ch.fsize}&cat=${encodeURIComponent(ch.fcat)}&offset=${off}&limit=${FR_PAGE}`);
    fr.page = { ...p, offset: off }; fr.key = key;
  }
  return fr.page;
}
/* The list row of the current fragment (null when there is none). */
function frItem() {
  const ch = S.ch, p = ch.fr.page;
  return p ? p.items[ch.fskip - p.offset] || null : null;
}
/* A fragment's details (a promise), fetched once per context size. */
function frDetail(id) {
  const fr = S.ch.fr, k = `${id}|${S.ch.fsize}|${frTokens}`;
  if (!fr.details.has(k)) {
    fr.details.set(k, api('GET', `/api/fragment/${id}?size=${S.ch.fsize}&tokens=${frTokens}`)
      .then(d => { fr.done.set(k, d); return d; }, e => { fr.details.delete(k); throw e; }));
  }
  return fr.details.get(k);
}
/* The details of the fragment after the current one if they have already arrived, else null. */
function frNextReady() {
  const ch = S.ch, p = ch.fr.page, f = p && p.items[ch.fskip - p.offset + 1];
  return f ? ch.fr.done.get(`${f.id}|${ch.fsize}|${frTokens}`) || null : null;
}
/* Forget every fetched detail (after an edit they may be out of date). */
function frForget() { S.ch.fr.details.clear(); S.ch.fr.done.clear(); }
/* Make `d` the current fragment's details: the mention shown stays the same only while it is the same fragment; the side panel
   is drawn for it. */
function frSet(d) {
  const fr = S.ch.fr, old = S.ch.frag;
  if (!d || !old || d.id !== old.id || fr.at >= d.mentions.length) fr.at = 0;
  S.ch.frag = d;
  fr.markGroup = new Map(d ? d.mentions.flatMap(m => [m.above, m.core, m.below].flatMap(r => r.marks.map(x => [x.uid, x.group]))) : []);
  fr.panel = d ? { speaker: d.id, speaker_name: d.name, s: d.mentions[0].s, e: d.mentions[0].e, mention: null } : null;
  renderPanel();
}
/* Fetch the next fragment's details ahead, so → shows it at once. */
function frPrefetch() {
  const ch = S.ch, p = ch.fr.page, f = p && p.items[ch.fskip - p.offset + 1];
  if (f) frDetail(f.id).catch(() => { });
}

/* ------------------------------------------------------------ drawing */
/* The Fragments pane as `renderChars` draws it: everything fetched again (an edit or a filter may have changed it). */
async function fragPaneHTML() {
  const ch = S.ch;
  frForget();
  let p = await frPage(ch.fskip, true);
  const k = ch.fr.goId != null ? p.items.findIndex(f => f.id === ch.fr.goId) : -1;
  if (k >= 0) ch.fskip = p.offset + k;
  ch.fr.goId = null;
  if (p.total && ch.fskip >= p.total) { ch.fskip = p.total - 1; p = await frPage(ch.fskip, true); }
  const f = frItem();
  frSet(f ? await frDetail(f.id) : null);
  frPrefetch();
  return frPaneInner();
}
/* The middle: the bar, the context strip and the reading area of the mention shown, or what to do when there is no fragment. */
function frPaneInner() {
  const d = S.ch.frag;
  if (!d) {
    return `<div class="qf fr" id="frDetail"><div class="banner qfbar"><div class="ppbar"><span class="pph"><b>Fragments</b></span>
      <span>No fragments left with these settings. Groups you keep are marked as checked and don’t come back.</span>
      <span class="ppa"><button class="btn sm" data-fa="settings">Settings</button><button class="btn sm" data-fa="close">Close <kbd>Esc</kbd></button></span></div></div></div>`;
  }
  const m = d.mentions[S.ch.fr.at];
  const left = `<span class="spchip" style="--h:${hue(d.id)}" title="${esc(d.name)} (group #${d.id})">${esc(trim(d.name, 18))}</span><div class="qfnar">${esc(m.cat)} · ${esc(FR_PROPS[m.prop] || m.prop)}</div>`;
  return `<div class="qf fr" id="frDetail"><div class="banner qfbar">${frBarHTML(d, m)}</div>
    <div class="qftools"><label>Context <input id="frTok" type="number" min="0" max="${FR_TOKENS_MAX}" step="10" value="${frTokens}" aria-label="Tokens of context above and below"> tokens each side</label>
      <span class="muted">${d.mentions.length > 1 ? '↑ ↓ its mentions · ' : ''}click a marked entity to assign to it (Shift: this mention only)</span>
      <span class="grow"></span><button class="link" data-gact="goto" data-ord="${m.s}">Show in text</button></div>
    <div class="qftop"><section class="qfctx qfabove" id="frAbove"><div class="qfin">${eaRows(m.above, m.uid)}</div></section>
      <section class="qfcore" id="frCore" style="--h:${hue(d.id)}"><div class="qfin">${eaRows(m.core, m.uid, left)}</div></section></div>
    <section class="qfctx qfbelow" id="frBelow"><div class="qfin">${eaRows(m.below, m.uid)}</div></section></div>`;
}
/* The tool bar, as the attribution views' (`makePass` in passui.js draws theirs): which fragment and mention, Keep, the
   candidates on the number keys, the other actions; under it "Also called …", or the offer after an assign. */
function frBarHTML(d, m) {
  const ch = S.ch, fr = ch.fr, total = ch.fr.page ? ch.fr.page.total : 0, i = ch.fskip;
  const reasons = c => [`${c.score.toFixed(2)} · ${c.reason || ''}`, ...(c.reasons || []).map(r => `${r.w > 0 ? '+' : ''}${r.w} ${r.text}`)].join('\n');
  const cands = d.candidates.map((c, k) => `<button class="cchip" data-fc="${c.id}" title="${esc(reasons(c))}"><kbd>${k + 1}</kbd><span class="sw" style="--h:${hue(c.id)}"></span>${esc(trim(c.name, 18))}</button>`).join('');
  const which = d.mentions.length > 1 ? ` · mention <b>${fr.at + 1}</b> of ${d.mentions.length} <kbd>↑</kbd><kbd>↓</kbd>` : '';
  return `<div class="ppbar">
    <span class="pph"><b>Fragments</b> <span class="num"><input class="ppjump" id="frAt" type="number" min="1" max="${total}" value="${i + 1}" aria-label="Number to go to" title="Type a number and press Go"> of ${total.toLocaleString()} <button class="btn sm" data-fa="goto">Go</button></span></span>
    <span class="ppq">“<b>${esc(trim(m.text, 50))}</b>” <span class="num">${esc(d.cat)} · ${d.count} mention${d.count === 1 ? '' : 's'} · #${d.id}${which}</span>${frQuotesHTML(m.quotes, d.id)}</span>
    <span class="ppc"><button class="btn sm primary" data-fa="keep" title="It’s its own entity: keep it as it is, mark it as checked and go on">Keep <kbd>↵</kbd></button><span class="muted">or assign to</span>${cands}<button class="btn sm" data-fa="other" title="Assign to another group (Shift+G: only this mention, also to a new group)">Other… <kbd>G</kbd></button></span>
    <span class="ppa"><button class="btn sm" data-fa="prev" ${i ? '' : 'disabled'} title="The previous fragment">‹ <kbd>←</kbd></button><button class="btn sm" data-fa="next" ${i + 1 < total ? '' : 'disabled'} title="Go on without changing it">Skip <kbd>→</kbd></button>
      <button class="btn sm" data-fa="hide" title="Mark it as not a character (hidden, its mentions kept)">Not a character <kbd>H</kbd></button>
      <button class="btn sm danger" data-fa="delete" title="Delete its mention${d.count === 1 ? '' : 's'} (Shift+D: only this one)">Delete <kbd>D</kbd></button>
      <button class="btn sm" data-fa="settings" title="Which fragments and how to advance">Settings</button><button class="btn sm" data-fa="close">Close <kbd>Esc</kbd></button></span>
    <span class="note ppn">number keys assign the whole fragment, Shift+number only this mention · ← → move through the fragments</span>
    ${fr.offer ? frOfferHTML(fr.offer) : frSameHTML(d.same_name)}</div>`;
}
/* The left column while Fragments is open: the count and filters in force, then one row per fragment of the page. */
function fragAsideHTML() {
  const ch = S.ch, p = ch.fr.page || { total: 0, items: [], offset: 0 };
  const pager = p.total > FR_PAGE ? `<div class="frpager"><button class="link" data-frpage="-1" ${p.offset ? '' : 'disabled'}>‹ Previous</button>
      <span class="num">${(p.offset + 1).toLocaleString()}–${(p.offset + p.items.length).toLocaleString()} of ${p.total.toLocaleString()}</span>
      <button class="link" data-frpage="1" ${p.offset + FR_PAGE < p.total ? '' : 'disabled'}>Next ›</button></div>` : '';
  return `<aside class="cl frl">
    <div class="ctools"><div class="gprog"><b>${p.total.toLocaleString()}</b> fragment${p.total === 1 ? '' : 's'} · ${ch.fsize === 1 ? '1 mention' : `≤ ${ch.fsize} mentions`} · ${ch.fcat ? esc(ch.fcat) : 'all types'}
      <span class="grow"></span><button class="link" data-fa="settings" title="Which fragments and how to advance">Change…</button></div></div>
    <ul class="crows" id="frList">${p.items.map((f, k) => frRowHTML(f, p.offset + k)).join('') || '<li class="more">No fragments match.</li>'}</ul>${pager}</aside>`;
}
/* One fragment in the list: colour, name, type and size, then its best candidate with its score. */
function frRowHTML(f, i) {
  const t = f.candidates[0];
  return `<li class="frow${i === S.ch.fskip ? ' sel' : ''}" data-fi="${i}" tabindex="0" role="button" aria-label="Fragment ${i + 1}: ${esc(f.name)}">
    <span class="sw" style="--h:${hue(f.id)}"></span><span class="cn">${esc(f.name)}</span><span class="num">${esc(f.cat)} · ${f.count}</span>
    <span class="frtop" title="${t ? esc(`Best candidate: ${t.name} (score ${t.score.toFixed(2)}: ${t.reason})`) : 'No candidate nearby'}">${t
      ? `→ <span class="sw" style="--h:${hue(t.id)}"></span><span class="cn">${esc(t.name)}</span> <b>${t.score.toFixed(1)}</b>` : '<span class="muted">no candidate</span>'}</span></li>`;
}
/* "Also called …": the other groups called by one of the fragment's names (pronouns aside), to click, and how many other fragments are. */
function frSameHTML(s) {
  if (!s || !s.names.length) return '';
  const names = s.names.slice(0, 3).map(n => `“${esc(trim(n, 30))}”`).join(', ');
  const groups = s.groups.slice(0, 8).map(g => `<button class="cchip" data-frto="${g.id}" title="Assign to ${esc(g.name)}: ${g.hits} of its mentions are called “${esc(g.as)}” (Shift: only this mention)"><span class="sw" style="--h:${hue(g.id)}"></span>${esc(trim(g.name, 22))} <span class="num">${g.hits}×</span></button>`).join('');
  const frags = s.fragments.length ? `<span class="note">and ${s.fragments.length} other fragment${s.fragments.length === 1 ? '' : 's'}</span>` : '';
  return `<span class="frsame"><span class="frlbl">Also called ${names}:</span>${groups || frags ? groups + frags : '<span class="muted">no other group</span>'}</span>`;
}
/* The quotes the mention shown is in (with its speaker) or speaks; a speaker other than the fragment `fid` itself can be clicked to assign to it. */
function frQuotesHTML(qs, fid) {
  const to = q => q.speaker != null && q.speaker !== fid ? ` data-frto="${q.speaker}"` : '';
  const chip = (q, why) => `<span class="spchip${to(q) ? ' to' : ''}" style="--h:${hue(q.speaker)}"${to(q)} title="${to(q) ? `Assign to ${esc(q.speaker_name)}, ${why} (Shift: only this mention)` : why}">${esc(trim(q.speaker_name, 18))}</span>`;
  return qs.map(q => q.role === 'inside'
    ? `<span class="frq num">· in a quote by ${q.speaker != null ? chip(q, 'who speaks this quote') : '<i>no one</i>'}</span>`
    : `<span class="frq num" title="${esc(q.text)}">· speaks “${esc(trim(q.text, 30))}”${to(q) ? `, set to ${chip(q, 'given as this quote’s speaker')}` : ''}</span>`).join('');
}
/* The offer after a whole fragment was assigned: the other fragments with one of its names, each with where it is (sentence,
   and how far from the one just assigned), to untick and assign to the same group in one step. */
function frOfferHTML(o) {
  const n = o.items.filter(x => !o.excl.has(x.id)).length;
  const far = x => { const d = x.sent - o.from; return d === 0 ? 'same sentence' : `${Math.abs(d).toLocaleString()} sentence${Math.abs(d) === 1 ? '' : 's'} ${d > 0 ? 'later' : 'earlier'}`; };
  return `<div class="froffer"><div class="frofferh"><span><b>${o.names.slice(0, 2).map(x => `“${esc(trim(x, 30))}”`).join(', ')}</b>: ${o.items.length} more fragment${o.items.length === 1 ? '' : 's'} with this name. Assign ${o.items.length === 1 ? 'it' : 'them'} to <span class="sw" style="--h:${hue(o.target)}"></span><b>${esc(trim(o.name, 30))}</b> too?</span>
      <button class="btn primary sm" data-fro="apply" ${n ? '' : 'disabled'}>Assign ${n === o.items.length ? (n === 1 ? 'it' : `all ${n}`) : n} <kbd>Y</kbd></button><button class="link" data-fro="no">No <kbd>Esc</kbd></button></div>
    <ul class="frolist">${o.items.map(x => `<li><input type="checkbox" data-frox="${x.id}" ${o.excl.has(x.id) ? '' : 'checked'} aria-label="Include ${esc(x.name)}">
      <span class="sw" style="--h:${hue(x.id)}"></span><span class="cn">${esc(x.name)}</span><span class="num">${x.count} mention${x.count === 1 ? '' : 's'} · S ${x.sent.toLocaleString()} · ${far(x)}</span>
      <button class="link" data-gact="goto" data-ord="${x.s}">Show</button></li>`).join('')}</ul></div>`;
}
/* Redraw the list and the middle (moving through the list); the whole view when they aren't on the page. */
function frDraw() {
  const aside = $('.cl.frl'), det = $('#frDetail');
  if (!aside || !det) { renderChars().catch(fail); return; }
  const keep = $('#frList').scrollTop;
  aside.outerHTML = fragAsideHTML();
  $('#frList').scrollTop = keep;
  frShowRow();
  frDrawDetail();
}
/* Redraw just the middle (another mention, the offer changed) and fit its text. */
function frDrawDetail() {
  const det = $('#frDetail');
  if (!det) return;
  det.outerHTML = frPaneInner();
  fitReading('fr');
}
/* Scroll the list so the current fragment's row is in view. */
function frShowRow() { const r = $('.frow.sel'); if (r) r.scrollIntoView({ block: 'nearest' }); }
window.addEventListener('resize', () => { clearTimeout(frShowRow.t); frShowRow.t = setTimeout(() => fitReading('fr'), 80); });

/* ------------------------------------------------------------ moving and acting */
/* Go to fragment number `i` (from 0) of the list: its page and details as fetched ahead when they were. */
async function fragGo(i) {
  const ch = S.ch, fr = ch.fr, seq = fragGo.seq = (fragGo.seq || 0) + 1;
  const total = fr.page ? fr.page.total : 0;
  if (!total) return;
  ch.fskip = Math.max(0, Math.min(total - 1, i));
  try {
    await frPage(ch.fskip);
    const f = frItem(), d = f ? await frDetail(f.id) : null;
    if (seq !== fragGo.seq || S.view !== 'chars' || ch.pane !== 'fragments') return;
    frSet(d);
    frDraw();
    frPrefetch();
  } catch (e) { if (seq === fragGo.seq) renderChars().catch(fail); }   // e.g. the fragment is gone: read everything again
}
/* Show the fragment's next (`step` 1) or previous (-1) mention, stopping at either end. */
function frStep(step) {
  const fr = S.ch.fr, d = S.ch.frag;
  if (!d) return;
  const k = Math.max(0, Math.min(d.mentions.length - 1, fr.at + step));
  if (k !== fr.at) { fr.at = k; frDrawDetail(); }
}
// The fragment joins the chosen group; whichever of the two is bigger keeps its number and settings.
function mergeKeepBigger(target, frag) {
  const c = S.clusterById.get(target);
  return (c ? c.count : 0) >= frag.count ? { target, sources: [frag.id] } : { target: frag.id, sources: [target] };
}
/* Show an edit's undo label and load everything again (which also replaces what was fetched ahead before it). */
async function frAfter(r) {
  if (r && (r.history || r.undo !== undefined)) { updateHistoryButtons(r.history || r); toast((r.history || r).undo || 'Done'); }
  frForget();
  try { await refresh(true); } catch (e) { fail(e); }
}
/* Run an edit on the current fragment, which then leaves the list: show the next one at once if it was fetched ahead (and
   the edit didn't touch it: `touched` are the other groups it changes, e.g. the one assigned to), then load everything again.
   `offer` (or none) replaces the offer shown. */
async function fragDo(fn, touched = [], offer = null) {
  const ch = S.ch, p = ch.fr.page;
  let next = frNextReady();
  if (next && touched.includes(next.id)) next = null;
  let r;
  try { r = await fn(); } catch (e) { fail(e); return; }
  ch.fr.offer = offer;
  if (p && p.items[ch.fskip - p.offset]) { p.items.splice(ch.fskip - p.offset, 1); p.total--; }
  if (next) { frSet(next); frDraw(); }
  await frAfter(r);
}
/* Run an edit on the mention shown only: the fragment stays (one mention fewer). With 'auto' advance the tool goes on to the
   fragment that came after it, with 'manual' it stays on this one: either is found again by its id, since the fragment can
   move down the list when the mention split off was its first. */
async function fragSplit(fn) {
  const ch = S.ch, p = ch.fr.page, here = p && p.items[ch.fskip - p.offset], after = p && p.items[ch.fskip - p.offset + 1];
  let r;
  try { r = await fn(); } catch (e) { fail(e); return; }
  ch.fr.offer = null;
  ch.fr.goId = frAdvance === 'auto' ? (after ? after.id : null) : (here ? here.id : null);
  if (frAdvance === 'auto' && after) ch.fskip++;   // where it is when not found on the page any more
  await frAfter(r);
}
/* Assign to group `t`: the whole fragment (then offer its same-name fragments), or with `one` only the mention shown (split off). */
function fragAssign(t, one = false) {
  const f = S.ch.frag, fr = S.ch.fr;
  if (!f || t == null || t === f.id) return;
  noteRecent(t);
  const m = f.mentions[fr.at];
  if (one && f.count > 1) { fragSplit(() => api('POST', '/api/mentions/regroup', { uids: [m.uid], target: t })); return; }
  const merge = mergeKeepBigger(t, f);
  fragDo(() => api('POST', '/api/groups/merge', merge), [t], frOfferFor(f, merge.target, t));
}
/* The offer after fragment `f` was assigned to `chosen` (`survivor` is the group that kept its number): the other fragments
   with one of its names (`same_name.fragments`, fetched before the assign), all ticked (`excl` holds the unticked); null when there are none. */
function frOfferFor(f, survivor, chosen) {
  const items = ((f.same_name && f.same_name.fragments) || []).filter(x => x.id !== chosen && x.id !== survivor);
  if (!items.length) return null;
  const c = S.clusterById.get(chosen);
  return { target: survivor, name: c ? c.name : `#${chosen}`, names: f.same_name.names, from: f.mentions[0].sent, items, excl: new Set() };
}
/* Assign the ticked fragments of the offer to its group, in one step. */
async function frOfferApply() {
  const fr = S.ch.fr, o = fr.offer;
  if (!o) return;
  const ids = o.items.map(x => x.id).filter(id => !o.excl.has(id));
  fr.offer = null;
  if (!ids.length) { frDrawDetail(); return; }
  let r;
  try { r = await api('POST', '/api/groups/merge', { target: o.target, sources: ids }); } catch (e) { fail(e); frDrawDetail(); return; }
  await frAfter(r);
}
/* The Settings popup (as the passes' settings look): which fragments (size, type) and how to advance after a mention is split off. */
function frSettings(anchor) {
  const ch = S.ch, cats = Object.keys((ch.list && ch.list.cats) || {});
  if (ch.fcat && !cats.includes(ch.fcat)) cats.push(ch.fcat);
  pop.innerHTML = `<div class="gp pps"><div class="gpt">Fragments settings</div>
    <div class="gpl">Which fragments</div>
    <div class="row"><select id="fsize" aria-label="Fragment size">${[1, 2, 3, 5, 10].map(n => `<option value="${n}" ${ch.fsize === n ? 'selected' : ''}>${n === 1 ? 'Groups with 1 mention' : `Groups with up to ${n} mentions`}</option>`).join('')}</select>
      <select id="fcat" aria-label="Entity type"><option value="">All types</option>${cats.map(c => `<option ${ch.fcat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="gpl" style="margin-top:8px">After splitting off a mention (Shift)</div>
    <div class="row"><button class="btn sm${frAdvance === 'auto' ? ' primary' : ''}" data-fradv="auto" title="Go on to the next fragment">Auto</button>
      <button class="btn sm${frAdvance === 'manual' ? ' primary' : ''}" data-fradv="manual" title="Stay on this fragment to deal with its other mentions; go on yourself with →">Manual</button></div>
    <p class="note" style="margin:6px 0 0">Assigning, keeping, hiding or deleting a whole fragment always goes on: it leaves the list.</p>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-fradv="close">Done</button></div></div>`;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
  pop.style.top = r.bottom + 6 + 'px';
  pop.onclick = e => {
    const b = e.target.closest('[data-fradv]'); if (!b) return;
    if (b.dataset.fradv === 'close') { closePop(); return; }
    frAdvance = b.dataset.fradv; remember('bne.frAdvance', frAdvance);
    frSettings(anchor);
  };
  pop.onchange = e => {   // a filter: back to the first fragment of the new list
    if (e.target.id === 'fsize') ch.fsize = +e.target.value; else if (e.target.id === 'fcat') ch.fcat = e.target.value; else return;
    ch.fskip = 0; ch.fr.offer = null;
    renderChars().then(() => frSettings($('#frDetail [data-fa="settings"]') || anchor)).catch(fail);
  };
  pop.onkeydown = e => { if (e.key === 'Escape') { closePop(); e.stopPropagation(); } };
}
/* Act on the current fragment or move: `one` (Shift held) makes delete and Other… act on the mention shown only. */
async function fragAct(kind, arg, one = false) {
  const ch = S.ch, f = ch.frag;
  if (kind === 'prev' || kind === 'next') { fragGo(ch.fskip + (kind === 'next' ? 1 : -1)); return; }
  if (kind === 'goto') { const n = +($('#frAt') || {}).value; if (n) fragGo(n - 1); return; }
  if (kind === 'settings') { frSettings(arg || $('[data-fa="settings"]')); return; }
  if (kind === 'close') { setPane('overview'); return; }
  if (!f) return;
  const m = one && f.count > 1 ? f.mentions[ch.fr.at] : null;   // the mention shown, when the action is for it alone
  if (kind === 'assign') { fragAssign(arg, one); return; }
  if (kind === 'keep') { await fragDo(() => api('PATCH', `/api/group/${f.id}`, { checked: true })); return; }
  if (kind === 'hide') { await fragDo(() => api('PATCH', `/api/group/${f.id}`, { hidden: true })); return; }
  if (kind === 'delete') { await (m ? fragSplit(() => api('POST', '/api/mentions/delete', { uids: [m.uid] })) : fragDo(() => api('POST', '/api/mentions/delete', { uids: f.uids }))); return; }
  if (kind === 'other') {
    const at = m || f.mentions[ch.fr.at];
    groupPicker((arg || $('[data-fa="other"]')).getBoundingClientRect(), { title: `Assign “${trim(m ? m.text : f.name, 30)}”${m ? ' alone' : ''} to`, allowNew: !!m, okLabel: m ? 'Move' : undefined,
      exclude: [f.id], near: { a: at.s, b: at.e },
      onPick: (t, name) => {   // a new group (t null) only for a mention moved alone
        if (t == null) { fragSplit(() => api('POST', '/api/mentions/regroup', { uids: [m.uid], target: null, name })); return; }
        fragAssign(t, !!m);
      } });
  }
}

/* ------------------------------------------------------------ events (called from entities.js while Fragments is open) */
/* A click in the Entities view; true when it was the tool's. Shift-clicking a group to assign to acts on the mention shown only. */
function fragClick(e) {
  const fr = S.ch.fr, one = e.shiftKey;
  const fro = e.target.closest('[data-fro]');
  if (fro) { if (fro.dataset.fro === 'apply') frOfferApply(); else { fr.offer = null; frDrawDetail(); } return true; }
  if (e.target.closest('[data-gact], [data-frox]')) return false;   // Show in text, the offer's tick boxes
  const to = e.target.closest('[data-frto]'); if (to) { fragAssign(+to.dataset.frto, one); return true; }
  const fc = e.target.closest('[data-fc]'); if (fc) { fragAssign(+fc.dataset.fc, one); return true; }
  const fa = e.target.closest('[data-fa]'); if (fa) { fragAct(fa.dataset.fa, fa, one); return true; }
  const row = e.target.closest('[data-fi]'); if (row) { fragGo(+row.dataset.fi); return true; }
  const pg = e.target.closest('[data-frpage]');
  if (pg) { const p = S.ch.fr.page; fragGo(p.offset + (+pg.dataset.frpage) * FR_PAGE); return true; }
  const mk = e.target.closest('#frDetail [data-eauid]');
  if (mk && !window.getSelection().toString()) {
    const uid = +mk.dataset.eauid, own = S.ch.frag.mentions.findIndex(x => x.uid === uid);
    if (own >= 0) { if (own !== fr.at) { fr.at = own; frDrawDetail(); } return true; }   // one of the fragment's own: show it
    fragAssign(fr.markGroup.get(uid), one);
    return true;
  }
  return false;
}
/* A key in the Entities view (not in a field); true when it was the tool's. ← → fragments, ↑ ↓ its mentions, Enter keep,
   1–9 assign (Shift: the mention shown only), G other, H not a character, D delete (Shift: the mention shown), Y take the
   offer, Esc drop the offer, else close. */
function fragKey(e) {
  const k = e.key.toLowerCase(), f = S.ch.frag, fr = S.ch.fr;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { fragAct(e.key === 'ArrowRight' ? 'next' : 'prev'); return true; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { frStep(e.key === 'ArrowDown' ? 1 : -1); return true; }
  if (e.key === 'Escape') {
    if (fr.offer) { fr.offer = null; frDrawDetail(); } else fragAct('close');
    return true;
  }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.frow')) { fragGo(+e.target.dataset.fi); return true; }
  if (!f) return false;
  if (k === 'y' && fr.offer) { frOfferApply(); return true; }
  if (e.key === 'Enter') { fragAct('keep'); return true; }
  const digit = /^Digit([1-9])$/.exec(e.code || '');   // Shift+1 types "!" on most keyboards: read the key's place instead
  if (digit) { const c = f.candidates[+digit[1] - 1]; if (c) { fragAssign(c.id, e.shiftKey); return true; } return false; }
  const map = { g: 'other', h: 'hide', d: 'delete' };
  if (map[k]) { fragAct(map[k], null, e.shiftKey); return true; }
  return false;
}
/* A changed field in the Entities view; true when it was the tool's (the offer's tick boxes, the context size). */
function fragChange(t) {
  const ch = S.ch;
  if (t.dataset.frox != null && ch.fr.offer) { tickRange(t, 'frox', ch.fr.offer.excl, { excl: true }); frDrawDetail(); return true; }
  if (t.id === 'frTok') {   // the context size: remember it and fetch the current fragment again with it
    frTokens = Math.max(0, Math.min(FR_TOKENS_MAX, Math.round(+t.value) || 0));
    remember('bne.frTokens', String(frTokens));
    fragGo(ch.fskip);
    return true;
  }
  return false;
}
// Enter in the "n of N" box goes there (fields don't get the view's keys)
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'frAt') { e.preventDefault(); fragAct('goto'); }
});
