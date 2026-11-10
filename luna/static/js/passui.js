'use strict';
/* The passes: go through the pronouns (Pronoun pass) or the quotes (Quote pass) of the book one at a time, in reading
   order, in the annotation view. This file holds the engine both share (`makePass`) and the Pronoun pass's own part;
   qpassui.js holds the Quote pass's. You choose what to skip and how to advance (settings are saved per book): 'auto'
   (Keep or a candidate also goes on to the next one) or 'manual' (they stay put; you go on yourself with Next, so you can
   keep working on the same one first).
   Keys while a pass runs: the number keys (1–9, then 0) move to the choice printed with that key, Enter keeps it, → next (also the manual advance),
   ← back, G another group (speaker), Esc stops. The two passes share one bar (#banner); starting one stops the other and
   paint mode. The Speaker-Attribution view (qfocusui.js) is a third use of the engine: it has its own view instead of the annotation
   view, draws the same bar into it and moves in reading order. */

S.pp = null;
/* Every pass that exists, so the rest of the page can stop them, refresh them or ask which one owns the bar. */
const PASSES = [];
/* Stop every running pass (starting paint mode or the entity filter does this). */
function stopPasses() { for (const p of PASSES) if (S[p.key]) p.stop(); }
/* Refresh the running passes' current item after an edit made elsewhere (side panel, table, hotkey), so the bar doesn't go stale. */
async function syncPassItems() { for (const p of PASSES) if (S[p.key] && S[p.key].cur) await p.sync(); }
/* The running pass that has the current view to itself (the Speaker- or Entity-Attribution view), or undefined. */
function viewPass() { return PASSES.find(p => p.view && p.view === S.view && S[p.key]); }

/* The key printed on the n-th choice button (counting from 0): 1 … 9, then 0. */
const keyLabel = n => (n + 1) % 10;
/* The key printed on a choice's button: its own (`c.key`, for choices tied to a key whatever their place), else its place in the list. */
const choiceKey = (c, i) => String(c.key ?? keyLabel(i));

/* Build one pass from a description of what differs between the kinds:
     key        'pp' or 'qp': where its state lives (S[key]), and the prefix of its data-attributes in the bar
     kind       what #banner.dataset.kind says while its bar is showing
     name       'Pronoun pass' / 'Quote pass';  noun  'pronouns' / 'quotes' (for the "no more …" line)
     reasons    {skip reason: short text} for the "Skipped: …" line;  skips  [[key, label, hint]] for the settings popup
     presets    the title of the Edit and Check preset buttons;  settingsTitle  the tooltip of the bar's Settings button
     layer      the layer whose span is selected in the text ('entities' / 'quotes')
     focus(x)   the group to highlight in the text for an item
     question(x)  the bar's sentence about the item;  chip(c)  the title of a candidate's button
     moveTo(x, target, name)  make the item belong to `target` and confirm it (API calls, history, toast)
     other(x, rect, pass)  open the picker for "another group" (`pass.move(target)` makes the choice);  extraSettings(st)  the settings popup's extra rows (or '')
     fetch(q) / saveSettings(body) / confirm(uids)  the three API calls of the pass (literal URLs, so tests/test_static.py can check them)
   and, only where a kind differs from the pronoun pass:
     choices(x, r)  the buttons for number keys 1.. (default: the item's candidates); the Quote tool puts its pinned speakers first
     note(x, r)  an extra line under the bar (html, or ''): the Quote tool's reasons for its suggestions
     readSettings(pop)  the settings fields to save besides skip and advance, read from the open popup;
     settingsClick(e, apply)  clicks of the kind's own extra rows in the popup
     at(x)      where the item sits in the order the server walks (default `x.s`, its first token; the Entity-Attribution view
                walks mentions that can start on the same token, so it uses their index, `x.pos`); the next one is the first after it
     startQuery(ref)  the query that starts a walk after token `ref` (default `ord=ref&dir=next`)
     (a pass with its own `view` also remembers its item, and `start()` without a place resumes there)
     leave()    called when the pass's view is left, to give back what it borrowed from the page (the Entity-Attribution view's selection)
     view       the view the pass lives in instead of the annotation view (`S.view`), drawn by `draw()` (which also draws the
                bar, into `barHost()`), left on stop; such a pass has no skip rules and walks `reading` order:
                ← is the previous item in the book rather than the previous one you visited */
function makePass(spec) {
  const key = spec.key;
  const attr = (name) => `data-${key}${name}`;      // e.g. data-ppc, data-pps-preset
  const set = (name) => `${key}s${name}`;           // the dataset name of data-pps-preset: ppsPreset
  const choices = (x, r) => spec.choices ? spec.choices(x, r) : x.candidates;
  const at = x => spec.at ? spec.at(x) : x.s;
  const me = {
    key, kind: spec.kind, view: spec.view,

    /* Is the pass running in a text view? */
    active() { return !!S[key] && S.mode === 'table' && (spec.view ? S.view === spec.view : S.view === 'annot' || S.view === 'table'); },

    /* Start from a position (default: the selected word or the top of the page). */
    async start(from) {
      if (S.paint) stopPaint();
      for (const p of PASSES) if (p !== me && S[p.key]) p.stop();
      if (S.ef.on) S.ef.on = false;
      closePop();
      S[key] = { trail: [], cur: null, r: null };
      if (S.view !== (spec.view || 'annot')) setView(spec.view || 'annot');
      let ref = from;
      if (ref == null) {
        const sel = S.sel;
        ref = sel && sel.kind === 'span' && sel.s != null ? sel.s - 1 : sel && sel.kind === 'token' ? sel.ord - 1 : S.win ? S.win.start - 1 : -1;
      }
      try {
        // a pass with its own view picks up where it was left, unless it was started at a place on purpose
        if (spec.view && from == null && me.last && me.last.book === S.info.project) {
          try { await me.go(`uid=${me.last.uid}`, false); return; } catch { /* that item is gone: start as usual */ }
        }
        await me.go(spec.startQuery ? spec.startQuery(ref) : `ord=${ref}&dir=next`, false);
      } catch (e) { fail(e); }
    },

    /* End the pass and remove its bar. */
    stop() {
      if (!S[key]) return;
      S[key] = null;
      closePop();
      if (spec.view) { me.left(); if (S.view === spec.view) setView(S.textView || 'annot'); return; }
      const b = $('#banner');
      if (b.dataset.kind === spec.kind) { b.hidden = true; b.dataset.kind = ''; }
      S.hl = null;
      if (S.view === 'annot') renderAnnot();
    },

    /* The pass's own view was left (renderMain calls this when the view changes, stop() when it closes): undo what the view
       borrowed from the page, as `spec.leave` says. */
    left() { if (spec.leave) spec.leave(); },

    /* Fetch an item (next, previous or a given one: `q` is the query), jump to it and show the bar. */
    async go(q, pushTrail = true) {
      const r = await spec.fetch(q);
      if (!S[key]) return;
      if (pushTrail && S[key].cur) S[key].trail.push(S[key].cur.uid);
      S[key].r = r; S[key].cur = r.item;
      if (spec.view && r.item) me.last = { book: S.info.project, uid: r.item.uid };   // where a view's pass resumes
      if (r.item && !spec.view) {
        S.hl = spec.focus(r.item);
        await goTo(r.item.s, async () => { await selectSpan(spec.layer, r.item.uid); });
      }
      me.draw();
    },

    /* Draw what the pass shows: its own view (which includes the bar), or just the bar. */
    draw() { if (spec.view) spec.draw(); else me.bar(); },

    /* Refresh the current item's group and candidates from the server, without moving on: used after a manual edit made
       elsewhere while the pass is showing it, so the bar doesn't go stale. */
    async sync() {
      if (!S[key] || !S[key].cur) return;
      const uid = S[key].cur.uid;
      try {
        const r = await spec.fetch(`uid=${uid}`);
        if (!S[key] || !S[key].cur || S[key].cur.uid !== uid) return;
        S[key].r = r; S[key].cur = r.item;
        if (!spec.view) S.hl = spec.focus(r.item);
        me.draw();
        syncPassBanner();
      } catch (e) { /* the item is gone (deleted elsewhere); leave the bar showing what it last had */ }
    },

    /* The counter of a pass that walks the book in order, as a box you can change plus Go: "[63] of 10,658  Go". */
    jump(x, r) {
      return `<input class="ppjump" type="number" min="1" max="${r.shown}" value="${x.index}" aria-label="Number to go to" title="Type a number and press Go"> of ${r.shown.toLocaleString()} <button class="btn sm" ${attr('')}="go">Go</button>`;
    },

    /* 'Skipped: 12 rules, 4 confirmed …' for the bar. */
    skipped(r) {
      const parts = Object.entries(r.skipped || {}).filter(([, n]) => n).map(([k, n]) => `${n.toLocaleString()} ${spec.reasons[k] || k}`);
      return parts.length ? `Skipped: ${parts.join(', ')}` : 'Nothing skipped';
    },

    /* Draw the bar: the item, its group, candidate groups, and the buttons. */
    bar() {
      const b = spec.view ? spec.barHost() : $('#banner'), p = S[key]; if (!p || !b) return;
      const r = p.r, x = p.cur;
      if (!spec.view) { b.dataset.kind = spec.kind; b.hidden = false; }
      const preset = !spec.skips.length ? '' : r.settings.preset === 'edit' ? 'Edit pass' : r.settings.preset === 'check' ? 'Check pass' : 'Your settings';
      if (!x) {
        b.innerHTML = `<div class="ppbar"><span class="pph"><b>${spec.name}</b> <span class="num">${preset}</span></span>
          <span>No more ${spec.noun} to look at after this point. ${esc(me.skipped(r))} of ${r.total.toLocaleString()}.</span>
          <span class="ppa"><button class="btn sm" ${attr('')}="restart">Start from the beginning</button><button class="btn sm" ${attr('')}="settings">Settings</button><button class="btn sm" ${attr('')}="stop">Stop</button></span></div>`;
        return;
      }
      const manual = r.settings.advance === 'manual';
      const cands = choices(x, r).map((c, i) => `<button class="cchip${spec.nofit && spec.nofit(c) ? ' nofit' : ''}${c.pinned ? ' pinned' : ''}" ${attr('c')}="${c.id}" title="${esc(spec.chip(c))}"><kbd>${choiceKey(c, i)}</kbd><span class="sw" style="--h:${hue(c.id)}"></span>${esc(trim(c.name, 18))}</button>`).join('');
      b.innerHTML = `<div class="ppbar">
        <span class="pph"><b>${spec.name}</b> <span class="num">${[x.index ? (spec.reading ? me.jump(x, r) : `${x.index.toLocaleString()} of ${r.shown.toLocaleString()}`) : '', preset].filter(Boolean).join(' · ')}</span></span>
        <span class="ppq">${spec.question(x)}</span>
        <span class="ppc"><button class="btn sm primary" ${attr('')}="ok" title="${manual ? 'It’s right: keep it' : 'It’s right: keep it and go on'}">Keep <kbd>↵</kbd></button><span class="muted">or move to</span>${cands}<button class="btn sm" ${attr('')}="other">Other… <kbd>G</kbd></button></span>
        <span class="ppa"><button class="btn sm" ${attr('')}="prev" ${(spec.reading ? x.index > 1 : p.trail.length) ? '' : 'disabled'} title="${spec.reading ? `The previous ${spec.noun.replace(/s$/, '')} in the book` : 'Back to the previous one'}">‹ <kbd>←</kbd></button><button class="btn sm" ${attr('')}="next" title="${manual ? 'Go on to the next one' : 'Go on without confirming'}">${manual ? 'Next' : 'Skip'} <kbd>→</kbd></button>
          <button class="btn sm" ${attr('')}="settings" title="${esc(spec.settingsTitle)}">Settings</button><button class="btn sm" ${attr('')}="stop">${spec.view ? 'Close' : 'Stop'} <kbd>Esc</kbd></button></span>
        <span class="note ppn">${spec.skips.length ? `${esc(me.skipped(r))} · ` : ''}number keys choose from this bar${spec.view ? ` · ← → move through the ${spec.noun}` : ' while the pass runs'}</span>
        ${spec.note ? spec.note(x, r) : ''}</div>`;
    },

    /* After Keep or moving to a candidate: go on to the next one (advance: 'auto') or just refresh this one in place so you can
       keep working on it ('manual': you go on yourself with Next). */
    async on(x) {
      if (S[key].r.settings.advance === 'manual') await me.go(`uid=${x.uid}`, false);
      else await me.go(`ord=${at(x)}&dir=next`, !spec.reading);
    },

    /* Move the current item to a group (what that means is the kind's own: `moveTo`), refresh, and go on (or not). */
    async move(target, name) {
      const x = S[key] && S[key].cur; if (!x) return;
      try {
        await spec.moveTo(x, target, name);
        await refresh(true);
        await me.on(x);
      } catch (e) { fail(e); }
    },

    /* Act on a bar button (keep, skip, back, other group, settings, restart, stop). */
    async act(k, el) {
      const p = S[key]; if (!p) return;
      const x = p.cur;
      try {
        if (k === 'stop') { me.stop(); return; }
        if (k === 'restart') { p.trail = []; await me.go('ord=-1&dir=next', false); return; }
        if (k === 'settings') { me.settings(el); return; }
        if (!x) return;
        if (k === 'ok') { await spec.confirm([x.uid]); await me.on(x); return; }
        if (k === 'go') {   // the number typed in the counter (clamped to the list)
          const n = Math.round(+(el.closest('.ppbar').querySelector('.ppjump') || {}).value);
          if (n) await me.go(`n=${Math.max(1, Math.min(n, p.r.shown))}`, false);
          return;
        }
        if (k === 'next') { await me.go(`ord=${at(x)}&dir=next`, !spec.reading); return; }
        if (k === 'prev' && spec.reading) { await me.go(`ord=${at(x)}&dir=prev`, false); return; }
        if (k === 'prev') { const uid = p.trail.pop(); if (uid == null) return; await me.go(`uid=${uid}`, false); return; }
        if (k === 'other') spec.other(x, (el || $(`[${attr('')}="other"]`)).getBoundingClientRect(), me);
      } catch (e) { fail(e); }
    },

    /* The settings popup: presets, the kind's extra rows (what to show), what to skip, how to advance. */
    settings(anchor) {
      const st = S[key].r.settings;
      const skips = spec.skips.length ? `<div class="row"><button class="btn sm${st.preset === 'edit' ? ' primary' : ''}" ${attr('s-preset')}="edit" title="${esc(spec.presets.edit)}">Edit pass</button>
          <button class="btn sm${st.preset === 'check' ? ' primary' : ''}" ${attr('s-preset')}="check" title="${esc(spec.presets.check)}">Check pass</button></div>` : '';
      const skipRows = spec.skips.length ? `<div class="gpl" style="margin-top:8px">Skip</div>${spec.skips.map(([k, l, h]) => `<label class="chk ppsk"><input type="checkbox" ${attr('s-skip')}="${k}" ${st.skip.includes(k) ? 'checked' : ''}> ${l}${h ? `<span class="note">${h}</span>` : ''}</label>`).join('')}` : '';
      pop.innerHTML = `<div class="gp pps"><div class="gpt">${spec.name} settings</div>
        ${skips}${spec.extraSettings(st)}${skipRows}
        <div class="gpl" style="margin-top:8px">How to advance</div>
        <div class="row"><button class="btn sm${st.advance === 'auto' ? ' primary' : ''}" ${attr('s-advance')}="auto" title="Keep or a candidate also goes on to the next one">Auto</button>
          <button class="btn sm${st.advance === 'manual' ? ' primary' : ''}" ${attr('s-advance')}="manual" title="Keep or a candidate stays put; go on yourself with Next">Manual</button></div>
        <div class="row" style="margin-top:8px"><button class="btn sm" ${attr('s')}="close">Done</button></div></div>`;
      pop.hidden = false;
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
      pop.style.top = r.bottom + 6 + 'px';
      const apply = async body => {
        try {
          const s = await spec.saveSettings(body);
          S[key].r.settings = s;
          const x = S[key].cur;
          await me.go(`ord=${x ? at(x) - 1 : -1}&dir=${spec.reading ? 'here' : 'next'}`, false);
          me.settings($(`[${attr('')}="settings"]`) || anchor);
        } catch (e) { fail(e); }
      };
      pop.onclick = e => {
        const pr = e.target.closest(`[${attr('s-preset')}]`); if (pr) { apply({ preset: pr.dataset[set('Preset')] }); return; }
        const av = e.target.closest(`[${attr('s-advance')}]`); if (av) { apply({ advance: av.dataset[set('Advance')] }); return; }
        if (e.target.closest(`[${attr('s')}="close"]`)) closePop();
        else if (spec.settingsClick) spec.settingsClick(e, apply, anchor);
      };
      pop.onchange = () => {
        const body = spec.readSettings ? spec.readSettings(pop) : {};
        if (spec.skips.length) body.skip = [...pop.querySelectorAll(`[${attr('s-skip')}]:checked`)].map(i => i.dataset[set('Skip')]);
        apply(body);
      };
      pop.onkeydown = e => { if (e.key === 'Escape') { closePop(); e.stopPropagation(); } };
    },
  };

  document.addEventListener('click', e => {   // the bar's buttons (the bar is in #banner, or inside the pass's own view)
    if (!S[key] || !e.target.closest('.ppbar')) return;
    const c = e.target.closest(`[${attr('c')}]`); if (c) { me.move(+c.dataset[`${key}c`], null); return; }
    const a = e.target.closest(`[${attr('')}]`); if (a) me.act(a.dataset[key], a);
  });
  document.addEventListener('keydown', e => {   // Enter in the counter's box does what Go does
    if (e.key === 'Enter' && S[key] && e.target.matches && e.target.matches('.ppjump') && S[key].cur && e.target.closest(`.ppbar`) && spec.reading) { e.preventDefault(); me.act('go', e.target); }
  });
  // start buttons: the annotation bar and the Entities overview card
  document.addEventListener('click', e => {
    const b = e.target.closest(`#${key}Btn, [${attr('start')}]`); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (S[key] && b.id === `${key}Btn`) me.stop(); else me.start(b.dataset[`${key}start`] ? -1 : null);
  }, true);
  // keys while the pass runs (before the number keys for pinned groups)
  window.addEventListener('keydown', e => {
    if (!me.active() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches && e.target.matches('input, select, textarea')) return;
    if (typeof editing !== 'undefined' && editing) return;
    if (!pop.hidden) return;
    const x = S[key].cur;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'Escape') { stop(); me.stop(); return; }
    if (/^[0-9]$/.test(e.key)) { stop(); const c = x && choices(x, S[key].r).find((c, i) => choiceKey(c, i) === e.key); if (c) me.move(c.id, null); return; }
    if (e.key === 'Enter') { stop(); me.act('ok'); return; }
    if (e.key === 'ArrowRight') { stop(); me.act('next'); return; }
    if (e.key === 'ArrowLeft') { stop(); me.act('prev'); return; }
    if (e.key.toLowerCase() === 'g') { stop(); me.act('other'); }
  }, true);
  PASSES.push(me);
  return me;
}

/* ------------------------------------------------------------ the Pronoun pass */
/* Kinds of pronoun the pass can show, with labels. */
const PP_INCLUDE = [['he_she', 'he / she'], ['they', 'they'], ['it', 'it'], ['first', 'I / we'], ['you', 'you']];
/* What the Pronoun pass and the Entity-Attribution view (eattrui.js) have in common: an item is an entity mention, and moving it
   regroups the mention and remembers it as confirmed (the pass's `confirmed` list, shared). */
const MENTION_TOOL = {
  confirm: uids => api('POST', '/api/ppass/confirm', { uids }),
  async moveTo(x, target, name) {
    const r = await api('POST', '/api/mentions/regroup', { uids: [x.uid], target, name });
    await api('POST', '/api/ppass/confirm', { uids: [x.uid] });
    updateHistoryButtons(r.history); toast(r.history.undo);
    noteRecent(r.target);
  },
  other: (x, rect, pass) => groupPicker(rect, { title: `Move “${x.text}” to`, exclude: [x.group], near: { a: x.s, b: x.e }, onPick: (t, name) => pass.move(t, name) }),
};
/* The pronoun pass: every pronoun, with the group it is in; moving one regroups the mention (and the pass remembers it). */
const PRONOUN_PASS = makePass({
  key: 'pp', kind: 'pass', name: 'Pronoun pass', noun: 'pronouns', layer: 'entities',
  reasons: { rules: 'rules', one: 'one candidate', reviewed: 'reviewed', confirmed: 'confirmed', manual: 'moved by hand', checked: 'checked groups' },
  skips: [['rules', 'Settled by the quote or narrator rule', 'I, me, my inside a quote with a speaker, or in narration once the narrator is set'],
    ['one', 'Only one matching candidate nearby', 'he or she, when their group is the only one with those pronouns in the last few sentences'],
    ['reviewed', 'In sentences marked as reviewed', ''],
    ['confirmed', 'Confirmed earlier', 'kept with Enter or moved in a pass, and still in that group'],
    ['manual', 'Already moved by hand', 'any mention whose group you changed yourself'],
    ['checked', 'In groups marked as checked', '']],
  presets: { edit: 'Skip what the rules and the context already settle', check: 'Show everything except reviewed sentences' },
  settingsTitle: 'What to show, what to skip and how to advance',
  focus: x => x.group,
  nofit: c => !c.fits,
  chip: c => c.reason || '',
  question: x => `“<b>${esc(x.text)}</b>” is in <span class="sw" style="--h:${hue(x.group)}"></span><b>${esc(trim(x.group_name, 24))}</b>${x.group_pron ? ` <span class="num">${esc(x.group_pron)}</span>` : ''}${x.fits ? '' : ' <span class="ppwarn">doesn’t fit</span>'}${x.in_quote ? ` <span class="num">· in a quote by ${esc(x.speaker || 'no one')}</span>` : ''}`,
  extraSettings: st => `<div class="gpl" style="margin-top:8px">Show</div><div class="row">${PP_INCLUDE.map(([k, l]) => `<label class="chk"><input type="checkbox" data-pps-inc="${k}" ${st.include.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>`,
  readSettings: pop => ({ include: [...pop.querySelectorAll('[data-pps-inc]:checked')].map(i => i.dataset.ppsInc) }),
  ...MENTION_TOOL,
  fetch: q => api('GET', `/api/ppass?${q}`),
  saveSettings: body => api('PUT', '/api/ppass/settings', body),
});
