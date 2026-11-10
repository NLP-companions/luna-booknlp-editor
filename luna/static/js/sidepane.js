'use strict';
/* The right-hand column (review box + details panel): drag its left edge to resize it, click the ‹ / › button to
   collapse it to a thin strip or open it again. The width (px) and open state are remembered in this browser
   ('bne.sideW', 'bne.sideOpen'). The width is applied as the CSS variable --side-w on .body (the stylesheet caps it
   at 60% of the window); collapsing adds the class .sidecollapsed to .body. Below 900px the column is stacked under
   the text instead and the stylesheet hides the handle and button. */

/* Minimum, default and keyboard-step width in px. */
const SIDE_MIN = 260, SIDE_DEFAULT = 380, SIDE_STEP = 20;
/* The grid that holds the column, its drag handle and its toggle button. */
const sideBody = $('.body'), sideHandle = $('#sideResizer'), sideToggle = $('#sideToggle');
/* Current width in px and whether the column is open. */
let sideW = SIDE_DEFAULT, sideOpen = true;

/* Show the current width and open state (CSS variable, collapsed class, button label). */
function sideApply() {
  sideBody.style.setProperty('--side-w', sideOpen ? sideW + 'px' : '');   // collapsed: the stylesheet's strip width applies
  sideBody.classList.toggle('sidecollapsed', !sideOpen);
  sideToggle.textContent = sideOpen ? '›' : '‹';
  sideToggle.title = sideOpen ? 'Hide the side panel' : 'Show the side panel';
  sideToggle.setAttribute('aria-expanded', sideOpen);
  remember('bne.sideW', String(sideW)); remember('bne.sideOpen', sideOpen ? '1' : '0');
}
/* Set the width (at least SIDE_MIN) and open the column. */
function sideSet(w) { sideW = Math.max(SIDE_MIN, Math.round(w)); sideOpen = true; sideApply(); }

sideToggle.addEventListener('click', () => { sideOpen = !sideOpen; sideApply(); });
/* Dragging: the column's width is the distance from the pointer to the body's right edge. */
sideHandle.addEventListener('pointerdown', e => {
  sideHandle.setPointerCapture(e.pointerId);
  sideBody.classList.add('sidedrag');
  e.preventDefault();
});
sideHandle.addEventListener('pointermove', e => {
  if (sideHandle.hasPointerCapture(e.pointerId)) sideSet(sideBody.getBoundingClientRect().right - e.clientX);
});
sideHandle.addEventListener('pointerup', () => sideBody.classList.remove('sidedrag'));
sideHandle.addEventListener('dblclick', () => sideSet(SIDE_DEFAULT));
/* Keyboard: arrow keys nudge the width when the handle is focused. */
sideHandle.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') sideSet(sideW + SIDE_STEP);
  else if (e.key === 'ArrowRight') sideSet(sideW - SIDE_STEP);
  else return;
  e.preventDefault();
});

sideW = storedNumber('bne.sideW', SIDE_DEFAULT, SIDE_MIN, 10000);
sideOpen = stored('bne.sideOpen', '1') !== '0';
sideApply();
