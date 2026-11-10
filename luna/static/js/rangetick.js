'use strict';
/* Shift-click range select for every list of tick boxes (loaded by index.html and library.html before the scripts that use it).
   A tick box's own handler calls `tickRange(box, key, set)` instead of changing the set itself: a plain click changes just
   that box, a shift-click changes every box of the list between it and the box clicked before, to the same state. */

/* Whether the click that is being handled had Shift held ("change" events carry no modifier keys, so it is noted from the click). */
let shiftHeld = false;
document.addEventListener('click', e => { shiftHeld = e.shiftKey; }, true);
/* The box last ticked or unticked, per list (`key` is the data attribute name, e.g. 'mchk'): its value, kept across redraws. */
const rangeAnchor = {};

/* Apply `box`'s new state to the boxes `data-<key>` it stands for, in `set`: a Set of their values (numbers unless `num` is
   false). With `excl` the set holds the UNticked boxes (lists where every row starts ticked). The state is also written to
   the boxes themselves, for lists that are not redrawn. Boxes valued "*" (a tick-all box) are not part of any range. */
function tickRange(box, key, set, { num = true, excl = false } = {}) {
  const boxes = [...document.querySelectorAll(`input[data-${key}]`)].filter(b => b.dataset[key] !== '*');
  const from = boxes.findIndex(b => b.dataset[key] === rangeAnchor[key]), to = boxes.indexOf(box);
  rangeAnchor[key] = box.dataset[key];
  const run = shiftHeld && from >= 0 && to >= 0 ? boxes.slice(Math.min(from, to), Math.max(from, to) + 1) : [box];
  run.forEach(b => {
    b.checked = box.checked;
    const v = num ? +b.dataset[key] : b.dataset[key];
    (b.checked !== excl) ? set.add(v) : set.delete(v);
  });
}
