'use strict';
/* The Quote tool: the Pronoun pass's engine (makePass, passui.js) pointed at a quote's speaker instead of a pronoun's
   group. It comes in two forms that share this file's description of what a quote is (`QUOTE_TOOL`) and its settings:
   the Quote pass (every quote in reading order in the annotation view, here) and the Speaker-Attribution view (qfocusui.js).
   Picking a speaker (a key, a suggestion or "Other…") always applies the quote rule too (moves the quote's own I/me/you…
   to match), same as the quick pick in the speaker chip elsewhere.

   The number keys: the speakers you pinned (up to 5, in the settings) take keys 1, 2, …, the suggested speakers (up to 5,
   suggestions from the sources you choose; can be switched off) follow on the next keys, the last being 0. */

/* The most speakers that can be pinned to keys (as in core/tools/rule.py). */
const QUOTE_KEYS_MAX = 5;
/* The choices for the number keys of a quote: pinned speakers first, then the suggestions. */
function quoteChoices(x, r) {
  return [...r.settings.keys.map(k => ({ id: k.id, name: k.name, pinned: true })), ...x.candidates];
}
/* Where the suggested speakers can come from: [key, label, what it is], in the order they fill the keys (core/tools/quote.py). */
const QUOTE_SOURCES = [
  ['evidence', 'Evidence', 'speaker suggestions’ scoring: who is named next to the quote, who continues or answers, who sounds like it; best first'],
  ['conversation', 'Conversation', 'the other speakers of this conversation, nearest quote first'],
  ['nearby', 'Nearby groups', 'groups mentioned close to the quote, nearest first'],
];
/* The settings rows of the Quote tool: which speakers are pinned to keys, whether suggestions follow and from where. */
function quoteKeysHTML(st) {
  const n = st.keys.length;
  const slots = st.keys.map((k, i) => `<span class="keyrow"><kbd>${keyLabel(i)}</kbd><span class="sw" style="--h:${hue(k.id)}"></span>${esc(trim(k.name, 18))}<button class="link" data-qkey-del="${i}" title="Free this key">✕</button></span>`).join('');
  const src = QUOTE_SOURCES.map(([k, l, h]) => `<label class="chk ppsk qsrc"><input type="checkbox" data-qsrc="${k}" ${st.sources.includes(k) ? 'checked' : ''} ${st.suggest ? '' : 'disabled'}> ${l}<span class="note">${h}</span></label>`).join('');
  return `<div class="gpl" style="margin-top:8px">Speaker keys</div>
    ${n ? `<div class="keylist">${slots}</div>` : '<p class="note">None pinned: add up to 5 speakers you use all the time.</p>'}
    ${n < QUOTE_KEYS_MAX ? `<div class="row"><button class="btn sm" data-qkey-add>+ Speaker for key ${keyLabel(n)}</button></div>` : ''}
    <label class="chk ppsk"><input type="checkbox" data-qsug ${st.suggest ? 'checked' : ''}> Suggest speakers
      <span class="note">${st.suggest ? `on keys ${keyLabel(n)}–${keyLabel(n + 4)}, after the speaker keys` : 'off: only the speaker keys and Other…'}</span></label>
    ${src}
    <label class="chk ppsk"><input type="checkbox" data-qreasons ${st.reasons ? 'checked' : ''}> Show the reason under the bar<span class="note">hovering a suggestion always shows it</span></label>`;
}
/* The settings read back from the open popup (the sources stay as saved while suggestions are off). */
function quoteSettingsRead(pop) {
  return { suggest: !!pop.querySelector('[data-qsug]:checked'), reasons: !!pop.querySelector('[data-qreasons]:checked'),
    sources: [...pop.querySelectorAll('[data-qsrc]:checked')].map(i => i.dataset.qsrc) };
}
/* The line under the bar naming why each suggestion is offered (when the setting is on). */
function quoteNote(x, r) {
  if (!r.settings.reasons || !x.candidates.length) return '';
  const n = r.settings.keys.length;
  return `<span class="note ppn qreasons">${x.candidates.map((c, i) => `<span><kbd>${keyLabel(n + i)}</kbd> <b>${esc(trim(c.name, 18))}</b>: ${esc(c.reason)}</span>`).join('')}</span>`;
}
/* A click on the Quote tool's own rows of the settings popup: free a key, or pick a speaker for the next one. */
function quoteKeysClick(e, apply, anchor) {
  const st = (S.qp || S.qf).r.settings, ids = st.keys.map(k => k.id);
  const del = e.target.closest('[data-qkey-del]');
  if (del) { apply({ keys: ids.filter((_, i) => i !== +del.dataset.qkeyDel) }); return; }
  const add = e.target.closest('[data-qkey-add]');
  if (add) groupPicker(add.getBoundingClientRect(), { title: `Speaker for key ${keyLabel(ids.length)}`, allowNew: false, pins: false, exclude: ids,
    onPick: t => apply({ keys: [...ids, t] }) });
}

/* What the Quote pass and the Speaker-Attribution view have in common (see makePass for what each entry means). */
const QUOTE_TOOL = {
  noun: 'quotes', layer: 'quotes',
  chip: c => c.pinned ? 'Pinned speaker' : `${(QUOTE_SOURCES.find(x => x[0] === c.source) || [])[1] || ''}: ${c.reason}`,
  question: x => `“<b>${esc(trim(x.text, 60))}</b>” is spoken by ${x.speaker != null
    ? `<span class="sw" style="--h:${hue(x.speaker)}"></span><b>${esc(trim(x.speaker_name, 24))}</b>` : '<b class="muted">no one</b>'}`,
  choices: quoteChoices,
  extraSettings: quoteKeysHTML,
  settingsClick: quoteKeysClick,
  readSettings: quoteSettingsRead,
  note: quoteNote,
  saveSettings: body => api('PUT', '/api/qpass/settings', body),
  confirm: uids => api('POST', '/api/qpass/confirm', { uids }),
  async moveTo(x, target) {
    const r = await api('POST', '/api/quotes/speaker', { uids: [x.uid], char_id: target, quote_rule: true });
    await api('POST', '/api/qpass/confirm', { uids: [x.uid] });
    updateHistoryButtons(r);
    toast(r.moved ? `${r.undo || 'Assigned'} · moved ${r.moved} pronoun${r.moved === 1 ? '' : 's'}` : (r.undo || 'Assigned'));
    if (target != null) noteRecent(target);
  },
  other: (x, rect, pass) => groupPicker(rect, { title: `Who says “${trim(x.text, 30)}”?`, allowNew: false, allowNone: true,
    exclude: x.speaker != null ? [x.speaker] : [], near: { a: x.s, b: x.e }, onPick: t => pass.move(t) }),
};

S.qp = null;
/* The quote pass: every quote, with its speaker; moving one gives the quote a speaker (and the pass remembers it). */
const QUOTE_PASS = makePass({
  ...QUOTE_TOOL,
  key: 'qp', kind: 'qpass', name: 'Quote pass',
  reasons: { reviewed: 'reviewed', confirmed: 'confirmed', manual: 'set by hand', checked: 'checked speakers', has_speaker: 'already has a speaker' },
  skips: [['reviewed', 'In sentences marked as reviewed', ''],
    ['confirmed', 'Confirmed earlier', 'kept with Enter or moved in a pass, and still with that speaker'],
    ['manual', 'Speaker already set by hand', ''],
    ['checked', 'Speaker’s group marked as checked', ''],
    ['has_speaker', 'Already has a speaker', 'to focus only on the quotes still missing one']],
  presets: { edit: 'Skip speakers already confirmed or set by hand', check: 'Show every quote except reviewed sentences' },
  settingsTitle: 'What to skip, the speaker keys and how to advance',
  focus: x => x.speaker,
  fetch: q => api('GET', `/api/qpass?${q}`),
});
